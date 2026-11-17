import { describe, expect, it } from "vitest";
import { isStaleChunkError, shouldReloadForStaleChunk } from "~/utils/staleChunk";

describe("stale code after a redeploy (Alex, 2026-10-21)", () => {
	it("recognises a failed module load in Chrome, Firefox and Safari, and nothing else", () => {
		expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: http://x/assets/route-abc.js"))).toBe(true);
		expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
		expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
		expect(isStaleChunkError(new Error("Failed query: SELECT 1"))).toBe(false);
		expect(isStaleChunkError({ status: 404 })).toBe(false);
	});

	it("reloads once per 10 seconds at most, so a real error never loops", () => {
		const store = new Map<string, string>();
		const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
		expect(shouldReloadForStaleChunk(storage, 100_000)).toBe(true);
		expect(shouldReloadForStaleChunk(storage, 105_000)).toBe(false);
		expect(shouldReloadForStaleChunk(storage, 111_000)).toBe(true);
		expect(shouldReloadForStaleChunk(null, 200_000)).toBe(false);
	});
});
