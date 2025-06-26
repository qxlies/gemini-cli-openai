import GoogleAuth, { GoogleKey } from 'cloudflare-workers-and-google-oauth';
import { Router, IRequest } from 'itty-router';

// --- Environment Variable Typings ---
export interface Env {
	GCP_SERVICE_ACCOUNT: string;
	GEMINI_PROJECT_ID?: string;
}

// --- Model Information (from your prompt) ---
interface ModelInfo {
    maxTokens: number;
    contextWindow: number;
    supportsImages: boolean;
    supportsPromptCache: boolean;
    inputPrice: number;
    outputPrice: number;
    description: string;
}

const geminiCliModels: Record<string, ModelInfo> = {
    "gemini-2.5-pro": {
        maxTokens: 65536,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.5 Pro model via OAuth (free tier)",
    },
    "gemini-2.5-flash": {
        maxTokens: 65536,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.5 Flash model via OAuth (free tier)",
    },
    "gemini-2.0-flash-001": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Flash model via OAuth (free tier)",
    },
    "gemini-2.0-flash-lite-preview-02-05": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Flash Lite Preview model via OAuth",
    },
    "gemini-2.0-pro-exp-02-05": {
        maxTokens: 8192,
        contextWindow: 2_097_152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Pro Experimental model via OAuth",
    },
    "gemini-2.0-flash-thinking-exp-01-21": {
        maxTokens: 65_536,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Flash Thinking Experimental model via OAuth",
    },
    "gemini-2.0-flash-thinking-exp-1219": {
        maxTokens: 8192,
        contextWindow: 32_767,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Flash Thinking Experimental (1219) model via OAuth",
    },
    "gemini-2.0-flash-exp": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 2.0 Flash Experimental model via OAuth",
    },
    "gemini-1.5-flash-002": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 1.5 Flash 002 model via OAuth (free tier)",
    },
    "gemini-1.5-flash-exp-0827": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 1.5 Flash Experimental (0827) model via OAuth",
    },
    "gemini-1.5-flash-8b-exp-0827": {
        maxTokens: 8192,
        contextWindow: 1_048_576,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 1.5 Flash 8B Experimental model via OAuth",
    },
    "gemini-1.5-pro-002": {
        maxTokens: 8192,
        contextWindow: 2_097_152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 1.5 Pro 002 model via OAuth",
    },
    "gemini-1.5-pro-exp-0827": {
        maxTokens: 8192,
        contextWindow: 2_097_152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini 1.5 Pro Experimental model via OAuth",
    },
    "gemini-exp-1206": {
        maxTokens: 8192,
        contextWindow: 2_097_152,
        supportsImages: true,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
        description: "Google's Gemini Experimental (1206) model via OAuth",
    },
};

// --- Constants from the original gemini-cli.ts ---
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

/**
 * This class is a direct adaptation of the GeminiCliHandler from the provided code,
 * modified to run in a Cloudflare Worker environment. It handles authentication
 * and communication with Google's Code Assist API, which powers the Gemini CLI.
 * It now uses service account credentials via `cloudflare-workers-and-google-oauth`.
 */
class GeminiCliHandler {
    private env: Env;
    private accessToken: string | null = null;
    private projectId: string | null = null;

    constructor(env: Env) {
        this.env = env;
    }

    /**
     * Initializes authentication by obtaining an OAuth token using the service account.
     */
    private async initializeAuth(): Promise<void> {
        if (this.accessToken) {
            // This is a simplified auth flow. A more robust implementation would check
            // for token expiry before re-fetching.
            return;
        }

        if (!this.env.GCP_SERVICE_ACCOUNT) {
            throw new Error('`GCP_SERVICE_ACCOUNT` environment variable not set. Please provide a service account JSON.');
        }

        try {
            const serviceAccount: GoogleKey = JSON.parse(this.env.GCP_SERVICE_ACCOUNT);
            const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
            const oauth = new GoogleAuth(serviceAccount, scopes);
            const token = await oauth.getGoogleAuthToken();
            if (!token) {
                throw new Error('Authentication failed: could not retrieve Google Auth token.');
            }
            this.accessToken = token;
        } catch (e: any) {
            console.error("Failed to parse GCP_SERVICE_ACCOUNT or get auth token.", e);
            throw new Error("Invalid GCP_SERVICE_ACCOUNT credentials or authentication failed.");
        }
    }

    /**
     * Discovers the Google Cloud project ID. Uses the environment variable if provided.
     */
    private async discoverProjectId(): Promise<string> {
        if (this.env.GEMINI_PROJECT_ID) {
            return this.env.GEMINI_PROJECT_ID;
        }
        if (this.projectId) {
            return this.projectId;
        }

        try {
            const initialProjectId = 'default-project';
            const loadResponse = await this.callEndpoint('loadCodeAssist', {
                cloudaicompanionProject: initialProjectId,
                metadata: { duetProject: initialProjectId },
            });

            if (loadResponse.cloudaicompanionProject) {
                this.projectId = loadResponse.cloudaicompanionProject;
                return this.projectId;
            }
            throw new Error('Project ID discovery failed. Please set the GEMINI_PROJECT_ID environment variable.');
        } catch (error: any) {
            console.error('Failed to discover project ID:', error.response?.data || error.message);
            throw new Error("Could not discover project ID. Make sure you're authenticated and consider setting GEMINI_PROJECT_ID.");
        }
    }

    /**
     * A generic method to call a Code Assist API endpoint.
     */
    private async callEndpoint(method: string, body: any, isRetry: boolean = false): Promise<any> {
        await this.initializeAuth();

        const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            if (response.status === 401 && !isRetry) {
                this.accessToken = null; // Clear token to force re-auth
                return this.callEndpoint(method, body, true); // Retry once
            }
            const errorText = await response.text();
            throw new Error(`API call failed with status ${response.status}: ${errorText}`);
        }

        return response.json();
    }

    /**
     * Parses a server-sent event (SSE) stream from the Gemini API.
     */
    private async *parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        let objectBuffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (objectBuffer) {
                    try {
                        yield JSON.parse(objectBuffer);
                    } catch (e) {
                        console.error('Error parsing final SSE JSON object:', e);
                    }
                }
                break;
            }

            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last, possibly incomplete, line.

            for (const line of lines) {
                if (line.trim() === '') {
                    if (objectBuffer) {
                        try {
                            yield JSON.parse(objectBuffer);
                        } catch (e) {
                            console.error('Error parsing SSE JSON object:', e);
                        }
                        objectBuffer = '';
                    }
                } else if (line.startsWith('data: ')) {
                    objectBuffer += line.substring(6);
                }
            }
        }
    }

    /**
     * Main method to generate content, adapted as an async generator.
     */
    async *streamContent(modelId: string, systemPrompt: string, messages: any[]): AsyncGenerator<{ type: 'text' | 'usage'; data: any }> {
        await this.initializeAuth();
        const projectId = await this.discoverProjectId();

        const contents = messages.map((msg) => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        if (systemPrompt) {
            contents.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
        }

        const streamRequest = {
            model: modelId,
            project: projectId,
            request: {
                contents: contents,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8192,
                },
            },
        };

        const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify(streamRequest),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[GeminiCLI] Stream request failed: ${response.status}`, errorText);
            throw new Error(`Stream request failed: ${response.status}`);
        }

        if (!response.body) {
            throw new Error("Response has no body");
        }

        for await (const jsonData of this.parseSSEStream(response.body)) {
            const candidate = jsonData.response?.candidates?.[0];
            if (candidate?.content?.parts?.[0]?.text) {
                const content = candidate.content.parts[0].text;
                yield { type: 'text', data: content };
            }

            if (jsonData.response?.usageMetadata) {
                const usage = jsonData.response.usageMetadata;
                yield {
                    type: 'usage',
                    data: {
                        inputTokens: usage.promptTokenCount || 0,
                        outputTokens: usage.candidatesTokenCount || 0,
                    },
                };
            }
        }
    }
}

/**
 * Creates a TransformStream to convert Gemini's output chunks
 * into OpenAI-compatible server-sent events.
 */
function createOpenAIStreamTransformer(model: string): TransformStream<any, Uint8Array> {
    const chatID = `chatcmpl-${crypto.randomUUID()}`;
    const creationTime = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    let firstChunk = true;

    return new TransformStream({
        transform(chunk, controller) {
            if (chunk.type !== 'text' || !chunk.data) return;

            let delta: { role?: string; content: string } = { content: chunk.data };
            if (firstChunk) {
                delta.role = 'assistant';
                firstChunk = false;
            }

            const openAIChunk = {
                id: chatID,
                object: 'chat.completion.chunk',
                created: creationTime,
                model: model,
                choices: [{ index: 0, delta: delta, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
        },
        flush(controller) {
            // Send the final chunk with the finish reason.
            const finalChunk = {
                id: chatID,
                object: 'chat.completion.chunk',
                created: creationTime,
                model: model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        },
    });
}

// --- Main Worker Logic with Itty Router ---
const router = Router();

// NEW: Add the /v1/models endpoint
router.get('/v1/models', async () => {
    const modelData = Object.keys(geminiCliModels).map((modelId) => ({
        id: modelId,
        object: 'model',
        created: Math.floor(Date.now() / 1000), // Use current time as creation time
        owned_by: 'google-gemini-cli',
    }));

    const responsePayload = {
        object: 'list',
        data: modelData,
    };

    return new Response(JSON.stringify(responsePayload), {
        headers: { 'Content-Type': 'application/json' },
    });
});


interface ChatCompletionRequest {
    model: string;
    messages: { role: string; content: string }[];
}

router.post('/v1/chat/completions', async (request: IRequest, env: Env) => {
    try {
        const body = await request.json<ChatCompletionRequest>();
        const model = body.model || 'gemini-1.5-flash-001'; // Default model
        const messages = body.messages || [];

        if (!messages.length) {
            return new Response(JSON.stringify({ error: 'messages is a required field' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // Extract system prompt and user/assistant messages
        let systemPrompt = '';
        const otherMessages = messages.filter((msg: any) => {
            if (msg.role === 'system') {
                systemPrompt = msg.content;
                return false;
            }
            return true;
        });

        const handler = new GeminiCliHandler(env);
        const geminiStream = handler.streamContent(model, systemPrompt, otherMessages);

        // Create a readable stream for the response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const openAITransformer = createOpenAIStreamTransformer(model);
        const openAIStream = readable.pipeThrough(openAITransformer);

        // Asynchronously pipe the data from Gemini to our transformer
        (async () => {
            for await (const chunk of geminiStream) {
                await writer.write(chunk);
            }
            await writer.close();
        })().catch(async (err) => {
            console.error('Error during streaming:', err);
            await writer.abort(err);
        });

        // Return the streaming response
        return new Response(openAIStream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    } catch (e: any) {
        console.error(e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});

// Catch-all for 404s
router.all('*', () => new Response('Not Found.', { status: 404 }));

export default {
    fetch: router.handle,
};
