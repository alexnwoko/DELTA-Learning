// Basemap for the Leaflet data-entry and footprint maps (SEC-20, TR-166,
// TR-247). A map draws tiles only from a self-hosted URL that passes
// isSelfHostedTileUrl, always with attribution. No URL is configured until
// the geoportal basemap (I-3) provides one, so these maps draw no basemap:
// footprints and boundaries on a plain canvas, and no call to any outside
// tile service.
import { BASEMAP_ATTRIBUTION, isSelfHostedTileUrl } from "~/utils/basemap";

export interface LeafletBasemap {
	url: string;
	attribution: string;
	maxZoom: number;
}

let configuredUrl: string | null = null;

/** Set once by the app when a self-hosted basemap is configured. */
export function setDataEntryBasemapUrl(url: string | null | undefined) {
	configuredUrl = url ?? null;
}

/** The basemap a Leaflet map may draw, or null when none is allowed. */
export function dataEntryBasemap(
	url: string | null | undefined = configuredUrl,
	origin: string | undefined = typeof window === "undefined" ? undefined : window.location?.origin,
): LeafletBasemap | null {
	if (!isSelfHostedTileUrl(url, origin)) return null;
	return { url: url as string, attribution: BASEMAP_ATTRIBUTION, maxZoom: 19 };
}

/**
 * Script text that adds the basemap to the Leaflet map named `mapVar` in a
 * page written into a new tab, or "" when there is none. The tab has no
 * base URL, so a root-relative URL is made absolute.
 */
export function inlineBasemapScript(mapVar: string, basemap: LeafletBasemap | null = dataEntryBasemap()): string {
	if (!basemap) return "";
	const url =
		basemap.url.startsWith("/") && typeof window !== "undefined" && window.location?.origin
			? new URL(basemap.url, window.location.origin).href
			: basemap.url;
	const safe = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
	return `L.tileLayer(${safe(url)}, ${safe({ attribution: basemap.attribution, maxZoom: basemap.maxZoom })}).addTo(${mapVar});`;
}
