import { getRecordDivisionFeature } from "~/backend.server/models/analytics/recordDivisionGeometry";
import { authLoaderWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";
import { isValidUUID } from "~/utils/id";

export const loader = authLoaderWithPerm("ViewData", async ({ request }) => {
	const countryAccountsId = await getCountryAccountsIdFromSession(request);
	if (!countryAccountsId) {
		throw new Response("Unauthorized", { status: 401 });
	}

	const url = new URL(request.url);
	const division_id = url.searchParams.get("division_id");
	const record_id = url.searchParams.get("record_id");

	if (
		!division_id ||
		!record_id ||
		!isValidUUID(division_id) ||
		!isValidUUID(record_id)
	) {
		return Response.json({ error: "Missing parameters" }, { status: 400 });
	}

	const feature = await getRecordDivisionFeature(
		countryAccountsId,
		record_id,
		division_id,
	);
	if (!feature) {
		return Response.json(
			{ error: "No matching geojson found" },
			{ status: 404 },
		);
	}

	return Response.json(feature);
});
