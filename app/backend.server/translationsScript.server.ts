// The browser's translation dictionary as a cacheable script (Geoportal
// first-paint check, 2026-10-18). It used to be inlined into every page
// and sent again in the root loader data on every navigation (about
// 131 KB for English, twice). Now each language is one file whose URL
// carries a content hash, so the browser fetches it once and reuses it.
import { createHash } from "node:crypto";
import { loadTranslations } from "~/backend.server/translations";
import { createTranslationScript } from "~/frontend/translations";

const built = new Map<string, { body: string; version: string }>();

/** The script for a language, and its content hash. Locale files are read once per process. */
export function translationsScript(lang: string): { body: string; version: string } {
	let hit = built.get(lang);
	if (!hit) {
		const body = createTranslationScript(lang, loadTranslations(lang));
		const version = createHash("sha256").update(body).digest("hex").slice(0, 16);
		hit = { body, version };
		built.set(lang, hit);
	}
	return hit;
}

/** Where the page loads the script from; the hash changes when any string does. */
export function translationsScriptSrc(lang: string): string {
	return `/translations/${encodeURIComponent(lang)}?v=${translationsScript(lang).version}`;
}
