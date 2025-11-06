import { Env, Account, OAuth2Credentials } from "./types.js";
import * as fs from "fs/promises";
import * as path from "path";
import {
	CODE_ASSIST_ENDPOINT,
	CODE_ASSIST_API_VERSION,
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_REFRESH_URL,
	TOKEN_BUFFER_TIME,
	getProxyDispatcher,
} from "./config.js";

// Auth-related interfaces
interface TokenRefreshResponse {
	access_token: string;
	expires_in: number;
}

interface CachedTokenData {
	access_token: string;
	expiry_date: number;
	cached_at: number;
}

interface TokenCacheInfo {
	cached: boolean;
	cached_at?: string;
	expires_at?: string;
	time_until_expiry_seconds?: number;
	is_expired?: boolean;
	message?: string;
	error?: string;
}

/**
 * Handles OAuth2 authentication and Google Code Assist API communication.
 * Manages multiple accounts, token caching, refreshing, and automatic account switching on quota errors.
 */
export class AuthManager {
	private env: Env;
	private accounts: Account[] = [];
	private currentAccountIndex = 0;
	private accessToken: string | null = null;
	private tokenCache = new Map<string, CachedTokenData>();

	private constructor(env: Env) {
		this.env = env;
	}

	public static async create(env: Env): Promise<AuthManager> {
		const authManager = new AuthManager(env);
		await authManager.loadAccounts();
		if (authManager.accounts.length === 0) {
			// This will be caught by the caller, preventing the server from starting with no accounts.
			throw new Error("Authentication failed: No Google accounts were loaded. Please check accounts.json.");
		}
		return authManager;
	}

	private async loadAccounts(): Promise<void> {
		try {
			const accountsPath = path.join(process.cwd(), "accounts.json");
			const accountsJson = await fs.readFile(accountsPath, "utf-8");
			const parsedAccounts = JSON.parse(accountsJson);

			if (Array.isArray(parsedAccounts) && parsedAccounts.length > 0) {
				this.accounts = parsedAccounts;
				console.log(`Loaded ${this.accounts.length} Google accounts from accounts.json.`);
			} else {
				console.warn("accounts.json is empty or not an array. No accounts loaded.");
			}
		} catch (error: any) {
			if (error && error.code === "ENOENT") {
				console.error(`ERROR: accounts.json not found. It should be in the root directory.`);
			} else {
				console.error("Failed to read or parse accounts.json:", error);
			}
		}
	}

	/**
	 * Switches to the next available account in a round-robin fashion.
	 */
	private switchToNextAccount(): void {
		this.currentAccountIndex = (this.currentAccountIndex + 1) % this.accounts.length;
		this.accessToken = null; // Force re-authentication for the new account
		console.log(`Switched to account index ${this.currentAccountIndex}`);
	}

	/**
	 * Gets the current active account credentials.
	 */
	public getCurrentAccount(): Account {
		return this.accounts[this.currentAccountIndex];
	}

	private getTokenCacheKey(): string {
		return `account_${this.currentAccountIndex}`;
	}

	/**
	 * Initializes authentication for the current account, using cached token if available.
	 */
	public async initializeAuth(): Promise<void> {
		const currentAccount = this.getCurrentAccount();
		if (!currentAccount) {
			throw new Error("No Google account is currently active or available.");
		}

		try {
			// Try to get a cached token from local memory cache
			const cacheKey = this.getTokenCacheKey();
			const cachedTokenData = this.tokenCache.get(cacheKey);

			// Check if cached token is still valid
			if (cachedTokenData) {
				const timeUntilExpiry = cachedTokenData.expiry_date - Date.now();
				if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
					this.accessToken = cachedTokenData.access_token;
					return;
				}
			}

			// Check if the original token from config is still valid
			const timeUntilExpiry = (currentAccount.credentials.expiry_date || 0) - Date.now();
			if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
				this.accessToken = currentAccount.credentials.access_token;
				await this.cacheToken(currentAccount.credentials.access_token, currentAccount.credentials.expiry_date);
				return;
			}

			// If all tokens are expired, refresh
			await this.refreshAndCacheToken(currentAccount.credentials.refresh_token);
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.error(`Failed to initialize authentication for account ${this.currentAccountIndex}:`, e);
			throw new Error("Authentication failed: " + errorMessage);
		}
	}

	/**
	 * Refreshes the OAuth token and caches it.
	 */
	private async refreshAndCacheToken(refreshToken: string): Promise<void> {
		const dispatcher = await getProxyDispatcher(this.env as unknown as Record<string, unknown>, OAUTH_REFRESH_URL);
		const refreshResponse = await fetch(OAUTH_REFRESH_URL, ({
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: OAUTH_CLIENT_ID,
				client_secret: OAUTH_CLIENT_SECRET,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
			}),
			dispatcher,
		}) as any);

		if (!refreshResponse.ok) {
			const debugHeaders: Record<string, string> = {};
			for (const [k, v] of (refreshResponse.headers as any).entries()) {
				const key = String(k).toLowerCase();
				if (key === "retry-after" || key.startsWith("x-ratelimit") || key.startsWith("x-goog-quota") || key === "x-request-id") {
					debugHeaders[key] = String(v);
				}
			}
			const errorText = await refreshResponse.text().catch(() => "");
			console.error("[Auth] Token refresh failed", {
				status: refreshResponse.status,
				statusText: refreshResponse.statusText,
				headers: debugHeaders,
				body: errorText?.slice(0, 4000),
			});
			throw new Error(`Token refresh failed for account ${this.currentAccountIndex}: ${refreshResponse.status}`);
		}

		const refreshData = (await refreshResponse.json()) as TokenRefreshResponse;
		this.accessToken = refreshData.access_token;
		const expiryTime = Date.now() + refreshData.expires_in * 1000;

		await this.cacheToken(refreshData.access_token, expiryTime);
	}

	/**
	 * Caches the access token in the local memory cache.
	 */
	private async cacheToken(accessToken: string, expiryDate: number): Promise<void> {
		const cacheKey = this.getTokenCacheKey();
		const tokenData: CachedTokenData = {
			access_token: accessToken,
			expiry_date: expiryDate,
			cached_at: Date.now(),
		};
		this.tokenCache.set(cacheKey, tokenData);
	}

	/**
	 * Clears the cached token for the current account.
	 */
	public async clearTokenCache(): Promise<void> {
		this.tokenCache.delete(this.getTokenCacheKey());
	}

	/**
	 * Gets cached token info for the current account.
	 */
	public async getCachedTokenInfo(): Promise<TokenCacheInfo> {
		const tokenData = this.tokenCache.get(this.getTokenCacheKey());
		if (!tokenData) {
			return { cached: false, message: `No token found in cache for account ${this.currentAccountIndex}` };
		}

		const timeUntilExpiry = tokenData.expiry_date - Date.now();
		return {
			cached: true,
			cached_at: new Date(tokenData.cached_at).toISOString(),
			expires_at: new Date(tokenData.expiry_date).toISOString(),
			time_until_expiry_seconds: Math.floor(timeUntilExpiry / 1000),
			is_expired: timeUntilExpiry < 0,
		};
	}

	/**
	 * A robust method to call a Code Assist API endpoint with automatic account switching.
	 */
	public async callEndpoint(method: string, body: Record<string, unknown>): Promise<unknown> {
		const totalAccounts = this.accounts.length;

		for (let attempt = 0; attempt < totalAccounts; attempt++) {
			try {
				await this.initializeAuth();

				const endpointUrl = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`;
				const dispatcher = await getProxyDispatcher(this.env as unknown as Record<string, unknown>, endpointUrl);
				const response = await fetch(endpointUrl, ({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.accessToken}`,
					},
					body: JSON.stringify(body),
					dispatcher,
				}) as any);

				if (response.ok) {
					return response.json(); // Success
				}

				// Quota error: switch to the next account and continue the loop
				if (response.status === 429 || response.status == 403) {
					console.log(`Account ${this.currentAccountIndex} quota exceeded. Switching...`);
					this.switchToNextAccount();
					continue;
				}

				// Auth error: try to refresh the token and retry ONCE for the same account
				if (response.status === 401) {
					const debugHeaders: Record<string, string> = {};
					for (const [k, v] of (response.headers as any).entries()) {
						const key = String(k).toLowerCase();
						if (key === "retry-after" || key.startsWith("x-ratelimit") || key.startsWith("x-goog-quota") || key === "x-request-id") {
							debugHeaders[key] = String(v);
						}
					}
					const errText = await response.text().catch(() => "");
					console.warn("[Auth] 401 on callEndpoint", {
						status: response.status,
						statusText: response.statusText,
						headers: debugHeaders,
						body: errText?.slice(0, 2000),
					});
					console.log(`Account ${this.currentAccountIndex} auth token expired. Refreshing and retrying...`);
					this.accessToken = null;
					await this.clearTokenCache();
					await this.initializeAuth(); // This will refresh

					const retryEndpointUrl = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`;
					const retryDispatcher = await getProxyDispatcher(this.env as unknown as Record<string, unknown>, retryEndpointUrl);
					const retryResponse = await fetch(retryEndpointUrl, ({
						method: "POST",
						headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
						body: JSON.stringify(body),
						dispatcher: retryDispatcher,
					}) as any);

					if (retryResponse.ok) {
						return retryResponse.json(); // Success on retry
					}
				}

				// For any other persistent error with this account, throw to be caught and trigger switch
				const debugHeaders2: Record<string, string> = {};
				for (const [k, v] of (response.headers as any).entries()) {
					const key = String(k).toLowerCase();
					if (
						key === "retry-after" ||
						key.startsWith("x-ratelimit") ||
						key.startsWith("x-goog-quota") ||
						key === "x-request-id" ||
						key === "x-error-code" ||
						key === "x-error-message"
					) {
						debugHeaders2[key] = String(v);
					}
				}
				const errorText = await response.text().catch(() => "");
				console.error("[Auth] API call failed", {
					status: response.status,
					statusText: response.statusText,
					headers: debugHeaders2,
					body: errorText?.slice(0, 4000),
				});
				throw new Error(`API call failed with status ${response.status}`);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`An error occurred with account ${this.currentAccountIndex}: ${errorMessage}. Switching to next account.`);
				this.switchToNextAccount();
			}
		}

		// If the loop completes, all accounts have been tried and failed
		throw new Error("All available Google accounts have failed. Please check their quotas and credentials.");
	}

	/**
	 * Get the current access token.
	 */
	public getAccessToken(): string | null {
		return this.accessToken;
	}
}
