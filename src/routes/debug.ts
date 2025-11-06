import { Hono } from "hono";
import { Env } from "../types.js";
import { AuthManager } from "../auth.js";
import { GeminiApiClient } from "../gemini-client.js";

/**
 * Debug and testing routes for troubleshooting authentication and API functionality.
 */
export const DebugRoute = new Hono<{ Bindings: Env }>();

// Check KV cache status
DebugRoute.get("/cache", async (c) => {
	try {
		const authManager = await AuthManager.create(c.env);
		const cacheInfo = await authManager.getCachedTokenInfo();

		// Remove sensitive information from the response
		const sanitizedInfo = {
			status: "ok",
			cached: cacheInfo.cached,
			cached_at: cacheInfo.cached_at,
			expires_at: cacheInfo.expires_at,
			time_until_expiry_seconds: cacheInfo.time_until_expiry_seconds,
			is_expired: cacheInfo.is_expired,
			message: cacheInfo.message
			// Explicitly exclude token_preview and any other sensitive data
		};

		return c.json(sanitizedInfo);
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		return c.json(
			{
				status: "error",
				message: errorMessage
			},
			500
		);
	}
});

// Simple token test endpoint
DebugRoute.post("/token-test", async (c) => {
	try {
		console.log("Token test endpoint called");
		const authManager = await AuthManager.create(c.env);

		// Test authentication only
		await authManager.initializeAuth();
		console.log("Token test passed");

		return c.json({
			status: "ok",
			message: "Token authentication successful"
		});
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Token test error:", e);
		return c.json(
			{
				status: "error",
				message: errorMessage
				// Removed stack trace for security
			},
			500
		);
	}
});

// Full functionality test endpoint
DebugRoute.post("/test", async (c) => {
	try {
		console.log("Test endpoint called");
		const geminiClient = await GeminiApiClient.create(c.env);

		// Test authentication - it's done implicitly by create methods
		console.log("Auth test passed");

		// Test project discovery
		const projectId = await geminiClient.discoverProjectId();
		console.log("Project discovery test passed");

		return c.json({
			status: "ok",
			message: "Authentication and project discovery successful",
			project_available: !!projectId
			// Removed actual projectId for security
		});
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Test endpoint error:", e);
		return c.json(
			{
				status: "error",
				message: errorMessage
				// Removed stack trace and detailed error message for security
			},
			500
		);
	}
});
