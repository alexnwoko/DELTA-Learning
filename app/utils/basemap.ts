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
