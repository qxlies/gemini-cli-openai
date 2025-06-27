// --- Environment Variable Typings ---
export interface Env {
	GCP_SERVICE_ACCOUNT: string; // Now contains OAuth2 credentials JSON
	GEMINI_PROJECT_ID?: string;
	GEMINI_CLI_KV: KVNamespace; // Cloudflare KV for token caching
}

// --- OAuth2 Credentials Interface ---
export interface OAuth2Credentials {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
    id_token: string;
    expiry_date: number;
}

// --- Model Information Interface ---
export interface ModelInfo {
    maxTokens: number;
    contextWindow: number;
    supportsImages: boolean;
    supportsPromptCache: boolean;
    inputPrice: number;
    outputPrice: number;
    description: string;
}

// --- Chat Completion Request Interface ---
export interface ChatCompletionRequest {
    model: string;
    messages: { role: string; content: string }[];
}

// --- Stream Chunk Types ---
export interface StreamChunk {
    type: 'text' | 'usage';
    data: any;
}
