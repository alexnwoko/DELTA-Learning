import { geoLoader, resolveGeoRequest } from "~/backend.server/handlers/geo";
import { getHazardTree } from "~/backend.server/models/geo/queries";

// G6 (PD-05): HIPs 2025 tree with self and subtree record counts.
export const loader = geoLoader(async (_args, ctx) => {
	const req = await resolveGeoRequest(ctx, {
		requireMeasure: false,
		requireLevel: false,
	});
	const body = await getHazardTree(ctx.countryAccountsId, req, ctx.lang);
	return Response.json(body, {
		headers: { "Cache-Control": "private, no-cache" },
	});
});
