import { createHash } from "crypto";

/**
 * Security utility functions for input sanitization and validation
 */

/**
 * Sanitizes input strings to prevent XSS and SQL injection
 * @param input - The input string to sanitize
 * @returns The sanitized string or null if input is null
 */
export function sanitizeInput(input: string | null): string | null {
	if (input === null) return null;

	// Remove any HTML tags
	input = input.replace(/<[^>]*>/g, "");

	// Remove SQL injection patterns
	input = input.replace(/['";]/g, "");

	// Trim whitespace
	input = input.trim();

	return input;
}

/**
 * In-process fixed-window rate limiter, applied by securityHeadersMiddleware.
 * It is a second line behind the edge (Cloudflare or Azure Front Door); each
 * app instance keeps its own counts.
 *
 * Environment (all optional; the limiter is off unless enabled):
 * - RATE_LIMIT_ENABLED=true
 * - RATE_LIMIT_MAX: requests per window per client (default 300)
 * - RATE_LIMIT_WINDOW_MS: window length (default 60000)
 * - RATE_LIMIT_CLIENT_IP_HEADER: header the trusted proxy sets, for example
 *   cf-connecting-ip or x-forwarded-for. Without it, only API-key requests are
 *   limited, because any client can forge a forwarding header.
 * - RATE_LIMIT_TRUSTED_PROXY_HOPS: for x-forwarded-for, how many trusted
 *   proxies append to it (default 1). The client is that many entries from the right.
 */
export interface RateLimitConfig {
	enabled: boolean;
	max: number;
	windowMs: number;
	clientIpHeader?: string;
	trustedProxyHops: number;
}

export interface RateLimitResult {
	allowed: boolean;
	retryAfterSeconds: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function rateLimitConfigFromEnv(
	env: Record<string, string | undefined> = process.env,
): RateLimitConfig {
	return {
		enabled: env.RATE_LIMIT_ENABLED === "true",
		max: positiveInt(env.RATE_LIMIT_MAX, 300),
		windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
		clientIpHeader: env.RATE_LIMIT_CLIENT_IP_HEADER?.toLowerCase() || undefined,
		trustedProxyHops: positiveInt(env.RATE_LIMIT_TRUSTED_PROXY_HOPS, 1),
	};
}

// Paths worth protecting: the API and the sign-in and password flows.
export function isRateLimitedPath(pathname: string): boolean {
	return (
		/^\/[^/]+\/api(\/|$)/.test(pathname) ||
		/\/user\/(login|forgot-password|reset-password|verify-email)/.test(pathname)
	);
}

export function rateLimitKey(
	request: Request,
	config: RateLimitConfig,
): string | null {
	const apiKey = request.headers.get("X-Auth");
	if (apiKey) {
		// Never keep the raw key in memory longer than needed.
		return "key:" + createHash("sha256").update(apiKey).digest("hex");
	}
	if (!config.clientIpHeader) return null;
	const raw = request.headers.get(config.clientIpHeader);
	if (!raw) return null;
	if (config.clientIpHeader === "x-forwarded-for") {
		const hops = raw.split(",").map((part) => part.trim()).filter(Boolean);
		const ip = hops[hops.length - config.trustedProxyHops];
		return ip ? "ip:" + ip : null;
	}
	return "ip:" + raw.trim();
}

const buckets = new Map<string, { count: number; resetTime: number }>();

export function resetRateLimitForTest(): void {
	buckets.clear();
}

export function checkRateLimit(
	request: Request,
	config: RateLimitConfig,
	now: number = Date.now(),
): RateLimitResult {
	const allowed = { allowed: true, retryAfterSeconds: 0 };
	if (!config.enabled) return allowed;
	if (!isRateLimitedPath(new URL(request.url).pathname)) return allowed;
	const key = rateLimitKey(request, config);
	if (!key) return allowed;

	let bucket = buckets.get(key);
	if (!bucket || now >= bucket.resetTime) {
		bucket = { count: 0, resetTime: now + config.windowMs };
		buckets.set(key, bucket);
	}
	bucket.count++;

	// Drop expired buckets now and then so memory stays bounded.
	if (buckets.size > 10_000) {
		for (const [k, v] of buckets) {
			if (now >= v.resetTime) buckets.delete(k);
		}
	}

	if (bucket.count <= config.max) return allowed;
	return {
		allowed: false,
		retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetTime - now) / 1000)),
	};
}
