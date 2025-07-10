/**
 * Constants for the Gemini CLI OpenAI Worker
 */

// Static reasoning messages for thinking models
export const REASONING_MESSAGES = [
	'🔍 **Analyzing the request: "{requestPreview}"**\n\n',
	"🤔 Let me think about this step by step... ",
	"💭 I need to consider the context and provide a comprehensive response. ",
	"🎯 Based on my understanding, I should address the key points while being accurate and helpful. ",
	"✨ Let me formulate a clear and structured answer.\n\n"
];

// Default reasoning delay between chunks (in milliseconds)
export const REASONING_CHUNK_DELAY = 100;

// Default chunk size for streaming thinking content (in characters)
// This controls how many characters are sent per chunk when streaming thinking content
// Smaller values create smoother streaming but more network requests
export const THINKING_CONTENT_CHUNK_SIZE = 15;

// Thinking budget constants
export const DEFAULT_THINKING_BUDGET = -1; // -1 means dynamic allocation by Gemini (recommended)
export const DISABLED_THINKING_BUDGET = 0; // 0 disables thinking entirely

// Generation config defaults
export const DEFAULT_TEMPERATURE = 0.7;

// Auto model switching configuration
export const AUTO_SWITCH_MODEL_MAP = {
	"gemini-2.5-pro": "gemini-2.5-flash"
} as const;

// HTTP status codes for rate limiting
export const RATE_LIMIT_STATUS_CODES = [429, 503] as const;
