// The translation dictionary is a cached, versioned script, not inline page
// data (Geoportal first-paint check, 2026-10-18).
import { describe, expect, it } from "vitest";
import { translationsScript, translationsScriptSrc } from "~/backend.server/translationsScript.server";
import { loader } from "~/routes/translations+/$lang";

const call = (lang: string, v?: string, etag?: string) =>
	loader({
		params: { lang },
		request: new Request(`http://x/translations/${lang}${v ? `?v=${v}` : ""}`, {
			headers: etag ? { "If-None-Match": etag } : {},
		}),
	} as never) as Promise<Response>;

describe("translation script", () => {
	it("defines the dictionary and the getter, with a stable content hash", () => {
		const a = translationsScript("en");
		expect(a.body).toContain("window.DTS_TRANSLATIONS = ");
		expect(a.body).toContain("globalThis.createTranslationGetter");
		expect(a.version).toMatch(/^[0-9a-f]{16}$/);
		expect(translationsScript("en").version).toBe(a.version);
		expect(translationsScript("fr").version).not.toBe(a.version);
		expect(translationsScriptSrc("en")).toBe(`/translations/en?v=${a.version}`);
	});

	it("caches the versioned URL for a year and revalidates any other", async () => {
		const { version } = translationsScript("en");
		const pinned = await call("en", version);
		expect(pinned.status).toBe(200);
		expect(pinned.headers.get("Content-Type")).toContain("text/javascript");
		expect(pinned.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		expect((await call("en", "stale")).headers.get("Cache-Control")).toBe("no-cache");
		expect((await call("en", undefined, `"${version}"`)).status).toBe(304);
	});

	it("refuses an unknown language", async () => {
		await expect(call("xx")).rejects.toMatchObject({ status: 404 });
	});
});
