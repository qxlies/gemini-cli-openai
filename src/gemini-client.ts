import {
        Env,
        StreamChunk,
        ReasoningData,
        UsageData,
        ChatMessage,
        MessageContent,
        Tool,
        ToolChoice,
        GeminiFunctionCall
} from "./types.js";
import { AuthManager } from "./auth.js";
import { CODE_ASSIST_ENDPOINT, CODE_ASSIST_API_VERSION, getProxyDispatcher } from "./config.js";
import { REASONING_MESSAGES, REASONING_CHUNK_DELAY, THINKING_CONTENT_CHUNK_SIZE } from "./constants.js";
import { geminiCliModels } from "./models.js";
import { validateImageUrl } from "./utils/image-utils.js";
import { GenerationConfigValidator } from "./helpers/generation-config-validator.js";
import { AutoModelSwitchingHelper } from "./helpers/auto-model-switching.js";
import { NativeToolsManager } from "./helpers/native-tools-manager.js";
import { CitationsProcessor } from "./helpers/citations-processor.js";
import { GeminiUrlContextMetadata, GroundingMetadata, NativeToolsRequestParams } from "./types/native-tools.js";

// Gemini API response types
interface GeminiCandidate {
        content?: {
                parts?: Array<{ text?: string }>;
        };
        groundingMetadata?: GroundingMetadata;
}
interface GeminiUsageMetadata {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
}
interface GeminiResponse {
        response?: {
                candidates?: GeminiCandidate[];
                usageMetadata?: GeminiUsageMetadata;
        };
}
export interface GeminiPart {
        text?: string;
        thought?: boolean; // For real thinking chunks from Gemini
        functionCall?: {
                name: string;
                args: object;
        };
        functionResponse?: {
                name: string;
                response: {
                        result: string;
                };
        };
        inlineData?: {
                mimeType: string;
                data: string;
        };
        fileData?: {
                mimeType: string;
                fileUri: string;
        };
        url_context_metadata?: GeminiUrlContextMetadata;
}
// Message content types - keeping only the local ones needed
interface TextContent {
        type: "text";
        text: string;
}
interface GeminiFormattedMessage {
        role: string;
        parts: GeminiPart[];
}
interface ProjectDiscoveryResponse {
        cloudaicompanionProject?: string;
}
// Type guard functions
function isTextContent(content: MessageContent): content is TextContent {
        return content.type === "text" && typeof content.text === "string";
}
/**
* Handles communication with Google's Gemini API through the Code Assist endpoint.
* Manages project discovery, streaming, and response parsing.
*/
export class GeminiApiClient {
        private env: Env;
        private authManager: AuthManager;
        private projectId: string | null = null;
        private autoSwitchHelper: AutoModelSwitchingHelper;
        private constructor(env: Env, authManager: AuthManager) {
        	this.env = env;
        	this.authManager = authManager;
        	this.autoSwitchHelper = new AutoModelSwitchingHelper(env);
        }
      
        public static async create(env: Env): Promise<GeminiApiClient> {
        	const authManager = await AuthManager.create(env);
        	return new GeminiApiClient(env, authManager);
        }
        /**
         * Discovers the Google Cloud project ID. Uses the environment variable if provided.
         */
        public async discoverProjectId(): Promise<string> {
        	const currentAccount = this.authManager.getCurrentAccount();
        	if (currentAccount && currentAccount.project_id) {
        		return currentAccount.project_id;
        	}
      
        	if (this.projectId) {
        		return this.projectId;
        	}
        	try {
        		const initialProjectId = "default-project";
        		const loadResponse = (await this.authManager.callEndpoint("loadCodeAssist", {
        			cloudaicompanionProject: initialProjectId,
        			metadata: { duetProject: initialProjectId }
        		})) as ProjectDiscoveryResponse;
        		if (loadResponse.cloudaicompanionProject) {
        			this.projectId = loadResponse.cloudaicompanionProject;
        			return loadResponse.cloudaicompanionProject;
        		}
        		throw new Error("Project ID discovery failed. Please set the GEMINI_PROJECT_ID environment variable.");
        	} catch (error: unknown) {
        		const errorMessage = error instanceof Error ? error.message : String(error);
        		console.error("Failed to discover project ID:", errorMessage);
        		throw new Error(
        			"Could not discover project ID. Make sure you're authenticated and consider setting GEMINI_PROJECT_ID."
        		);
        	}
        }
        /**
         * Parses a server-sent event (SSE) stream from the Gemini API.
         */
        private async *parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<GeminiResponse> {
                const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
                let buffer = "";
                let objectBuffer = "";
                while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                                if (objectBuffer) {
                                        try {
                                                yield JSON.parse(objectBuffer);
                                        } catch (e) {
                                                console.error("Error parsing final SSE JSON object:", e);
                                        }
                                }
                                break;
                        }
                        buffer += value;
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || ""; // Keep the last, possibly incomplete, line.
                        for (const line of lines) {
                                if (line.trim() === "") {
                                        if (objectBuffer) {
                                                try {
                                                        yield JSON.parse(objectBuffer);
                                                } catch (e) {
                                                        console.error("Error parsing SSE JSON object:", e);
                                                }
                                                objectBuffer = "";
                                        }
                                } else if (line.startsWith("data: ")) {
                                        objectBuffer += line.substring(6);
                                }
                        }
                }
        }
        /**
         * Converts a message to Gemini format, handling both text and image content.
         */
        private messageToGeminiFormat(msg: ChatMessage): GeminiFormattedMessage {
                const role = msg.role === "assistant" ? "model" : "user";
                // Handle tool call results (tool role in OpenAI format)
                if (msg.role === "tool") {
                        return {
                                role: "user",
                                parts: [
                                        {
                                                functionResponse: {
                                                        name: msg.tool_call_id || "unknown_function",
                                                        response: {
                                                                result: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                                                        }
                                                }
                                        }
                                ]
                        };
                }
                // Handle assistant messages with tool calls
                if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
                        const parts: GeminiPart[] = [];
                        // Add text content if present
                        if (typeof msg.content === "string" && msg.content.trim()) {
                                parts.push({ text: msg.content });
                        }
                        // Add function calls
                        for (const toolCall of msg.tool_calls) {
                                if (toolCall.type === "function") {
                                        parts.push({
                                                functionCall: {
                                                        name: toolCall.function.name,
                                                        args: JSON.parse(toolCall.function.arguments)
                                                }
                                        });
                                }
                        }
                        return { role: "model", parts };
                }
                if (typeof msg.content === "string") {
                        // Simple text message
                        return {
                                role,
                                parts: [{ text: msg.content }]
                        };
                }
                if (Array.isArray(msg.content)) {
                        // Multimodal message with text and/or images
                        const parts: GeminiPart[] = [];
                        for (const content of msg.content) {
                                if (content.type === "text") {
                                        parts.push({ text: content.text });
                                } else if (content.type === "image_url" && content.image_url) {
                                        const imageUrl = content.image_url.url;
                                        // Validate image URL
                                        const validation = validateImageUrl(imageUrl);
                                        if (!validation.isValid) {
                                                throw new Error(`Invalid image: ${validation.error}`);
                                        }
                                        if (imageUrl.startsWith("data:")) {
                                                // Handle base64 encoded images
                                                const [mimeType, base64Data] = imageUrl.split(",");
                                                const mediaType = mimeType.split(":")[1].split(";")[0];
                                                parts.push({
                                                        inlineData: {
                                                                mimeType: mediaType,
                                                                data: base64Data
                                                        }
                                                });
                                        } else {
                                                // Handle URL images
                                                // Note: For better reliability, you might want to fetch the image
                                                // and convert it to base64, as Gemini API might have limitations with external URLs
                                                parts.push({
                                                        fileData: {
                                                                mimeType: validation.mimeType || "image/jpeg",
                                                                fileUri: imageUrl
                                                        }
                                                });
                                        }
                                }
                        }
                        return { role, parts };
                }
                // Fallback for unexpected content format
                return {
                        role,
                        parts: [{ text: String(msg.content) }]
                };
        }
        /**
         * Validates if the model supports images.
         */
        private validateImageSupport(modelId: string): boolean {
                return geminiCliModels[modelId]?.supportsImages || false;
        }
        /**
         * Validates image content and format using the shared validation utility.
         */
        private validateImageContent(imageUrl: string): boolean {
                const validation = validateImageUrl(imageUrl);
                return validation.isValid;
        }
        /**
         * Stream content from Gemini API.
         */
        async *streamContent(
                modelId: string,
                systemPrompt: string,
                messages: ChatMessage[],
                options?: {
                        includeReasoning?: boolean;
                        thinkingBudget?: number;
                        tools?: Tool[];
                        tool_choice?: ToolChoice;
                        max_tokens?: number;
                        temperature?: number;
                        top_p?: number;
                        stop?: string | string[];
                        presence_penalty?: number;
                        frequency_penalty?: number;
                        seed?: number;
                        response_format?: {
                                type: "text" | "json_object";
                        };
                } & NativeToolsRequestParams
        ): AsyncGenerator<StreamChunk> {
                await this.authManager.initializeAuth();
                // Allow per-request project override to avoid any shared context across a single project
                const overrideProjectId =
                        this.extractStringParam(options as Record<string, unknown>, "gemini_project_id", (v): v is string => typeof v === "string") ??
                        this.extractStringParam(options as Record<string, unknown>, "project_id", (v): v is string => typeof v === "string");
                const projectId = overrideProjectId || (await this.discoverProjectId());
                const contents = messages.map((msg) => this.messageToGeminiFormat(msg));
                // Use dedicated systemInstruction field instead of injecting into contents to avoid backend
                // conversation memory retaining previous system prompts across requests.
                const systemInstruction = systemPrompt
                        ? ({ role: "system", parts: [{ text: systemPrompt }] } as GeminiFormattedMessage)
                        : undefined;
                // Check if this is a thinking model and which thinking mode to use
                const isThinkingModel = geminiCliModels[modelId]?.thinking || false;
                const isRealThinkingEnabled = this.env.ENABLE_REAL_THINKING === "true";
                const isFakeThinkingEnabled = this.env.ENABLE_FAKE_THINKING === "true";
                const streamThinkingAsContent = this.env.STREAM_THINKING_AS_CONTENT === "true";
                const includeReasoning = options?.includeReasoning || false;
                const req = {
                        thinking_budget: options?.thinkingBudget,
                        tools: options?.tools,
                        tool_choice: options?.tool_choice,
                        max_tokens: options?.max_tokens,
                        temperature: options?.temperature,
                        top_p: options?.top_p,
                        stop: options?.stop,
                        presence_penalty: options?.presence_penalty,
                        frequency_penalty: options?.frequency_penalty,
                        seed: options?.seed,
                        response_format: options?.response_format
                };
                // Use the validation helper to create a proper generation config
                const generationConfig = GenerationConfigValidator.createValidatedConfig(
                        modelId,
                        req,
                        isRealThinkingEnabled,
                        includeReasoning
                );
                // Native tools integration
                const nativeToolsManager = new NativeToolsManager(this.env);
                const nativeToolsParams = this.extractNativeToolsParams(options as Record<string, unknown>);
                const toolConfig = nativeToolsManager.determineToolConfiguration(options?.tools || [], nativeToolsParams, modelId);
                // Configure request based on tool strategy
                const { tools, toolConfig: finalToolConfig } = GenerationConfigValidator.createFinalToolConfiguration(
                        toolConfig,
                        options
                );
                // For thinking models with fake thinking (fallback when real thinking is not enabled or not requested)
                let needsThinkingClose = false;
                if (isThinkingModel && isFakeThinkingEnabled && !includeReasoning) {
                        yield* this.generateReasoningOutput(messages, streamThinkingAsContent);
                        needsThinkingClose = streamThinkingAsContent; // Only need to close if we streamed as content
                }
                const streamRequest: {
                        model: string;
                        project: string;
                        request: {
                                contents: unknown;
                                generationConfig: unknown;
                                tools: unknown;
                                toolConfig: unknown;
                                systemInstruction?: unknown;
                                safetySettings?: unknown;
                        };
                } = {
                        model: modelId,
                        project: projectId,
                        request: {
                                contents: contents,
                                generationConfig,
                                tools: tools,
                                toolConfig: finalToolConfig,
                                ...(systemInstruction ? { systemInstruction } : {})
                        }
                };
                const safetySettings = GenerationConfigValidator.createSafetySettings(this.env);
                if (safetySettings.length > 0) {
                        streamRequest.request.safetySettings = safetySettings;
                }
                // Lightweight diagnostics to verify isolation per request
                console.log(
                        `[GeminiAPI] Prepared stream request model=${modelId} project=${projectId} sys=${!!systemInstruction} contents=${contents.length}`
                );
                yield* this.performStreamRequest(
                        streamRequest,
                        needsThinkingClose,
                        false,
                        includeReasoning && streamThinkingAsContent,
                        modelId,
                        nativeToolsManager
                );
        }
        /**
         * Generates reasoning output for thinking models.
         */
        private async *generateReasoningOutput(
                messages: ChatMessage[],
                streamAsContent: boolean = false
        ): AsyncGenerator<StreamChunk> {
                // Get the last user message to understand what the model should think about
                const lastUserMessage = messages.filter((msg) => msg.role === "user").pop();
                let userContent = "";
                if (lastUserMessage) {
                        if (typeof lastUserMessage.content === "string") {
                                userContent = lastUserMessage.content;
                        } else if (Array.isArray(lastUserMessage.content)) {
                                userContent = lastUserMessage.content
                                        .filter(isTextContent)
                                        .map((c) => c.text)
                                        .join(" ");
                        }
                }
                // Generate reasoning text based on the user's question using constants
                const requestPreview = userContent.substring(0, 100) + (userContent.length > 100 ? "..." : "");
                if (streamAsContent) {
                        // DeepSeek R1 style: stream thinking as content with <thinking> tags
                        yield {
                                type: "thinking_content",
                                data: "<thinking>\n"
                        };
                        // Add a small delay after opening tag
                        await new Promise((resolve) => setTimeout(resolve, REASONING_CHUNK_DELAY)); // Stream reasoning content in smaller chunks for more realistic streaming
                        const reasoningTexts = REASONING_MESSAGES.map((msg) => msg.replace("{requestPreview}", requestPreview));
                        const fullReasoningText = reasoningTexts.join("");
                        // Split into smaller chunks for more realistic streaming
                        // Try to split on word boundaries when possible for better readability
                        const chunks: string[] = [];
                        let remainingText = fullReasoningText;
                        while (remainingText.length > 0) {
                                if (remainingText.length <= THINKING_CONTENT_CHUNK_SIZE) {
                                        chunks.push(remainingText);
                                        break;
                                }
                                // Try to find a good break point (space, newline, punctuation)
                                let chunkEnd = THINKING_CONTENT_CHUNK_SIZE;
                                const searchSpace = remainingText.substring(0, chunkEnd + 10); // Look a bit ahead
                                const goodBreaks = [" ", "\n", ".", ",", "!", "?", ";", ":"];
                                for (const breakChar of goodBreaks) {
                                        const lastBreak = searchSpace.lastIndexOf(breakChar);
                                        if (lastBreak > THINKING_CONTENT_CHUNK_SIZE * 0.7) {
                                                // Don't make chunks too small
                                                chunkEnd = lastBreak + 1;
                                                break;
                                        }
                                }
                                chunks.push(remainingText.substring(0, chunkEnd));
                                remainingText = remainingText.substring(chunkEnd);
                        }
                        for (const chunk of chunks) {
                                yield {
                                        type: "thinking_content",
                                        data: chunk
                                };
                                // Add small delay between chunks
                                await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                        // Note: We don't close the thinking tag here - it will be closed when real content starts
                } else {
                        // Original mode: stream as reasoning field
                        const reasoningTexts = REASONING_MESSAGES.map((msg) => msg.replace("{requestPreview}", requestPreview));
                        // Stream the reasoning text in chunks
                        for (const reasoningText of reasoningTexts) {
                                const reasoningData: ReasoningData = { reasoning: reasoningText };
                                yield {
                                        type: "reasoning",
                                        data: reasoningData
                                };
                                // Add a small delay to simulate thinking time
                                await new Promise((resolve) => setTimeout(resolve, REASONING_CHUNK_DELAY));
                        }
                }
        }
        /**
         * Performs the actual stream request with retry logic for 401 errors and auto model switching for rate limits.
         */
        private async *performStreamRequest(
                streamRequest: unknown,
                needsThinkingClose: boolean = false,
                isRetry: boolean = false,
                realThinkingAsContent: boolean = false,
                originalModel?: string,
                nativeToolsManager?: NativeToolsManager
        ): AsyncGenerator<StreamChunk> {
                // Get the number of accounts to limit attempts
                const maxAccountTries = (this.authManager as any).accounts?.length || 1;
                let attempt = 0;
                let lastError: Error | null = null;
                while (attempt < maxAccountTries) {
                        // Ensure the request uses the current account's project on every attempt
                        try {
                                const currentProject = await this.discoverProjectId();
                                if ((streamRequest as any)?.project !== currentProject) {
                                        (streamRequest as any).project = currentProject;
                                }
                                // Debug which account/project we are using now
                                const accIndex = (this.authManager as any).currentAccountIndex;
                                console.log(`[GeminiAPI] Attempt ${attempt + 1}/${maxAccountTries} using account index ${accIndex}, project ${currentProject}`);
                        } catch (e) {
                                // If discovery fails, proceed; server will return a meaningful error below
                        }
                        const citationsProcessor = new CitationsProcessor(this.env);
                        const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`;
                        const dispatcher = await getProxyDispatcher(this.env as unknown as Record<string, unknown>, url);
                        const response = await fetch(url, ({
                                method: "POST",
                                headers: {
                                        "Content-Type": "application/json",
                                        Authorization: `Bearer ${this.authManager.getAccessToken()}`
                                },
                                body: JSON.stringify(streamRequest),
                                dispatcher,
                        }) as any);
                        if (!response.ok) {
                                // Debug: capture headers/body for diagnostics
                                const debugHeaders: Record<string, string> = {};
                                for (const [k, v] of (response.headers as any).entries()) {
                                        const key = String(k).toLowerCase();
                                        if (
                                                key === "retry-after" ||
                                                key.startsWith("x-ratelimit") ||
                                                key.startsWith("x-goog-quota") ||
                                                key === "x-request-id" ||
                                                key === "x-error-code" ||
                                                key === "x-error-message"
                                        ) {
                                                debugHeaders[key] = String(v);
                                        }
                                }
                                // 401 — refresh token and retry (once)
                                if (response.status === 401 && !isRetry) {
                                        const errText = await response.text().catch(() => "");
                                        console.warn("[GeminiAPI] 401 on stream request", {
                                                status: response.status,
                                                statusText: response.statusText,
                                                headers: debugHeaders,
                                                body: errText?.slice(0, 4000)
                                        });
                                        console.log("Got 401 error in stream request, clearing token cache and retrying...");
                                        await this.authManager.clearTokenCache();
                                        await this.authManager.initializeAuth();
                                        yield* this.performStreamRequest(
                                                streamRequest,
                                                needsThinkingClose,
                                                true,
                                                realThinkingAsContent,
                                                originalModel,
                                                nativeToolsManager
                                        );
                                        return;
                                }
                                // 429 — quota exceeded, switch account and retry (up to maxAccountTries)
                                if (response.status === 429 || response.status == 403) {
                                        const errText = await response.text().catch(() => "");
                                        console.warn("[GeminiAPI] Quota/Forbidden on stream request", {
                                                status: response.status,
                                                statusText: response.statusText,
                                                headers: debugHeaders,
                                                body: errText?.slice(0, 4000)
                                        });
                                        console.log(`[GeminiAPI] Stream request failed: 429 (quota exceeded). Switching account and retrying...`);
                                        (this.authManager as any).switchToNextAccount();
                                        await this.authManager.initializeAuth();
                                        attempt++;
                                        lastError = new Error("Quota exceeded (429) for current account");
                                        continue;
                                }
                                // Handle other rate limiting with auto model switching (from HEAD)
                                if (this.autoSwitchHelper.isRateLimitStatus(response.status) && !isRetry && originalModel) {
                                        const fallbackModel = this.autoSwitchHelper.getFallbackModel(originalModel);
                                        if (fallbackModel && this.autoSwitchHelper.isEnabled()) {
                                                console.log(
                                                        `Got ${response.status} error for model ${originalModel}, switching to fallback model: ${fallbackModel}`
                                                );
                                                const fallbackRequest = {
                                                        ...(streamRequest as Record<string, unknown>),
                                                        model: fallbackModel
                                                };
                                                yield {
                                                        type: "text",
                                                        data: this.autoSwitchHelper.createSwitchNotification(originalModel, fallbackModel)
                                                };
                                                yield* this.performStreamRequest(
                                                        fallbackRequest,
                                                        needsThinkingClose,
                                                        true,
                                                        realThinkingAsContent,
                                                        originalModel,
                                                        nativeToolsManager
                                                );
                                                return;
                                        }
                                }
                                const errorText = await response.text().catch(() => "");
                                console.error(`[GeminiAPI] Stream request failed: ${response.status} ${response.statusText}`, {
                                        headers: debugHeaders,
                                        body: errorText?.slice(0, 4000)
                                });
                                lastError = new Error(`Stream request failed: ${response.status}`);
                                break; // For other errors, don't retry
                        } else {
                                // Success - parse stream and exit loop
                                if (!response.body) {
                                        throw new Error("Response has no body");
                                }
                                let hasClosedThinking = false;
                                let hasStartedThinking = false;
                                for await (const jsonData of this.parseSSEStream(response.body)) {
                                        const candidate = jsonData.response?.candidates?.[0];
                                        if (candidate?.content?.parts) {
                                                for (const part of candidate.content.parts as GeminiPart[]) {
                                                        // Handle real thinking content from Gemini
                                                        if (part.thought === true && part.text) {
                                                                const thinkingText = part.text;
                                                                if (realThinkingAsContent) {
                                                                        if (!hasStartedThinking) {
                                                                                yield { type: "thinking_content", data: "<thinking>\n" };
                                                                                hasStartedThinking = true;
                                                                        }
                                                                        yield { type: "thinking_content", data: thinkingText };
                                                                } else {
                                                                        yield { type: "real_thinking", data: thinkingText };
                                                                }
                                                        }
                                                        // Handle regular text content
                                                        else if (part.text) {
                                                                if ((needsThinkingClose || (realThinkingAsContent && hasStartedThinking)) && !hasClosedThinking) {
                                                                        yield { type: "thinking_content", data: "\n</thinking>\n\n" };
                                                                        hasClosedThinking = true;
                                                                }
                                                                let processedText = part.text;
                                                                if (nativeToolsManager) {
                                                                        processedText = citationsProcessor.processChunk(
                                                                                part.text,
                                                                                jsonData.response?.candidates?.[0]?.groundingMetadata
                                                                        );
                                                                }
                                                                yield { type: "text", data: processedText };
                                                        }
                                                        // Handle function calls from Gemini
                                                        else if (part.functionCall) {
                                                                if ((needsThinkingClose || (realThinkingAsContent && hasStartedThinking)) && !hasClosedThinking) {
                                                                        yield { type: "thinking_content", data: "\n</thinking>\n\n" };
                                                                        hasClosedThinking = true;
                                                                }
                                                                const functionCallData: GeminiFunctionCall = {
                                                                        name: part.functionCall.name,
                                                                        args: part.functionCall.args
                                                                };
                                                                yield { type: "tool_code", data: functionCallData };
                                                        }
                                                }
                                        }
                                        if (jsonData.response?.usageMetadata) {
                                                const usage = jsonData.response.usageMetadata;
                                                const usageData: UsageData = {
                                                        inputTokens: usage.promptTokenCount || 0,
                                                        outputTokens: usage.candidatesTokenCount || 0
                                                };
                                                yield { type: "usage", data: usageData };
                                        }
                                }
                                // Citations are processed chunk by chunk, no finalization needed.
                                return; // If everything was successful, exit
                        }
                }
                // If we get here, all accounts have been exhausted or another error occurred
                if (lastError) throw lastError;
                throw new Error("All available Google accounts have failed. Please check their quotas and credentials.");
        }
        /**
         * Get a complete response from Gemini API (non-streaming).
         */
        async getCompletion(
                modelId: string,
                systemPrompt: string,
                messages: ChatMessage[],
                options?: {
                        includeReasoning?: boolean;
                        thinkingBudget?: number;
                        tools?: Tool[];
                        tool_choice?: ToolChoice;
                        max_tokens?: number;
                        temperature?: number;
                        top_p?: number;
                        stop?: string | string[];
                        presence_penalty?: number;
                        frequency_penalty?: number;
                        seed?: number;
                        response_format?: {
                                type: "text" | "json_object";
                        };
                } & NativeToolsRequestParams
        ): Promise<{
                content: string;
                usage?: UsageData;
                tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
        }> {
                try {
                        let content = "";
                        let usage: UsageData | undefined;
                        const tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
                        // Collect all chunks from the stream
                        for await (const chunk of this.streamContent(modelId, systemPrompt, messages, options)) {
                                if (chunk.type === "text" && typeof chunk.data === "string") {
                                        content += chunk.data;
                                } else if (chunk.type === "usage" && typeof chunk.data === "object") {
                                        usage = chunk.data as UsageData;
                                } else if (chunk.type === "tool_code" && typeof chunk.data === "object") {
                                        const toolData = chunk.data as GeminiFunctionCall;
                                        tool_calls.push({
                                                id: `call_${crypto.randomUUID()}`,
                                                type: "function",
                                                function: {
                                                        name: toolData.name,
                                                        arguments: JSON.stringify(toolData.args)
                                                }
                                        });
                                }
                                // Skip reasoning chunks for non-streaming responses
                        }
                        return {
                                content,
                                usage,
                                tool_calls: tool_calls.length > 0 ? tool_calls : undefined
                        };
                } catch (error: unknown) {
                        // Handle rate limiting for non-streaming requests
                        if (this.autoSwitchHelper.isRateLimitError(error)) {
                                const fallbackResult = await this.autoSwitchHelper.handleNonStreamingFallback(
                                        modelId,
                                        systemPrompt,
                                        messages,
                                        options,
                                        this.streamContent.bind(this)
                                );
                                if (fallbackResult) {
                                        return fallbackResult;
                                }
                        }
                        // Re-throw if not a rate limit error or fallback not available
                        throw error;
                }
        }
        private extractNativeToolsParams(options?: Record<string, unknown>): NativeToolsRequestParams {
                return {
                        enableSearch: this.extractBooleanParam(options, "enable_search"),
                        enableUrlContext: this.extractBooleanParam(options, "enable_url_context"),
                        enableNativeTools: this.extractBooleanParam(options, "enable_native_tools"),
                        nativeToolsPriority: this.extractStringParam(
                                options,
                                "native_tools_priority",
                                (v): v is "native" | "custom" | "mixed" => ["native", "custom", "mixed"].includes(v)
                        )
                };
        }
        private extractBooleanParam(options: Record<string, unknown> | undefined, key: string): boolean | undefined {
        	const upperCaseKey = key.toUpperCase() as keyof Env;
        	const envValue = this.env[upperCaseKey];
      
        	const requestValue =
        		options?.[key] ??
        		(options?.extra_body as Record<string, unknown>)?.[key] ??
        		(options?.model_params as Record<string, unknown>)?.[key];
      
        	if (typeof requestValue === "boolean") {
        		return requestValue;
        	}
      
        	if (typeof envValue === "string") {
        		return envValue.toLowerCase() === "true";
        	}
      
        	return undefined;
        }
        private extractStringParam<T extends string>(
        	options: Record<string, unknown> | undefined,
        	key: string,
        	guard: (v: string) => v is T
        ): T | undefined {
        	const upperCaseKey = key.toUpperCase() as keyof Env;
        	const envValue = this.env[upperCaseKey];
      
        	const requestValue =
        		options?.[key] ??
        		(options?.extra_body as Record<string, unknown>)?.[key] ??
        		(options?.model_params as Record<string, unknown>)?.[key];
      
        	if (typeof requestValue === "string" && guard(requestValue)) {
        		return requestValue;
        	}
      
        	if (typeof envValue === "string" && guard(envValue)) {
        		return envValue;
        	}
      
        	return undefined;
        }
}
