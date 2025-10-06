// --- Google Code Assist API Constants ---
export const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const CODE_ASSIST_API_VERSION = "v1internal";

// --- OAuth2 Configuration ---
export const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
export const OAUTH_CLIENT_SECRET = "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";
export const OAUTH_REFRESH_URL = "https://oauth2.googleapis.com/token";

// --- Token Management ---
export const TOKEN_BUFFER_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds
export const KV_TOKEN_KEY = "oauth_token_cache";

// --- OpenAI API Constants ---
export const OPENAI_CHAT_COMPLETION_OBJECT = "chat.completion.chunk";
export const OPENAI_MODEL_OWNER = "google-gemini-cli";

// --- HTTP Proxy Utilities (Node runtime only) ---
/**
 * Returns an undici ProxyAgent dispatcher when running in Node and a proxy is configured.
 * This is a no-op on non-Node runtimes (e.g., Cloudflare Workers).
 */
export async function getProxyDispatcher(env: Record<string, unknown>, targetUrl: string): Promise<any | undefined> {
        // Only attempt in Node.js
        const isNode = typeof process !== "undefined" && !!(process as any).versions?.node;
        if (!isNode) return undefined;

        try {
                // Resolve proxy and no_proxy from env or process.env
                const envStr = (k: string) => {
                        const v = (env?.[k as keyof typeof env] as string | undefined) || (process.env[k] as string | undefined);
                        return typeof v === "string" && v.trim() ? v.trim() : undefined;
                };

                const urlObj = new URL(targetUrl);
                const isHttps = urlObj.protocol === "https:";
                const noProxy = envStr("NO_PROXY") || envStr("no_proxy");

                if (noProxy && shouldBypassProxy(urlObj.hostname, noProxy)) {
                        return undefined;
                }

                // Prefer protocol-specific, then ALL_PROXY
                const proxyUrl = (isHttps ? envStr("HTTPS_PROXY") || envStr("https_proxy") : envStr("HTTP_PROXY") || envStr("http_proxy"))
                        || envStr("ALL_PROXY")
                        || envStr("all_proxy");

                if (!proxyUrl) return undefined;

                // Dynamically import undici to avoid bundling/worker issues
                const undici: any = await import("undici");
                if (!undici?.ProxyAgent) return undefined;
                return new undici.ProxyAgent(proxyUrl);
        } catch {
                return undefined;
        }
}

function shouldBypassProxy(hostname: string, noProxyList: string): boolean {
        if (!noProxyList) return false;
        // Split by comma, trim spaces
        const rules = noProxyList.split(",").map((r) => r.trim()).filter(Boolean);
        if (rules.includes("*")) return true;
        return rules.some((rule) => {
                if (rule === hostname) return true;
                // Leading dot or domain suffix match
                if (rule.startsWith(".")) {
                        return hostname.endsWith(rule);
                }
                // Host:port handling – ignore port part for comparison of hostname
                const ruleHost = rule.split(":")[0];
                return hostname === ruleHost || hostname.endsWith("." + ruleHost);
        });
}