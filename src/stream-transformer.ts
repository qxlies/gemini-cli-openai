import { StreamChunk } from './types';
import { OPENAI_CHAT_COMPLETION_OBJECT } from './config';

/**
 * Creates a TransformStream to convert Gemini's output chunks
 * into OpenAI-compatible server-sent events.
 */
export function createOpenAIStreamTransformer(model: string): TransformStream<StreamChunk, Uint8Array> {
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
                object: OPENAI_CHAT_COMPLETION_OBJECT,
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
                object: OPENAI_CHAT_COMPLETION_OBJECT,
                created: creationTime,
                model: model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        },
    });
}
