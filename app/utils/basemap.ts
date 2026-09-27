/**
 * Basemap configuration shared by every Leaflet and OpenLayers map.
 *
 * The server resolves it once (basemap.server.ts) and the root loader
 * serialises it; the root component stores it here so that plain functions,
 * such as the map preview windows, can read it without hooks.
 *
 * null means no basemap: maps draw divisions on a neutral background and
 * call no tile service (geoportal requirement VIS-F01).
 */
export interface BasemapConfig {
	/** Raster XYZ tile URL template, for example https://host/{z}/{x}/{y}.png */
	url: string;
	/** HTML attribution. OpenStreetMap data (ODbL) requires it, so it is never empty. */
	attribution: string;
	maxZoom: number;
}

let current: BasemapConfig | null = null;

export function setBasemapConfig(config: BasemapConfig | null | undefined) {
	current = config ?? null;
}

export function getBasemapConfig(): BasemapConfig | null {
	return current;
}

/**
 * Serialise the config for a script embedded in a generated HTML page,
 * escaping "<" so the value cannot close the script element.
 */
export function basemapConfigForInlineScript(
	config: BasemapConfig | null = current,
): string {
	return JSON.stringify(config).replace(/</g, "\\u003c");
}
