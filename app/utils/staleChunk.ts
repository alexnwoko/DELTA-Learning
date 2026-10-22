// A page opened before the app was redeployed or the dev server restarted
// asks for route code that no longer exists when the reader clicks to
// another page; the browser then fails the module import and the reader
// sees an error (Alex, 2026-10-21: Analysis to Geoportal and back). The
// root error boundary reloads the page once when that is the cause.
// Pure module: safe in server and client code.

const STALE_CHUNK_MESSAGES = [
	"Failed to fetch dynamically imported module", // Chrome
	"error loading dynamically imported module", // Firefox
	"Importing a module script failed", // Safari
	"Unable to preload CSS",
];

/** True when the error is a failed load of the app's own code, not a page error. */
export function isStaleChunkError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return STALE_CHUNK_MESSAGES.some((m) => message.includes(m));
}

const RELOAD_KEY = "delta-stale-chunk-reload";
/** One reload per 10 s at most, so a real error can never loop. */
const RELOAD_WINDOW_MS = 10_000;

/** Whether to reload now, and remembers that it did; false when storage is unusable. */
export function shouldReloadForStaleChunk(storage: Pick<Storage, "getItem" | "setItem"> | null, now: number): boolean {
	if (!storage) return false;
	try {
		const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
		if (now - last < RELOAD_WINDOW_MS) return false;
		storage.setItem(RELOAD_KEY, String(now));
		return true;
	} catch {
		return false;
	}
}
