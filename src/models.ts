import { ModelInfo } from './types';

// --- Gemini CLI Models Configuration ---
export const geminiCliModels: Record<string, ModelInfo> = {
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

// --- Default Model ---
export const DEFAULT_MODEL = 'gemini-2.5-flash';

// --- Helper Functions ---
export function getModelInfo(modelId: string): ModelInfo | null {
    return geminiCliModels[modelId] || null;
}

export function getAllModelIds(): string[] {
    return Object.keys(geminiCliModels);
}

export function isValidModel(modelId: string): boolean {
    return modelId in geminiCliModels;
}
