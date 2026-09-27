import { geoEtag, geoLoader } from "~/backend.server/handlers/geo";
import {
	getDivisionTile,
	GeoRefusalError,
	readModelRefreshedAt,
} from "~/backend.server/models/geo/queries";

// T1 (build spec s5.4): Mapbox Vector Tile of divisions at one level, layer
// "divisions". Simplification follows the zoom tier.
export const loader = geoLoader(
	async ({ request, params }, { countryAccountsId, url, lang }) => {
		const [level, z, x, y] = [params.level, params.z, params.x, params.y].map(
			Number,
		);
		const max = 2 ** z;
		if (
			![level, z, x, y].every(Number.isInteger) ||
			level < 0 ||
			z < 0 ||
			z > 22 ||
			x < 0 ||
			y < 0 ||
			x >= max ||
			y >= max
		) {
			throw new GeoRefusalError(
				"MALFORMED_REQUEST",
				"Tile coordinates are out of range.",
				"API spec s8",
				"Use integer level, z from 0 to 22, and x, y within 0 to 2^z - 1.",
				400,
			);
		}
		const refreshedAt = await readModelRefreshedAt(countryAccountsId);
		const etag = geoEtag(refreshedAt, url);
		const headers = {
			ETag: etag,
			"Cache-Control": "private, no-cache",
			"X-Boundary-Version": "unknown",
		};
		if (request.headers.get("If-None-Match") === etag) {
			return new Response(null, { status: 304, headers });
		}
		const tile = await getDivisionTile(countryAccountsId, level, z, x, y, lang);
		if (tile.length === 0) {
			return new Response(null, { status: 204, headers });
		}
		return new Response(new Uint8Array(tile), {
			headers: {
				...headers,
				"Content-Type": "application/vnd.mapbox-vector-tile",
			},
		});
	},
);
