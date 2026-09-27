import { geoEtag, geoLoader } from "~/backend.server/handlers/geo";
import {
	getChoropleth,
	parseGeoQuery,
} from "~/backend.server/models/geo/queries";

// G2 (build spec s5.4): one measure aggregated by division at one level.
export const loader = geoLoader(async ({ request }, { countryAccountsId, url }) => {
	const q = parseGeoQuery(url.searchParams, {
		requireMeasure: true,
		requireLevel: true,
	});
	const body = await getChoropleth(countryAccountsId, q);
	const etag = geoEtag(body.meta.readModelRefreshedAt, url);
	if (request.headers.get("If-None-Match") === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}
	return Response.json(body, {
		headers: { ETag: etag, "Cache-Control": "private, no-cache" },
	});
});
