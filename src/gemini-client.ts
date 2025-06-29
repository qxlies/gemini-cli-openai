import { Env, StreamChunk, ReasoningData, UsageData } from "./types";
import { AuthManager } from "./auth";
import { CODE_ASSIST_ENDPOINT, CODE_ASSIST_API_VERSION } from "./config";
import { geminiCliModels } from "./models";
import { validateImageUrl } from "./utils/image-utils";

// Gemini API response types
interface GeminiCandidate {
	content?: {
		parts?: Array<{ text?: string }>;
	};
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

interface GeminiPart {
	text?: string;
	inlineData?: {
		mimeType: string;
		data: string;
	};
	fileData?: {
		mimeType: string;
		fileUri: string;
	};
}

// Message content types
interface MessageContentText {
	type: "text";
	text?: string;
}

interface MessageContentImage {
	type: "image_url";
	image_url?: {
		url: string;
	};
}

interface MessageContentGeneric {
	type: string;
	text?: string;
	image_url?: {
		url: string;
	};
}

interface TextContentFilter {
	type: "text";
	text: string;
}

type MessageContent = MessageContentText | MessageContentImage | MessageContentGeneric;

interface ChatMessage {
	role: string;
	content: string | MessageContent[];
}

interface GeminiFormattedMessage {
	role: string;
	parts: GeminiPart[];
}

interface ProjectDiscoveryResponse {
	cloudaicompanionProject?: string;
}

// Type guard functions
function isTextContent(content: MessageContent): content is TextContentFilter {
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

	constructor(env: Env, authManager: AuthManager) {
		this.env = env;
		this.authManager = authManager;
	}

	/**
	 * Discovers the Google Cloud project ID. Uses the environment variable if provided.
	 */
	public async discoverProjectId(): Promise<string> {
		if (this.env.GEMINI_PROJECT_ID) {
			return this.env.GEMINI_PROJECT_ID;
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
	async *streamContent(modelId: string, systemPrompt: string, messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
		await this.authManager.initializeAuth();
		const projectId = await this.discoverProjectId();

		const contents = messages.map((msg) => this.messageToGeminiFormat(msg));

		if (systemPrompt) {
			contents.unshift({ role: "user", parts: [{ text: systemPrompt }] });
		}

		// Check if this is a thinking model and if fake thinking is enabled
		const isThinkingModel = geminiCliModels[modelId]?.thinking || false;
		const isFakeThinkingEnabled = this.env.ENABLE_FAKE_THINKING === "true";

		// For thinking models, emit reasoning before the actual response (only if fake thinking is enabled)
		if (isThinkingModel && isFakeThinkingEnabled) {
			yield* this.generateReasoningOutput(modelId, messages);
		}

		const streamRequest = {
			model: modelId,
			project: projectId,
			request: {
				contents: contents,
				generationConfig: {
					temperature: 0.7,
					maxOutputTokens: 8192
				}
			}
		};

		yield* this.performStreamRequest(streamRequest);
	}

	/**
	 * Generates reasoning output for thinking models.
	 */
	private async *generateReasoningOutput(modelId: string, messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
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

		// Generate reasoning text based on the user's question
		const reasoningTexts = [
			`**Analyzing the request: "${userContent.substring(0, 100)}${userContent.length > 100 ? "..." : ""}"**\n\n`,
			"Let me think about this step by step. ",
			"I need to consider the context and provide a comprehensive response. ",
			"Based on my understanding, I should address the key points while being accurate and helpful. ",
			"Let me formulate a clear and structured answer.\n\n"
		];

		// Stream the reasoning text in chunks
		for (const reasoningText of reasoningTexts) {
			const reasoningData: ReasoningData = { reasoning: reasoningText };
			yield {
				type: "reasoning",
				data: reasoningData
			};

			// Add a small delay to simulate thinking time
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	/**
	 * Performs the actual stream request with retry logic for 401 errors.
	 */
	private async *performStreamRequest(streamRequest: unknown, isRetry: boolean = false): AsyncGenerator<StreamChunk> {
		const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.authManager.getAccessToken()}`
			},
			body: JSON.stringify(streamRequest)
		});

		if (!response.ok) {
			if (response.status === 401 && !isRetry) {
				console.log("Got 401 error in stream request, clearing token cache and retrying...");
				await this.authManager.clearTokenCache();
				await this.authManager.initializeAuth();
				yield* this.performStreamRequest(streamRequest, true); // Retry once
				return;
			}
			const errorText = await response.text();
			console.error(`[GeminiAPI] Stream request failed: ${response.status}`, errorText);
			throw new Error(`Stream request failed: ${response.status}`);
		}

		if (!response.body) {
			throw new Error("Response has no body");
		}

		for await (const jsonData of this.parseSSEStream(response.body)) {
			const candidate = jsonData.response?.candidates?.[0];
			if (candidate?.content?.parts?.[0]?.text) {
				const content = candidate.content.parts[0].text;
				yield { type: "text", data: content };
			}

			if (jsonData.response?.usageMetadata) {
				const usage = jsonData.response.usageMetadata;
				const usageData: UsageData = {
					inputTokens: usage.promptTokenCount || 0,
					outputTokens: usage.candidatesTokenCount || 0
				};
				yield {
					type: "usage",
					data: usageData
				};
			}
		}
	}
}
