import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import { authActionWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";

// Rebuilds the signed-in tenant's geoportal read model. Validators and admins
// can run it, because they move records to published. Wiring the refresh into
// every approval transition and migration load (pack C23) follows in G1b.
export const action = authActionWithPerm(
	"ValidateData",
	async ({ request }) => {
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}
		const countryAccountsId = await getCountryAccountsIdFromSession(request);
		if (!countryAccountsId) {
			throw new Response("Unauthorized", { status: 401 });
		}
		const result = await refreshGeoReadModel(countryAccountsId);
		return Response.json(result);
	},
);
