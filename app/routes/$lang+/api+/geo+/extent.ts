import { etagMatches, geoEtag, geoLoader } from "~/backend.server/handlers/geo";
import { readModelRefreshedAt } from "~/backend.server/models/geo/queries";
import { getTenantExtent } from "~/backend.server/models/geo/tenantExtent";

// I-3: the tenant's map extent from its own boundaries. Session (ViewData)
// or API key, like every geo route; tenant-scoped by construction.
export const loader = geoLoader(
	async ({ request }, { countryAccountsId, url }) => {
		const refreshedAt = await readModelRefreshedAt(countryAccountsId);
		const etag = geoEtag(countryAccountsId, refreshedAt, url);
		if (etagMatches(request, etag)) {
			return new Response(null, { status: 304, headers: { ETag: etag } });
		}
		const extent = await getTenantExtent(countryAccountsId);
		return Response.json(extent, {
			headers: { ETag: etag, "Cache-Control": "private, no-cache" },
		});
	},
);
