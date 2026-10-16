// Server side of the self-hosted basemap (I-3, TR-166, SEC-20). Tiles are
// files in a mounted directory (BASEMAP_TILE_DIR, laid out z/x/y.ext) and
// are served by the /tiles/basemap route on the DELTA origin, so no map
// calls an outside tile host (NFR-041). Without the directory there is no
// basemap: maps draw boundaries only and say so.
import path from "node:path";
import { promises as fs } from "node:fs";

import {
	BASEMAP_ATTRIBUTION,
	BASEMAP_DEFAULT_TILE_PATH,
	BASEMAP_MAX_ZOOM,
	BASEMAP_MIN_ZOOM,
	isSelfHostedTileUrl,
	type BasemapConfig,
} from "~/utils/basemap";

const TYPES: Record<string, string> = {
	png: "image/png",
	webp: "image/webp",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
};

export interface TileAddress {
	z: number;
	x: number;
	y: number;
	ext: string;
}

/**
 * Parses the route parameters of /tiles/basemap/:z/:x/:y.ext. Returns null
 * for anything that is not a tile inside the zoom range and the grid, so a
 * request can never name a file outside the tile tree.
 */
export function parseTileAddress(
	zs: string | undefined,
	xs: string | undefined,
	yext: string | undefined,
): TileAddress | null {
	const m = /^(\d{1,8})\.(png|webp|jpe?g)$/.exec(yext ?? "");
	if (!m || !/^\d{1,2}$/.test(zs ?? "") || !/^\d{1,8}$/.test(xs ?? "")) {
		return null;
	}
	const z = Number(zs);
	const x = Number(xs);
	const y = Number(m[1]);
	if (z < BASEMAP_MIN_ZOOM || z > BASEMAP_MAX_ZOOM) return null;
	const n = 2 ** z;
	if (x >= n || y >= n) return null;
	return { z, x, y, ext: m[2] };
}

/** The tile directory, or null when no basemap is installed. */
export function basemapTileDir(): string | null {
	const dir = process.env.BASEMAP_TILE_DIR?.trim();
	return dir ? path.resolve(dir) : null;
}

/**
 * Reads one tile. Null when the basemap is not installed or the tile is
 * missing (sea, or outside the rendered area).
 */
export async function readTile(
	a: TileAddress,
	dir: string | null = basemapTileDir(),
): Promise<{ body: Buffer; type: string; mtimeMs: number } | null> {
	if (!dir) return null;
	const file = path.join(dir, String(a.z), String(a.x), `${a.y}.${a.ext}`);
	if (!file.startsWith(dir + path.sep)) return null;
	try {
		const [body, st] = await Promise.all([fs.readFile(file), fs.stat(file)]);
		return { body, type: TYPES[a.ext], mtimeMs: st.mtimeMs };
	} catch {
		return null;
	}
}

/**
 * The basemap the maps may offer, or null. BASEMAP_TILE_URL may point at
 * another path on the DELTA origin; any other host is refused (SEC-20).
 */
export function basemapConfig(origin: string | undefined): BasemapConfig {
	const url =
		process.env.BASEMAP_TILE_URL?.trim() ||
		(basemapTileDir() ? BASEMAP_DEFAULT_TILE_PATH : "");
	if (!url || !isSelfHostedTileUrl(url, origin)) return null;
	return {
		url,
		attribution: BASEMAP_ATTRIBUTION,
		minZoom: BASEMAP_MIN_ZOOM,
		maxZoom: BASEMAP_MAX_ZOOM,
	};
}
