import { isUuid, pubLoader, pubRefusal } from "~/backend.server/handlers/pub";
import { getPackage } from "~/backend.server/models/pub/publish";

// One package as delta.pub/1 JSON. Another tenant's package is a 404.
export const loader = pubLoader(async ({ params }, { countryAccountsId }) => {
	if (!isUuid(params.id)) {
		return pubRefusal("MALFORMED_REQUEST", "Invalid package id.", 400);
	}
	const pkg = await getPackage(countryAccountsId, params.id);
	if (!pkg) return new Response("Not Found", { status: 404 });
	return Response.json(pkg);
});
