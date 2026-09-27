import { geoLoader } from "~/backend.server/handlers/geo";
import {
	GeoRefusalError,
	getPlaceDossier,
	parseGeoQuery,
} from "~/backend.server/models/geo/queries";
import { isValidUUID } from "~/utils/id";

// G3 (build spec s5.4): recurrence, hazard mix, counts by year and
// cumulative human effects for one division and its descendants.
export const loader = geoLoader(
	async ({ params }, { countryAccountsId, url, lang }) => {
		const divisionId = params.divisionId ?? "";
		if (!isValidUUID(divisionId)) {
			throw new GeoRefusalError(
				"MALFORMED_REQUEST",
				"divisionId must be a UUID.",
				"API spec s11",
				"Correct the request path.",
				400,
			);
		}
		const q = parseGeoQuery(url.searchParams, {
			requireMeasure: false,
			requireLevel: false,
		});
		const body = await getPlaceDossier(countryAccountsId, divisionId, q, lang);
		if (!body) {
			// Not found in this tenant: another tenant's division is not revealed.
			return Response.json({ error: "Division not found" }, { status: 404 });
		}
		return Response.json(body, {
			headers: { "Cache-Control": "private, no-cache" },
		});
	},
);
