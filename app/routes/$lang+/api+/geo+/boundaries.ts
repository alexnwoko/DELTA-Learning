import {
	etagMatches,
	geoEtag,
	geoLoader,
	geometryCacheControl,
} from "~/backend.server/handlers/geo";
import {
	getBoundaries,
	GeoRefusalError,
	readModelRefreshedAt,
} from "~/backend.server/models/geo/queries";
import { mapDataVersion } from "~/backend.server/models/geo/tenantExtent";
import { isValidUUID } from "~/utils/id";

function malformed(message: string) {
	return new GeoRefusalError(
		"MALFORMED_REQUEST",
		message,
		"PD-05 error codes",
		"Correct the request parameters.",
		400,
	);
}

// G1 (build spec s5.4): simplified division geometry for one level.
export const loader = geoLoader(
	async ({ request }, { countryAccountsId, url, lang }) => {
		const p = url.searchParams;
		const level = Number(p.get("level"));
		if (!p.get("level") || !Number.isInteger(level) || level < 0) {
			throw malformed("level must be a non-negative integer.");
		}
		const parentId = p.get("parentId");
		if (parentId && !isValidUUID(parentId)) {
			throw malformed("parentId must be a UUID.");
		}
		let bbox: [number, number, number, number] | null = null;
		if (p.get("bbox")) {
			const parts = (p.get("bbox") as string).split(",").map(Number);
			if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
				throw malformed("bbox must be minLon,minLat,maxLon,maxLat.");
			}
			bbox = parts as [number, number, number, number];
		}
		const z = p.get("z") ? Number(p.get("z")) : null;
		if (z !== null && (!Number.isInteger(z) || z < 0 || z > 22)) {
			throw malformed("z must be an integer from 0 to 22.");
		}

		const [refreshedAt, version] = await Promise.all([
			readModelRefreshedAt(countryAccountsId),
			mapDataVersion(countryAccountsId),
		]);
		const etag = geoEtag(countryAccountsId, refreshedAt, url);
		const cacheControl = geometryCacheControl(url, version);
		if (etagMatches(request, etag)) {
			return new Response(null, {
				status: 304,
				headers: { ETag: etag, "Cache-Control": cacheControl },
			});
		}
		const fc = await getBoundaries(countryAccountsId, {
			level,
			parentId,
			bbox,
			z,
			lang,
		});
		return Response.json(fc, {
			headers: {
				"Content-Type": "application/geo+json",
				ETag: etag,
				"Cache-Control": cacheControl,
			},
		});
	},
);
