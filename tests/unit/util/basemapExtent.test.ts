import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tileDirExtent } from "~/utils/basemap.server";

describe("tileDirExtent", () => {
	it("reads the covered area from the z/x/y listing", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "tiles-"));
		// z1: tiles x 1, y 0 and 1, the eastern half of the world.
		for (const y of [0, 1]) {
			mkdirSync(path.join(dir, "1", "1"), { recursive: true });
			writeFileSync(path.join(dir, "1", "1", `${y}.png`), "");
		}
		const [w, s, e, n] = tileDirExtent(dir) as number[];
		expect(w).toBeCloseTo(0, 6);
		expect(e).toBeCloseTo(180, 6);
		expect(n).toBeCloseTo(85.0511, 3);
		expect(s).toBeCloseTo(-85.0511, 3);
	});

	it("returns null for a directory it cannot read", () => {
		expect(tileDirExtent(path.join(tmpdir(), "no-such-tiles-dir"))).toBeNull();
	});
});
