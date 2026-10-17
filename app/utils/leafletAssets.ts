/**
 * Where Leaflet and its plugins are served from. They are vendored under
 * public/assets/vendor (see its README) so no map loads a third-party script,
 * stylesheet or icon at runtime (NFR-041). Every Leaflet map reads these
 * constants; none keeps its own URL.
 */
export const LEAFLET_JS = "/assets/vendor/leaflet/1.9.4/leaflet.js";
export const LEAFLET_CSS = "/assets/vendor/leaflet/1.9.4/leaflet.css";
export const LEAFLET_DRAW_JS = "/assets/vendor/leaflet-draw/1.0.4/leaflet.draw.js";
export const LEAFLET_DRAW_CSS =
	"/assets/vendor/leaflet-draw/1.0.4/leaflet.draw.css";

/** Point marker for footprints. The tip of the pin is at (10, 20). */
export const MAP_MARKER_ICON = "/assets/icons/map-marker-red.svg";
export const MAP_MARKER_ICON_ANCHOR: [number, number] = [10, 20];

/**
 * Absolute URL for a DELTA asset. The map previews write a page into a new,
 * blank tab, where a root-relative URL has no reliable base; they use this.
 */
export function absoluteAssetUrl(path: string): string {
	const origin =
		typeof window === "undefined" ? undefined : window.location?.origin;
	return origin ? new URL(path, origin).href : path;
}
