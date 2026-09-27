import type { BasemapConfig } from "~/utils/basemap";

export const OSM_STANDARD_TILE_URL =
	"https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const OSM_ATTRIBUTION =
	'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Resolve the basemap from the environment.
 *
 * - BASEMAP_TILE_URL set: use it, with BASEMAP_ATTRIBUTION or the
 *   OpenStreetMap attribution, and BASEMAP_MAX_ZOOM or 19.
 * - Unset in development: OpenStreetMap standard tiles with attribution.
 *   The OSM tile usage policy allows light development use only
 *   (ruling by Alex Nwoko, 2026-09-28).
 * - Unset otherwise: no basemap. Production waits for the self-hosted
 *   tile service.
 */
export function resolveBasemapConfig(
	env: NodeJS.ProcessEnv = process.env,
): BasemapConfig | null {
	const maxZoom = Number(env.BASEMAP_MAX_ZOOM) || 19;
	const url = env.BASEMAP_TILE_URL?.trim();
	if (url) {
		return {
			url,
			attribution: env.BASEMAP_ATTRIBUTION?.trim() || OSM_ATTRIBUTION,
			maxZoom,
		};
	}
	if (env.NODE_ENV === "development") {
		return { url: OSM_STANDARD_TILE_URL, attribution: OSM_ATTRIBUTION, maxZoom };
	}
	return null;
}
