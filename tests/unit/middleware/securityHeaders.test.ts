import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	applySecurityHeaders,
	securityHeadersMiddleware,
} from "~/middleware/securityHeaders.server";
import {
	checkRateLimit,
	rateLimitConfigFromEnv,
	resetRateLimitForTest,
} from "~/utils/security";
import { middleware } from "~/root";

// Platform security item 3: no HSTS, no CSP outside the Vite dev server, no
// headers on API responses, and an unused rate limiter that trusted a
// client-supplied x-forwarded-for header.

function req(path: string, headers: Record<string, string> = {}) {
	return new Request(`http://localhost${path}`, { headers });
}

describe("security headers middleware", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is registered first in the root middleware chain", () => {
		expect(middleware[0]).toBe(securityHeadersMiddleware);
	});

	it("sets headers and a Report-Only CSP on an API response", async () => {
		const res = await securityHeadersMiddleware(
			{ request: req("/en/api/disaster-record/list") },
			() => Response.json({ ok: true }),
		);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
		expect(res.headers.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(res.headers.get("Content-Security-Policy")).toBeNull();
		const csp = res.headers.get("Content-Security-Policy-Report-Only") ?? "";
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("frame-ancestors 'self'");
		expect(csp).toContain("report-uri /csp-report");
		expect(csp).toContain("https://*.b2clogin.com");
		expect(csp).toContain("https://unpkg.com");
	});

	it("sets headers on a redirect, whose headers are immutable", async () => {
		const res = await securityHeadersMiddleware(
			{ request: req("/en/user/login") },
			() => Response.redirect("http://localhost/en/", 302),
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("http://localhost/en/");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
	});

	it("keeps a Cache-Control header that a document already set", () => {
		const headers = new Headers({ "Cache-Control": "private, max-age=60" });
		applySecurityHeaders(headers, req("/en/api/x"), {});
		expect(headers.get("Cache-Control")).toBe("private, max-age=60");
	});

	it("sends HSTS in production only, unless HSTS_ENABLED is set", () => {
		const dev = new Headers();
		applySecurityHeaders(dev, req("/en/"), { NODE_ENV: "development" });
		expect(dev.get("Strict-Transport-Security")).toBeNull();

		const prod = new Headers();
		applySecurityHeaders(prod, req("/en/"), { NODE_ENV: "production" });
		expect(prod.get("Strict-Transport-Security")).toBe(
			"max-age=31536000; includeSubDomains",
		);

		const flagged = new Headers();
		applySecurityHeaders(flagged, req("/en/"), { HSTS_ENABLED: "true" });
		expect(flagged.get("Strict-Transport-Security")).toBeTruthy();
	});

	it("enforces the CSP only when CSP_MODE=enforce, and omits it when off", () => {
		const enforced = new Headers();
		applySecurityHeaders(enforced, req("/en/"), { CSP_MODE: "enforce" });
		expect(enforced.get("Content-Security-Policy")).toContain("default-src 'self'");
		expect(enforced.get("Content-Security-Policy-Report-Only")).toBeNull();

		const off = new Headers();
		applySecurityHeaders(off, req("/en/"), { CSP_MODE: "off" });
		expect(off.get("Content-Security-Policy")).toBeNull();
		expect(off.get("Content-Security-Policy-Report-Only")).toBeNull();
	});

	it("allows WebSocket connections for Vite only in development", () => {
		const dev = new Headers();
		applySecurityHeaders(dev, req("/en/"), { NODE_ENV: "development" });
		expect(dev.get("Content-Security-Policy-Report-Only")).toContain("ws:");

		const prod = new Headers();
		applySecurityHeaders(prod, req("/en/"), { NODE_ENV: "production" });
		expect(prod.get("Content-Security-Policy-Report-Only")).not.toContain("ws:");
	});

	it("removes X-Powered-By and disables the legacy XSS auditor", () => {
		const headers = new Headers({ "X-Powered-By": "Express" });
		applySecurityHeaders(headers, req("/en/"), {});
		expect(headers.get("X-Powered-By")).toBeNull();
		expect(headers.get("X-XSS-Protection")).toBe("0");
	});
});

describe("rate limiter", () => {
	beforeEach(() => {
		resetRateLimitForTest();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const enabled = (extra: Record<string, string> = {}) =>
		rateLimitConfigFromEnv({
			RATE_LIMIT_ENABLED: "true",
			RATE_LIMIT_MAX: "2",
			RATE_LIMIT_WINDOW_MS: "60000",
			...extra,
		});

	it("is off unless RATE_LIMIT_ENABLED=true", () => {
		const config = rateLimitConfigFromEnv({});
		for (let i = 0; i < 5; i++) {
			expect(
				checkRateLimit(req("/en/api/x", { "X-Auth": "k" }), config).allowed,
			).toBe(true);
		}
	});

	it("limits API requests per API key and reports Retry-After", () => {
		const config = enabled();
		const r = () => req("/en/api/x", { "X-Auth": "key-a" });
		expect(checkRateLimit(r(), config, 1000).allowed).toBe(true);
		expect(checkRateLimit(r(), config, 1000).allowed).toBe(true);
		const third = checkRateLimit(r(), config, 1000);
		expect(third.allowed).toBe(false);
		expect(third.retryAfterSeconds).toBe(60);
		expect(
			checkRateLimit(req("/en/api/x", { "X-Auth": "key-b" }), config, 1000)
				.allowed,
		).toBe(true);
		expect(checkRateLimit(r(), config, 61_001).allowed).toBe(true);
	});

	it("ignores a client-supplied x-forwarded-for unless a trusted header is configured", () => {
		const config = enabled();
		for (let i = 0; i < 5; i++) {
			const forged = req("/en/user/login", { "x-forwarded-for": "1.2.3.4" });
			expect(checkRateLimit(forged, config, 1000).allowed).toBe(true);
		}
	});

	it("takes the client from the right of x-forwarded-for, past the trusted proxy", () => {
		const config = enabled({ RATE_LIMIT_CLIENT_IP_HEADER: "x-forwarded-for" });
		// The client forges a new left-most entry each time; the proxy appends the real one.
		for (let i = 0; i < 2; i++) {
			const r = req("/en/user/login", {
				"x-forwarded-for": `10.0.0.${i}, 203.0.113.9`,
			});
			expect(checkRateLimit(r, config, 1000).allowed).toBe(true);
		}
		const r = req("/en/user/login", { "x-forwarded-for": "10.0.0.99, 203.0.113.9" });
		expect(checkRateLimit(r, config, 1000).allowed).toBe(false);
	});

	it("does not limit ordinary pages", () => {
		const config = enabled({ RATE_LIMIT_CLIENT_IP_HEADER: "cf-connecting-ip" });
		for (let i = 0; i < 5; i++) {
			const r = req("/en/disaster-event/abc", { "cf-connecting-ip": "203.0.113.9" });
			expect(checkRateLimit(r, config, 1000).allowed).toBe(true);
		}
	});

	it("answers 429 with Retry-After and security headers through the middleware", async () => {
		vi.stubEnv("RATE_LIMIT_ENABLED", "true");
		vi.stubEnv("RATE_LIMIT_MAX", "1");
		const call = () =>
			securityHeadersMiddleware(
				{ request: req("/en/api/x", { "X-Auth": "key-c" }) },
				() => Response.json({ ok: true }),
			);
		expect((await call()).status).toBe(200);
		const limited = await call();
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(limited.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
});
