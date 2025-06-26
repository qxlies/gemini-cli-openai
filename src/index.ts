import { OAuth2Client } from 'google-auth-library';
import { Router, IRequest } from 'itty-router';

// --- Environment Variable Typings ---
export interface Env {
    GOOGLE_OAUTH_CREDS_JSON: string;
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

// OAuth configuration for the public Gemini CLI tool
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_REDIRECT_URI = 'http://localhost:45289'; // Dummy redirect for non-web flow

/**
 * Represents the structure of the OAuth credentials JSON file.
 */
interface OAuthCredentials {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    expiry_date: number;
}

/**
 * This class is a direct adaptation of the GeminiCliHandler from the provided code,
 * modified to run in a Cloudflare Worker environment. It handles authentication
 * and communication with Google's Code Assist API, which powers the Gemini CLI.
 */
class GeminiCliHandler {
    private env: Env;
    private authClient: OAuth2Client;
    private projectId: string | null = null;
    private authInitialized: boolean = false;

    constructor(env: Env) {
        this.env = env;
        this.authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI);
    }

    /**
     * Loads OAuth credentials from the environment variable instead of the filesystem.
     */
    private async loadOAuthCredentials(): Promise<OAuthCredentials> {
        if (!this.env.GOOGLE_OAUTH_CREDS_JSON) {
            throw new Error('`GOOGLE_OAUTH_CREDS_JSON` environment variable not set.');
        }
        try {
            return JSON.parse(this.env.GOOGLE_OAUTH_CREDS_JSON);
        } catch (err) {
            throw new Error('Failed to parse `GOOGLE_OAUTH_CREDS_JSON`. Please ensure it is a valid JSON string.');
        }
    }

    /**
     * Initializes the OAuth client with credentials and refreshes the token if necessary.
     */
    private async initializeAuth(forceRefresh: boolean = false): Promise<void> {
        if (this.authInitialized && !forceRefresh) {
            const creds = this.authClient.credentials;
            if (creds && creds.expiry_date && Date.now() < creds.expiry_date - 60000) {
                return; // Token is valid
            }
        }

        const credentials = await this.loadOAuthCredentials();
        this.authClient.setCredentials(credentials);

        // If token is expired or close to expiring, refresh it
        const isExpired = credentials.expiry_date ? Date.now() >= credentials.expiry_date - 60000 : true;
        if (isExpired && credentials.refresh_token) {
            try {
                await this.authClient.refreshAccessToken();
                // In a real app, you might want to save the new credentials, but for a serverless
                // function, we'll just use the refreshed token for this invocation.
            } catch (error) {
                console.error(`[GeminiCLI] Failed to refresh token:`, error);
                // Proceed with the expired token; the API call might still work or will fail with a 401.
            }
        }
        this.authInitialized = true;
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

        // This discovery logic is ported from the original file.
        // It's complex and makes extra API calls. Providing GEMINI_PROJECT_ID is recommended.
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
     * A generic method to call a Code Assist API endpoint with automatic auth refresh on 401.
     */
    private async callEndpoint(method: string, body: any, retryAuth: boolean = true): Promise<any> {
        try {
            const res = await this.authClient.request({
                url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            return res.data;
        } catch (error: any) {
            if (error.response?.status === 401 && retryAuth) {
                await this.initializeAuth(true); // Force refresh
                return this.callEndpoint(method, body, false); // Retry once
            }
            throw error;
        }
    }

    /**
     * Parses a server-sent event (SSE) stream from the Gemini API.
     * This is a web-compatible implementation using ReadableStream and TextDecoderStream.
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

        // The original code prepends the system prompt as a 'user' message.
        if (systemPrompt) {
            contents.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
        }

        const streamRequest = {
            model: modelId,
            project: projectId,
            request: {
                contents: contents,
                generationConfig: {
                    temperature: 0.7, // Example value
                    maxOutputTokens: 8192, // Example value
                },
            },
        };

        const response = await this.authClient.request<ReadableStream>({
            url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent`,
            method: 'POST',
            params: { alt: 'sse' },
            headers: { 'Content-Type': 'application/json' },
            responseType: 'stream',
            body: JSON.stringify(streamRequest),
        });

        for await (const jsonData of this.parseSSEStream(response.data)) {
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
router.get('/v1/models', () => {
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


router.post('/v1/chat/completions', async (request: IRequest, env: Env) => {
    try {
        const body = await request.json();
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
