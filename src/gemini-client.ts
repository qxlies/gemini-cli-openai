import { Env, StreamChunk } from './types';
import { AuthManager } from './auth';
import { CODE_ASSIST_ENDPOINT, CODE_ASSIST_API_VERSION } from './config';

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
            const initialProjectId = 'default-project';
            const loadResponse = await this.authManager.callEndpoint('loadCodeAssist', {
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
     * Stream content from Gemini API.
     */
    async *streamContent(modelId: string, systemPrompt: string, messages: any[]): AsyncGenerator<StreamChunk> {
        await this.authManager.initializeAuth();
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
                'Authorization': `Bearer ${this.authManager.getAccessToken()}`,
            },
            body: JSON.stringify(streamRequest),
        });

        if (!response.ok) {
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
