import { Env, OAuth2Credentials } from "./types";
import {
	CODE_ASSIST_ENDPOINT,
	CODE_ASSIST_API_VERSION,
	OAUTH_CLIENT_ID,
	OAUTH_CLIENT_SECRET,
	OAUTH_REFRESH_URL,
	TOKEN_BUFFER_TIME,
	KV_TOKEN_KEY
} from "./config";

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
	private accounts: OAuth2Credentials[] = [];
	private currentAccountIndex = 0;
	private accessToken: string | null = null;

	constructor(env: Env) {
		this.env = env;
		this.loadAccounts();
	}

	/**
	 * Loads accounts from environment variables.
	 * Prioritizes GOOGLE_ACCOUNTS_JSON, falls back to GCP_SERVICE_ACCOUNT for backward compatibility.
	 */
	private loadAccounts(): void {
		if (this.env.GOOGLE_ACCOUNTS_JSON) {
			try {
				const parsedAccounts = JSON.parse(this.env.GOOGLE_ACCOUNTS_JSON);
				if (Array.isArray(parsedAccounts) && parsedAccounts.length > 0) {
					this.accounts = parsedAccounts;
					console.log(`Loaded ${this.accounts.length} Google accounts.`);
					return;
				}
			} catch (e) {
				throw new Error("Failed to parse GOOGLE_ACCOUNTS_JSON. Please ensure it's a valid JSON array.");
			}
		}

		if (this.env.GCP_SERVICE_ACCOUNT) {
			try {
				this.accounts = [JSON.parse(this.env.GCP_SERVICE_ACCOUNT)];
				console.log("Loaded 1 Google account from deprecated GCP_SERVICE_ACCOUNT.");
				return;
			} catch (e) {
				throw new Error("Failed to parse GCP_SERVICE_ACCOUNT. Please ensure it's valid JSON.");
			}
		}

		if (this.accounts.length === 0) {
			throw new Error("No Google account credentials found. Please set GOOGLE_ACCOUNTS_JSON or GCP_SERVICE_ACCOUNT.");
		}
	}

	/**
	 * Gets the KV store key for the current account's token.
	 */
	private getKvTokenKey(): string {
		return `${KV_TOKEN_KEY}_${this.currentAccountIndex}`;
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
	private getCurrentAccount(): OAuth2Credentials {
		return this.accounts[this.currentAccountIndex];
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
			// Try to get a cached token from KV storage
			const kvKey = this.getKvTokenKey();
			const cachedToken = await this.env.GEMINI_CLI_KV.get(kvKey, "json");
			const cachedTokenData = cachedToken ? (cachedToken as CachedTokenData) : null;

			// Check if cached token is still valid
			if (cachedTokenData) {
				const timeUntilExpiry = cachedTokenData.expiry_date - Date.now();
				if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
					this.accessToken = cachedTokenData.access_token;
					return;
				}
			}

			// Check if the original token from config is still valid
			const timeUntilExpiry = (currentAccount.expiry_date || 0) - Date.now();
			if (timeUntilExpiry > TOKEN_BUFFER_TIME) {
				this.accessToken = currentAccount.access_token;
				await this.cacheTokenInKV(currentAccount.access_token, currentAccount.expiry_date);
				return;
			}

			// If all tokens are expired, refresh
			await this.refreshAndCacheToken(currentAccount.refresh_token);
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
		const refreshResponse = await fetch(OAUTH_REFRESH_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: OAUTH_CLIENT_ID,
				client_secret: OAUTH_CLIENT_SECRET,
				refresh_token: refreshToken,
				grant_type: "refresh_token"
			})
		});

		if (!refreshResponse.ok) {
			const errorText = await refreshResponse.text();
			throw new Error(`Token refresh failed for account ${this.currentAccountIndex}: ${errorText}`);
		}

		const refreshData = (await refreshResponse.json()) as TokenRefreshResponse;
		this.accessToken = refreshData.access_token;
		const expiryTime = Date.now() + refreshData.expires_in * 1000;

		await this.cacheTokenInKV(refreshData.access_token, expiryTime);
	}

	/**
	 * Caches the access token in KV storage for the current account.
	 */
	private async cacheTokenInKV(accessToken: string, expiryDate: number): Promise<void> {
		const kvKey = this.getKvTokenKey();
		const tokenData = {
			access_token: accessToken,
			expiry_date: expiryDate,
			cached_at: Date.now()
		};
		const ttlSeconds = Math.floor((expiryDate - Date.now()) / 1000) - 300;

		if (ttlSeconds > 0) {
			await this.env.GEMINI_CLI_KV.put(kvKey, JSON.stringify(tokenData), {
				expirationTtl: ttlSeconds
			});
		}
	}

	/**
	 * Clears the cached token for the current account.
	 */
	public async clearTokenCache(): Promise<void> {
		await this.env.GEMINI_CLI_KV.delete(this.getKvTokenKey());
	}

	/**
	 * Gets cached token info for the current account.
	 */
	public async getCachedTokenInfo(): Promise<TokenCacheInfo> {
		const cachedToken = await this.env.GEMINI_CLI_KV.get(this.getKvTokenKey(), "json");
		if (!cachedToken) {
			return { cached: false, message: `No token found in cache for account ${this.currentAccountIndex}` };
		}

		const tokenData = cachedToken as CachedTokenData;
		const timeUntilExpiry = tokenData.expiry_date - Date.now();
		return {
			cached: true,
			cached_at: new Date(tokenData.cached_at).toISOString(),
			expires_at: new Date(tokenData.expiry_date).toISOString(),
			time_until_expiry_seconds: Math.floor(timeUntilExpiry / 1000),
			is_expired: timeUntilExpiry < 0
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

				const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.accessToken}`
					},
					body: JSON.stringify(body)
				});

				if (response.ok) {
					return response.json(); // Success
				}

				// Quota error: switch to the next account and continue the loop
				if (response.status === 429) {
					console.log(`Account ${this.currentAccountIndex} quota exceeded. Switching...`);
					this.switchToNextAccount();
					continue;
				}

				// Auth error: try to refresh the token and retry ONCE for the same account
				if (response.status === 401) {
					console.log(`Account ${this.currentAccountIndex} auth token expired. Refreshing and retrying...`);
					this.accessToken = null;
					await this.clearTokenCache();
					await this.initializeAuth(); // This will refresh

					const retryResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`, {
						method: "POST",
						headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
						body: JSON.stringify(body)
					});

					if (retryResponse.ok) {
						return retryResponse.json(); // Success on retry
					}
				}

				// For any other persistent error with this account, throw to be caught and trigger switch
				const errorText = await response.text();
				throw new Error(`API call failed with status ${response.status}: ${errorText}`);
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
