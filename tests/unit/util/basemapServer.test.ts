import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	basemapConfig,
	parseTileAddress,
	readTile,
} from "~/utils/basemap.server";
import { BASEMAP_MAX_ZOOM } from "~/utils/basemap";

// I-3: basemap tiles are files on the DELTA origin (TR-166, SEC-20). The
// route must never name a file outside the tile tree, and the maps must
// never be offered a tile host on another origin.

describe("parseTileAddress", () => {
	it("accepts a tile inside the grid and the zoom range", () => {
		expect(parseTileAddress("3", "5", "2.png")).toEqual({
			z: 3,
			x: 5,
			y: 2,
			ext: "png",
		});
		expect(parseTileAddress("0", "0", "0.webp")?.ext).toBe("webp");
	});

	it("refuses anything that is not a tile", () => {
		for (const [z, x, y] of [
			["3", "8", "0.png"], // x outside the 8x8 grid
			["3", "0", "8.png"],
			[String(BASEMAP_MAX_ZOOM + 1), "0", "0.png"],
			["-1", "0", "0.png"],
			["3", "..", "0.png"],
			["3", "0", "../../etc/passwd"],
			["3", "0", "0.svg"],
			["3", "0", "0"],
			[undefined, "0", "0.png"],
		]) {
			expect(parseTileAddress(z, x, y)).toBeNull();
		}
	});
});

describe("readTile", () => {
	let dir = "";
	afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

	it("reads a tile from the tree and reports a missing one as null", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "tiles-"));
		mkdirSync(path.join(dir, "2", "1"), { recursive: true });
		writeFileSync(
			path.join(dir, "2", "1", "3.png"),
			Buffer.from([137, 80, 78, 71]),
		);
		const hit = await readTile({ z: 2, x: 1, y: 3, ext: "png" }, dir);
		expect(hit?.type).toBe("image/png");
		expect(hit?.body.length).toBe(4);
		expect(await readTile({ z: 2, x: 1, y: 2, ext: "png" }, dir)).toBeNull();
		expect(await readTile({ z: 2, x: 1, y: 3, ext: "png" }, null)).toBeNull();
	});
});

describe("basemapConfig", () => {
	const saved = { ...process.env };
	afterEach(() => {
		process.env = { ...saved };
	});

	it("offers no basemap when none is installed", () => {
		delete process.env.BASEMAP_TILE_DIR;
		delete process.env.BASEMAP_TILE_URL;
		expect(basemapConfig("https://delta.example")).toBeNull();
	});

	it("serves the default route when a tile directory is mounted", () => {
		process.env.BASEMAP_TILE_DIR = "/data/basemap";
		delete process.env.BASEMAP_TILE_URL;
		const c = basemapConfig("https://delta.example");
		expect(c?.url).toBe("/tiles/basemap/{z}/{x}/{y}.png");
		expect(c?.attribution).toContain("OpenStreetMap");
	});

	it("refuses a tile host on another origin", () => {
		process.env.BASEMAP_TILE_URL =
			"https://tile.openstreetmap.org/{z}/{x}/{y}.png";
		expect(basemapConfig("https://delta.example")).toBeNull();
		process.env.BASEMAP_TILE_URL = "//cdn.example/{z}/{x}/{y}.png";
		expect(basemapConfig("https://delta.example")).toBeNull();
	});
});
