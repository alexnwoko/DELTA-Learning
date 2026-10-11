/**
 * Root middleware that sets security headers on every response the router
 * produces: documents, data requests, API resource routes and redirects.
 * Registered from `app/root.tsx`. React Router 8 always runs middleware.
 *
 * Environment:
 * - CSP_MODE: "report-only" (default), "enforce" or "off".
 * - CSP_REPORT_URI: where browsers send violation reports (default /csp-report).
 * - HSTS_ENABLED: "true" to send HSTS outside production (default: production only).
 * - RATE_LIMIT_*: see app/utils/security.ts. Off unless RATE_LIMIT_ENABLED=true.
 */

import { checkRateLimit, rateLimitConfigFromEnv } from "~/utils/security";

type MiddlewareArgs = { request: Request };
type MiddlewareNext = () => Response | Promise<Response>;

// Runtime origins the pages load today. Leaflet and leaflet-draw still come
// from unpkg and cdnjs until the Frontend lane self-hosts them; remove those
// origins then.
const SCRIPT_ORIGINS = [
	"https://unpkg.com",
	"https://cdnjs.cloudflare.com",
	"https://*.preventionweb.net",
	"https://static.cloudflareinsights.com",
];
const STYLE_ORIGINS = [
	"https://unpkg.com",
	"https://cdnjs.cloudflare.com",
	"https://*.preventionweb.net",
];
const IMG_ORIGINS = [
	"https://*.preventionweb.net",
	"https://*.basemaps.cartocdn.com",
	"https://tile.openstreetmap.org",
	"https://*.tile.openstreetmap.org",
	"https://unpkg.com",
	"https://cdnjs.cloudflare.com",
];
const CONNECT_ORIGINS = [
	"https://nominatim.openstreetmap.org",
	"https://*.preventionweb.net",
	"https://data.undrr.org",
	"https://cloudflareinsights.com",
	"https://unb2c.b2clogin.com",
	"https://*.b2clogin.com",
];
const B2C_ORIGINS = ["https://unb2c.b2clogin.com", "https://*.b2clogin.com"];

export function buildContentSecurityPolicy(options: {
	reportUri: string;
	isDevelopment: boolean;
}): string {
	// React Router inlines its hydration script, so 'unsafe-inline' stays until
	// the pages carry a nonce. Report-Only mode shows what else would break.
	const connect = ["'self'", ...CONNECT_ORIGINS];
	if (options.isDevelopment) connect.push("ws:", "wss:");
	const directives = [
		"default-src 'self'",
		`script-src 'self' 'unsafe-inline' blob: ${SCRIPT_ORIGINS.join(" ")}`,
		`style-src 'self' 'unsafe-inline' ${STYLE_ORIGINS.join(" ")}`,
		`img-src 'self' data: blob: ${IMG_ORIGINS.join(" ")}`,
		"font-src 'self' data: https://cdnjs.cloudflare.com https://unpkg.com",
		`connect-src ${connect.join(" ")}`,
		"worker-src 'self' blob:",
		`frame-src 'self' ${B2C_ORIGINS.join(" ")}`,
		`form-action 'self' ${B2C_ORIGINS.join(" ")}`,
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'self'",
		`report-uri ${options.reportUri}`,
	];
	return directives.join("; ");
}

export function applySecurityHeaders(
	headers: Headers,
	request: Request,
	env: Record<string, string | undefined> = process.env,
): void {
	const isProduction = env.NODE_ENV === "production";

	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Frame-Options", "SAMEORIGIN");
	headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	headers.set(
		"Permissions-Policy",
		"geolocation=(self), microphone=(), camera=(), fullscreen=(self), payment=()",
	);
	// The legacy XSS auditor is removed from browsers and could be abused; OWASP advises 0.
	headers.set("X-XSS-Protection", "0");
	headers.delete("X-Powered-By");

	if (isProduction || env.HSTS_ENABLED === "true") {
		headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}

	const cspMode = env.CSP_MODE ?? "report-only";
	if (cspMode !== "off") {
		const policy = buildContentSecurityPolicy({
			reportUri: env.CSP_REPORT_URI ?? "/csp-report",
			isDevelopment: env.NODE_ENV === "development",
		});
		headers.set(
			cspMode === "enforce"
				? "Content-Security-Policy"
				: "Content-Security-Policy-Report-Only",
			policy,
		);
	}

	// API responses carry tenant data; never let a shared cache keep them.
	if (isApiPath(new URL(request.url).pathname) && !headers.has("Cache-Control")) {
		headers.set("Cache-Control", "no-store");
	}
}

export function isApiPath(pathname: string): boolean {
	return /^\/[^/]+\/api(\/|$)/.test(pathname) || pathname.startsWith("/api/");
}

// Response.redirect() and fetch() responses have immutable headers.
function withMutableHeaders(response: Response): Response {
	try {
		response.headers.set("X-Content-Type-Options", "nosniff");
		return response;
	} catch {
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers),
		});
	}
}

export const securityHeadersMiddleware = async (
	{ request }: MiddlewareArgs,
	next: MiddlewareNext,
) => {
	const limit = checkRateLimit(request, rateLimitConfigFromEnv());
	if (!limit.allowed) {
		const limited = new Response("Too Many Requests", {
			status: 429,
			headers: { "Retry-After": String(limit.retryAfterSeconds) },
		});
		applySecurityHeaders(limited.headers, request);
		return limited;
	}

	const response = withMutableHeaders(await next());
	applySecurityHeaders(response.headers, request);
	return response;
};
