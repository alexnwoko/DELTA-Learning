import {
	etagMatches,
	geoEtag,
	geoLoader,
	geometryCacheControl,
} from "~/backend.server/handlers/geo";
import {
	getTenantOutline,
	mapDataVersion,
	neighbourOutlines,
} from "~/backend.server/models/geo/tenantExtent";

// The map's reference shapes, fetched by the browser instead of being
// inlined in the page (NFR-113 first paint): the tenant's own outline and
// name, and the neighbouring countries from geo.admin0. Session or API key,
// like every geo route; tenant-scoped by construction. Cached for a year on
// a URL that carries the current map data version (`v`).
export const loader = geoLoader(
	async ({ request }, { countryAccountsId, url }) => {
		const version = await mapDataVersion(countryAccountsId);
		const etag = geoEtag(countryAccountsId, version, url);
		const cacheControl = geometryCacheControl(url, version);
		if (etagMatches(request, etag)) {
			return new Response(null, {
				status: 304,
				headers: { ETag: etag, "Cache-Control": cacheControl },
			});
		}
		const [outline, neighbours] = await Promise.all([
			getTenantOutline(countryAccountsId),
			neighbourOutlines(countryAccountsId, 2),
		]);
		return Response.json(
			{ outline, neighbours },
			{ headers: { ETag: etag, "Cache-Control": cacheControl } },
		);
	},
);
