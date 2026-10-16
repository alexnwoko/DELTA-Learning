// Basemap rules for every DELTA map (TR-166, SEC-20). The basemap is off by
// default and, when set, must be a self-hosted raster tile service: a
// root-relative path or a URL on the DELTA origin. Third-party tile hosts
// are refused, so no map calls an outside service or needs an API key.
// Pure module: safe for server and client code.

/** Attribution for the OpenStreetMap-derived self-hosted basemap (TR-166). */
export const BASEMAP_ATTRIBUTION =
	'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * True when a tile URL template is served from the DELTA origin: a
 * root-relative path ("/tiles/{z}/{x}/{y}.png"), or an absolute URL whose
 * origin equals `origin`. Protocol-relative ("//host/...") and any other
 * host are refused.
 */
export function isSelfHostedTileUrl(
	url: string | undefined | null,
	origin: string | undefined,
): boolean {
	if (!url) return false;
	if (url.startsWith("/") && !url.startsWith("//")) return true;
	if (!origin) return false;
	try {
		// Placeholders such as {z} are valid in the path of a URL.
		return new URL(url).origin === new URL(origin).origin;
	} catch {
		return false;
	}
}

/** Route the DELTA server serves basemap tiles from (I-3). */
export const BASEMAP_DEFAULT_TILE_PATH = "/tiles/basemap/{z}/{x}/{y}.png";

/**
 * Zoom range of the basemap. Loss and damage maps work at admin-area
 * scale, not street level, so tiles stop at zoom 12 (I-3; revisit with
 * the tile pipeline decision).
 */
export const BASEMAP_MIN_ZOOM = 0;
export const BASEMAP_MAX_ZOOM = 12;

/** A basemap a map may offer; null when none is installed. */
export type BasemapConfig = {
	url: string;
	/** HTML attribution, shown whenever the basemap is drawn (TR-166). */
	attribution: string;
	minZoom: number;
	maxZoom: number;
} | null;
