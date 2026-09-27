import { geoLoader } from "~/backend.server/handlers/geo";
import { getHazardTree } from "~/backend.server/models/geo/queries";

// G6 (build spec s5.4): HIPs 2025 tree with self and subtree record counts.
export const loader = geoLoader(async (_args, { countryAccountsId, lang }) => {
	const body = await getHazardTree(countryAccountsId, lang);
	return Response.json(body, {
		headers: { "Cache-Control": "private, no-cache" },
	});
});
