import { geoLoader, resolveGeoRequest } from "~/backend.server/handlers/geo";
import {
	GeoRefusalError,
	getCountryDossier,
	getPlaceDossier,
} from "~/backend.server/models/geo/queries";
import { isValidUUID } from "~/utils/id";

// G3 (PD-05): recurrence, hazard mix, counts by year and cumulative human
// effects for one division and its descendants. "country" is the whole
// tenant (Alex, 2026-10-18: the Place panel opens on the country).
export const loader = geoLoader(async ({ params }, ctx) => {
	const divisionId = params.divisionId ?? "";
	if (divisionId === "country") {
		const req = await resolveGeoRequest(ctx, {
			requireMeasure: false,
			requireLevel: false,
			region: true,
		});
		const body = await getCountryDossier(ctx.countryAccountsId, req, ctx.lang);
		return Response.json(body, {
			headers: { "Cache-Control": "private, no-cache" },
		});
	}
	if (!isValidUUID(divisionId)) {
		throw new GeoRefusalError(
			"MALFORMED_REQUEST",
			"divisionId must be a UUID.",
			"PD-05 error codes",
			"Correct the request path.",
			400,
		);
	}
	const req = await resolveGeoRequest(ctx, {
		requireMeasure: false,
		requireLevel: false,
	});
	const body = await getPlaceDossier(
		ctx.countryAccountsId,
		divisionId,
		req,
		ctx.lang,
	);
	if (!body) {
		// Not found in this tenant: another tenant's division is not revealed.
		return Response.json({ error: "Division not found" }, { status: 404 });
	}
	return Response.json(body, {
		headers: { "Cache-Control": "private, no-cache" },
	});
});
