import { Hono } from 'hono';
import { Env, ChatCompletionRequest } from '../types';
import { geminiCliModels, DEFAULT_MODEL, getAllModelIds } from '../models';
import { OPENAI_MODEL_OWNER } from '../config';
import { AuthManager } from '../auth';
import { GeminiApiClient } from '../gemini-client';
import { createOpenAIStreamTransformer } from '../stream-transformer';

/**
 * OpenAI-compatible API routes for models and chat completions.
 */
export const OpenAIRoute = new Hono<{ Bindings: Env }>();

// List available models
OpenAIRoute.get('/models', async (c) => {
    const modelData = getAllModelIds().map((modelId) => ({
        id: modelId,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: OPENAI_MODEL_OWNER,
    }));

    return c.json({
        object: 'list',
        data: modelData,
    });
});

// Chat completions endpoint
OpenAIRoute.post('/chat/completions', async (c) => {
    try {
        console.log('Chat completions request received');
        const body = await c.req.json<ChatCompletionRequest>();
        const model = body.model || DEFAULT_MODEL;
        const messages = body.messages || [];

        console.log('Request body parsed:', { model, messageCount: messages.length });

        if (!messages.length) {
            return c.json({ error: 'messages is a required field' }, 400);
        }

        // Validate model
        if (!(model in geminiCliModels)) {
            return c.json({ 
                error: `Model '${model}' not found. Available models: ${getAllModelIds().join(', ')}` 
            }, 400);
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

        // Initialize services
        const authManager = new AuthManager(c.env);
        const geminiClient = new GeminiApiClient(c.env, authManager);
        
        // Test authentication first
        try {
            await authManager.initializeAuth();
            console.log('Authentication successful');
        } catch (authError: any) {
            console.error('Authentication failed:', authError.message);
            return c.json({ error: 'Authentication failed: ' + authError.message }, 401);
        }

        // Create streaming response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const openAITransformer = createOpenAIStreamTransformer(model);
        const openAIStream = readable.pipeThrough(openAITransformer);

        // Asynchronously pipe data from Gemini to transformer
        (async () => {
            try {
                console.log('Starting stream generation');
                const geminiStream = geminiClient.streamContent(model, systemPrompt, otherMessages);
                
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

        // Return streaming response
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
