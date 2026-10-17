import { geoLoader } from "~/backend.server/handlers/geo";
import { listRegions } from "~/backend.server/models/geo/regions";

// RG-1 (I-4; OpenAPI 0.7.0-draft): the tenant's regions with their members.
export const loader = geoLoader(async (_args, ctx) => {
	const regions = await listRegions(ctx.countryAccountsId, ctx.lang);
	return Response.json(
		{ regions },
		{ headers: { "Cache-Control": "private, no-cache" } },
	);
});
