import {
	geoLoader,
	GeoRefusalWithMeta,
	resolveGeoRequest,
} from "~/backend.server/handlers/geo";
import {
	baseMeta,
	GeoRefusalError,
} from "~/backend.server/models/geo/queries";
import {
	getRegion,
	getRegionSummary,
} from "~/backend.server/models/geo/regions";
import { isUuid, QUERY_REFUSALS } from "~/utils/deltaQuery";

// RG-1 (I-4; OpenAPI 0.7.0-draft): one measure for a region, each record once
// in the total, with every member area and the records shared between them.
export const loader = geoLoader(async ({ params }, ctx) => {
	const regionId = params.regionId ?? "";
	if (!isUuid(regionId)) {
		throw new Response("Region not found", { status: 404 });
	}
	const region = await getRegion(ctx.countryAccountsId, regionId, ctx.lang);
	if (!region) {
		// Another tenant's region is not revealed (SEC-22).
		throw new Response("Region not found", { status: 404 });
	}
	if (ctx.url.searchParams.has("division")) {
		throw new GeoRefusalError(
			QUERY_REFUSALS.regionAndDivision,
			"A request can filter by a division or by a region, not both.",
			"RG-1; delta.query/1 place facet",
			"Remove division.",
			422,
		);
	}
	const req = await resolveGeoRequest(ctx, {
		requireMeasure: true,
		requireLevel: false,
		eventDimensions: true,
	});
	try {
		const body = await getRegionSummary(ctx.countryAccountsId, req, region);
		return Response.json(body, {
			headers: { "Cache-Control": "private, no-cache" },
		});
	} catch (err) {
		if (err instanceof GeoRefusalError) {
			throw new GeoRefusalWithMeta(
				err,
				await baseMeta(ctx.countryAccountsId, req),
			);
		}
		throw err;
	}
});
