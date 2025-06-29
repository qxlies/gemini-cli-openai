import { StreamChunk, ReasoningData } from "./types";
import { OPENAI_CHAT_COMPLETION_OBJECT } from "./config";

// OpenAI API interfaces
interface OpenAIChoice {
	index: number;
	delta: OpenAIDelta;
	finish_reason: string | null;
}

interface OpenAIDelta {
	role?: string;
	content?: string;
	reasoning?: string;
}

interface OpenAIChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: OpenAIChoice[];
}

interface OpenAIFinalChoice {
	index: number;
	delta: Record<string, never>;
	finish_reason: string;
}

interface OpenAIFinalChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: OpenAIFinalChoice[];
}

// Type guard functions
function isReasoningData(data: unknown): data is ReasoningData {
	return typeof data === "object" && data !== null && "reasoning" in data;
}

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
			if (chunk.type === "text" && chunk.data && typeof chunk.data === "string") {
				const delta: OpenAIDelta = { content: chunk.data };
				if (firstChunk) {
					delta.role = "assistant";
					firstChunk = false;
				}

				const openAIChunk: OpenAIChunk = {
					id: chatID,
					object: OPENAI_CHAT_COMPLETION_OBJECT,
					created: creationTime,
					model: model,
					choices: [{ index: 0, delta: delta, finish_reason: null }]
				};
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
			} else if (chunk.type === "reasoning" && isReasoningData(chunk.data)) {
				// Handle thinking/reasoning chunks
				const delta: OpenAIDelta = { reasoning: chunk.data.reasoning };

				const openAIChunk: OpenAIChunk = {
					id: chatID,
					object: OPENAI_CHAT_COMPLETION_OBJECT,
					created: creationTime,
					model: model,
					choices: [{ index: 0, delta: delta, finish_reason: null }]
				};
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
			}
			// Note: Usage chunks are not forwarded in this implementation
			// They could be handled here if needed for token counting
		},
		flush(controller) {
			// Send the final chunk with the finish reason.
			const finalChunk: OpenAIFinalChunk = {
				id: chatID,
				object: OPENAI_CHAT_COMPLETION_OBJECT,
				created: creationTime,
				model: model,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
			};
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
		}
	});
}
