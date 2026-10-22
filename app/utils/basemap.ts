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

// ---------------------------------------------------------------------------
// Basemap switcher (I-3; Alex 2026-10-16: "users should be able to toggle
// based on their choice"). One list for GeoMap and MapChart.

/** Basemap layers a map may offer, in switcher order. */
export type BasemapLayerId = "street" | "satellite" | "google" | "mapbox";

/** Third-party providers: an explicit allow-list, each pinned to one host. */
export const THIRD_PARTY_TILE_HOSTS = {
	google: "tile.googleapis.com",
	mapbox: "api.mapbox.com",
} as const;
export type ThirdPartyProvider = keyof typeof THIRD_PARTY_TILE_HOSTS;

export interface BasemapLayer {
	id: BasemapLayerId;
	/** Locale key and English label. */
	label: { code: string; msg: string };
	/** XYZ template; Google's carries {session}, filled in by the map. */
	url: string;
	/** HTML attribution shown whenever the layer is drawn. */
	attribution: string;
	minZoom: number;
	maxZoom: number;
	tileSize: 256 | 512;
	/** True when tiles come from outside the DELTA origin (SEC-20 exception). */
	thirdParty: boolean;
	/** Plain note shown next to a third-party option. */
	note: { code: string; msg: string } | null;
	/**
	 * [west, south, east, north] in degrees where the layer has tiles, or
	 * null when unknown. The map asks for tiles only inside it, so a country
	 * tile set does not cause requests (and 404s) across the world.
	 */
	extent?: [number, number, number, number] | null;
	/** Self-hosted logo the provider's terms require, or null. */
	logo: string | null;
	/** Google only: session and viewport endpoints and the session body. */
	google: {
		createSessionUrl: string;
		viewportUrl: string;
		region: string;
		language: string;
	} | null;
}

/**
 * True when a third-party tile URL uses HTTPS and the provider's one
 * allowed host. Any other URL is refused, so configuration can never open
 * the map (or the CSP) to another host.
 */
export function isAllowedThirdPartyUrl(
	provider: string,
	url: string | null | undefined,
): boolean {
	const host = (THIRD_PARTY_TILE_HOSTS as Record<string, string>)[provider];
	if (!host || !url) return false;
	try {
		const u = new URL(url.replace(/[{}]/g, ""));
		return u.protocol === "https:" && u.host === host;
	} catch {
		return false;
	}
}

/**
 * Layers a reader may pick. Public pages offer self-hosted layers only
 * (Geoportal recommendation, pending Alex), so an anonymous visitor's map
 * views never reach a third party.
 */
export function selectableBasemaps(
	layers: readonly BasemapLayer[],
	audience: "public" | "signed-in",
): BasemapLayer[] {
	return layers.filter((l) => audience === "signed-in" || !l.thirdParty);
}

/**
 * The layer to draw on paper or in an export: third-party tiles never
 * print (their terms, and cross-origin tiles taint the export canvas), so
 * the first self-hosted layer stands in, or none.
 */
export function printableBasemap(
	layers: readonly BasemapLayer[],
	current: BasemapLayerId | null,
): BasemapLayerId | null {
	const layer = layers.find((l) => l.id === current);
	if (!layer) return null;
	if (!layer.thirdParty) return layer.id;
	return layers.find((l) => !l.thirdParty)?.id ?? null;
}
