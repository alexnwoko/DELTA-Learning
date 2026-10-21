// Server side of the self-hosted basemap (I-3, TR-166, SEC-20). Tiles are
// files in a mounted directory (BASEMAP_TILE_DIR, laid out z/x/y.ext) and
// are served by the /tiles/basemap route on the DELTA origin, so no map
// calls an outside tile host (NFR-041). Without the directory there is no
// basemap: maps draw boundaries only and say so.
import path from "node:path";
import { promises as fs, readdirSync } from "node:fs";

import {
	BASEMAP_ATTRIBUTION,
	THIRD_PARTY_TILE_HOSTS,
	isAllowedThirdPartyUrl,
	type BasemapLayer,
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

const extentCache = new Map<string, [number, number, number, number] | null>();

/**
 * The area a z/x/y tile directory covers, in degrees [west, south, east,
 * north], read once from the directory listing at one zoom (8, or the
 * deepest below it) and kept for the life of the server. Null when the
 * directory cannot be read.
 */
export function tileDirExtent(dir: string): [number, number, number, number] | null {
	if (extentCache.has(dir)) return extentCache.get(dir) ?? null;
	let result: [number, number, number, number] | null = null;
	try {
		const zooms = readdirSync(dir)
			.filter((d) => /^\d+$/.test(d))
			.map(Number)
			.filter((z) => z <= 8)
			.sort((a, b) => b - a);
		const z = zooms[0];
		if (z !== undefined) {
			const xs = readdirSync(path.join(dir, String(z)))
				.filter((d) => /^\d+$/.test(d))
				.map(Number);
			let yMin = Infinity;
			let yMax = -Infinity;
			for (const x of xs) {
				for (const f of readdirSync(path.join(dir, String(z), String(x)))) {
					const y = Number(f.split(".")[0]);
					if (Number.isFinite(y)) {
						yMin = Math.min(yMin, y);
						yMax = Math.max(yMax, y);
					}
				}
			}
			if (xs.length && Number.isFinite(yMin)) {
				const n = 2 ** z;
				const lon = (x: number) => (x / n) * 360 - 180;
				const lat = (y: number) =>
					(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
				result = [
					lon(Math.min(...xs)),
					lat(yMax + 1),
					lon(Math.max(...xs) + 1),
					lat(yMin),
				];
			}
		}
	} catch {
		result = null;
	}
	extentCache.set(dir, result);
	return result;
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

/** Satellite tile directory (ESA WorldCover 2021 composite), or null. */
export function satelliteTileDir(): string | null {
	const dir = process.env.BASEMAP_SATELLITE_TILE_DIR?.trim();
	return dir ? path.resolve(dir) : null;
}

const SATELLITE_FORMAT = () =>
	(["png", "jpg", "webp"] as const).find(
		(f) => f === process.env.BASEMAP_SATELLITE_FORMAT?.trim(),
	) ?? "jpg";

const ESA_ATTRIBUTION =
	'&copy; <a href="https://esa-worldcover.org/">ESA WorldCover project</a> 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium';

const MAPBOX_ATTRIBUTION =
	'&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://apps.mapbox.com/feedback/">Improve this map</a>';

/**
 * The basemap layers this deployment may offer, in switcher order. The
 * self-hosted street map comes first. Google and Mapbox appear only when
 * the operator configured their key (and, for Mapbox, the self-hosted logo
 * its terms require); their URLs are built here on the allow-listed host,
 * never read from configuration.
 */
export function basemapLayers(
	origin: string | undefined,
	lang = "en",
): BasemapLayer[] {
	const layers: BasemapLayer[] = [];
	const street = basemapConfig(origin);
	const common = { minZoom: BASEMAP_MIN_ZOOM, maxZoom: BASEMAP_MAX_ZOOM };
	if (street) {
		layers.push({
			id: "street",
			label: { code: "geoportal.basemap.street", msg: "Street map" },
			url: street.url,
			attribution: street.attribution,
			...common,
			tileSize: 256,
			thirdParty: false,
			// Only where the installed tiles are (a country set, not the world).
			extent: (() => {
				const dir = basemapTileDir();
				return dir ? tileDirExtent(dir) : null;
			})(),
			note: null,
			logo: null,
			google: null,
		});
	}
	if (satelliteTileDir()) {
		layers.push({
			id: "satellite",
			label: {
				code: "geoportal.basemap.satellite",
				msg: "Sentinel-2 true-colour 2021 (ESA WorldCover composite)",
			},
			url: `/tiles/satellite/{z}/{x}/{y}.${SATELLITE_FORMAT()}`,
			attribution: ESA_ATTRIBUTION,
			...common,
			tileSize: 256,
			thirdParty: false,
			note: null,
			logo: null,
			google: null,
		});
	}
	const googleKey = process.env.BASEMAP_GOOGLE_KEY?.trim();
	const region = process.env.BASEMAP_GOOGLE_REGION?.trim().toUpperCase();
	if (googleKey && region && /^[A-Z]{2}$/.test(region)) {
		const host = THIRD_PARTY_TILE_HOSTS.google;
		const key = encodeURIComponent(googleKey);
		const url = `https://${host}/v1/2dtiles/{z}/{x}/{y}?session={session}&key=${key}`;
		if (isAllowedThirdPartyUrl("google", url)) {
			layers.push({
				id: "google",
				label: { code: "geoportal.basemap.google", msg: "Google street map" },
				url,
				attribution: "Google",
				...common,
				tileSize: 256,
				thirdParty: true,
				note: {
					code: "geoportal.basemap.note_google",
					msg: "Map views are sent to Google",
				},
				logo: null,
				google: {
					createSessionUrl: `https://${host}/v1/createSession?key=${key}`,
					viewportUrl: `https://${host}/tile/v1/viewport?key=${key}`,
					region,
					language: lang,
				},
			});
		}
	}
	const mapboxToken = process.env.BASEMAP_MAPBOX_TOKEN?.trim();
	const mapboxLogo = process.env.BASEMAP_MAPBOX_LOGO?.trim();
	if (mapboxToken && mapboxLogo && isSelfHostedTileUrl(mapboxLogo, origin)) {
		const url = `https://${THIRD_PARTY_TILE_HOSTS.mapbox}/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(mapboxToken)}`;
		if (isAllowedThirdPartyUrl("mapbox", url)) {
			layers.push({
				id: "mapbox",
				label: { code: "geoportal.basemap.mapbox", msg: "Mapbox street map" },
				url,
				attribution: MAPBOX_ATTRIBUTION,
				...common,
				tileSize: 256,
				thirdParty: true,
				note: {
					code: "geoportal.basemap.note_mapbox",
					msg: "Map views are sent to Mapbox",
				},
				logo: mapboxLogo,
				google: null,
			});
		}
	}
	return layers;
}
