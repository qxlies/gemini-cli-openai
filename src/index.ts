import { Hono } from 'hono';

// --- Environment Variable Typings ---
export interface Env {
	GCP_SERVICE_ACCOUNT: string; // Now contains OAuth2 credentials JSON
	GEMINI_PROJECT_ID?: string;
}

// --- OAuth2 Credentials Interface ---
interface OAuth2Credentials {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    id_token: string;
    expiry_date: number;
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
 * This class handles authentication and communication with Google's Code Assist API,
 * which powers the Gemini CLI. It uses OAuth2 user credentials for authentication.
 */
class GeminiCliHandler {
    private env: Env;
    private accessToken: string | null = null;
    private projectId: string | null = null;

    constructor(env: Env) {
        this.env = env;
    }

    /**
     * Initializes authentication using OAuth2 credentials.
     */
    public async initializeAuth(): Promise<void> {
        if (!this.env.GCP_SERVICE_ACCOUNT) {
            throw new Error('`GCP_SERVICE_ACCOUNT` environment variable not set. Please provide OAuth2 credentials JSON.');
        }

        try {
            const oauth2Creds: OAuth2Credentials = JSON.parse(this.env.GCP_SERVICE_ACCOUNT);
            
            // Check if access token is still valid (with 5 minute buffer)
            const timeUntilExpiry = oauth2Creds.expiry_date - Date.now();
            const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
            
            if (timeUntilExpiry > bufferTime) {
                // Token is still valid
                this.accessToken = oauth2Creds.access_token;
                console.log(`Token is valid for ${Math.floor(timeUntilExpiry / 1000)} more seconds`);
                return;
            }

            // Token is expired or will expire soon, refresh it
            console.log('Access token expired or expiring soon, refreshing...');
            
            // Use the correct OAuth client credentials from the original implementation
            const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
                    client_secret: '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',
                    refresh_token: oauth2Creds.refresh_token,
                    grant_type: 'refresh_token',
                }),
            });

            if (!refreshResponse.ok) {
                const errorText = await refreshResponse.text();
                console.error('Token refresh failed:', errorText);
                throw new Error(`Token refresh failed: ${errorText}`);
            }

            const refreshData = await refreshResponse.json() as any;
            this.accessToken = refreshData.access_token;
            console.log('Token refreshed successfully');
            
            // Note: In a production environment, you'd want to save the updated credentials
            // back to storage. For now, we'll just use the new token in memory.
            
        } catch (e: any) {
            console.error("Failed to parse OAuth2 credentials or refresh token:", e);
            throw new Error("Invalid OAuth2 credentials or token refresh failed: " + e.message);
        }
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
            const initialProjectId = 'default-project';
            const loadResponse = await this.callEndpoint('loadCodeAssist', {
                cloudaicompanionProject: initialProjectId,
                metadata: { duetProject: initialProjectId },
            });

            if (loadResponse.cloudaicompanionProject) {
                this.projectId = loadResponse.cloudaicompanionProject;
                return loadResponse.cloudaicompanionProject;
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
                console.log('Got 401 error, forcing token refresh and retrying...');
                this.accessToken = null; // Clear token to force re-auth
                await this.initializeAuth(); // This will refresh the token
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

// --- Main Worker Logic with Hono ---
const app = new Hono<{ Bindings: Env }>();

// NEW: Add the /v1/models endpoint
app.get('/v1/models', async (c) => {
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

    return c.json(responsePayload);
});


interface ChatCompletionRequest {
    model: string;
    messages: { role: string; content: string }[];
}

app.post('/v1/chat/completions', async (c) => {
    try {
        console.log('Chat completions request received');
        const body = await c.req.json<ChatCompletionRequest>();
        const model = body.model || 'gemini-1.5-flash-001'; // Default model
        const messages = body.messages || [];

        console.log('Request body parsed:', { model, messageCount: messages.length });

        if (!messages.length) {
            return c.json({ error: 'messages is a required field' }, 400);
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

        console.log('System prompt extracted:', !!systemPrompt);

        const handler = new GeminiCliHandler(c.env);
        
        // Test basic auth first
        try {
            await handler.initializeAuth();
            console.log('Authentication successful');
        } catch (authError: any) {
            console.error('Authentication failed:', authError.message);
            return c.json({ error: 'Authentication failed: ' + authError.message }, 401);
        }

        // Create a readable stream for the response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const openAITransformer = createOpenAIStreamTransformer(model);
        const openAIStream = readable.pipeThrough(openAITransformer);

        // Asynchronously pipe the data from Gemini to our transformer
        (async () => {
            try {
                console.log('Starting stream generation');
                const geminiStream = handler.streamContent(model, systemPrompt, otherMessages);
                
                for await (const chunk of geminiStream) {
                    console.log('Received chunk:', chunk.type);
                    await writer.write(chunk);
                }
                console.log('Stream completed successfully');
                await writer.close();
            } catch (streamError: any) {
                console.error('Stream error:', streamError.message);
                // Try to write an error chunk before closing
                await writer.write({
                    type: 'text',
                    data: `Error: ${streamError.message}`
                });
                await writer.close();
            }
        })();

        // Return the streaming response
        console.log('Returning streaming response');
        return new Response(openAIStream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    } catch (e: any) {
        console.error('Top-level error:', e);
        return c.json({ error: e.message }, 500);
    }
});

// Test endpoint for debugging
app.post('/v1/test', async (c) => {
    try {
        console.log('Test endpoint called');
        const handler = new GeminiCliHandler(c.env);
        
        // Test authentication
        await handler.initializeAuth();
        console.log('Auth test passed');
        
        // Test project discovery
        const projectId = await handler.discoverProjectId();
        console.log('Project discovery test passed:', projectId);
        
        return c.json({ 
            status: 'ok', 
            message: 'Authentication and project discovery successful',
            projectId: projectId
        });
    } catch (e: any) {
        console.error('Test endpoint error:', e);
        return c.json({ 
            status: 'error', 
            message: e.message,
            stack: e.stack 
        }, 500);
    }
});

// Simple token test endpoint
app.post('/v1/token-test', async (c) => {
    try {
        console.log('Token test endpoint called');
        const handler = new GeminiCliHandler(c.env);
        
        // Test authentication only
        await handler.initializeAuth();
        console.log('Token test passed');
        
        return c.json({ 
            status: 'ok', 
            message: 'Token authentication successful'
        });
    } catch (e: any) {
        console.error('Token test error:', e);
        return c.json({ 
            status: 'error', 
            message: e.message,
            stack: e.stack 
        }, 500);
    }
});

export default app;
