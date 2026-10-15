import { isUuid, pubAction, pubRefusal } from "~/backend.server/handlers/pub";
import { revokeShareSetting } from "~/backend.server/models/pub/publish";

// Revokes a consent. If a package was sent under it, a withdraw package is
// written in the same transaction, so the receiver deletes the slice.
export const action = pubAction(async ({ params }, { countryAccountsId, userId }) => {
	if (!isUuid(params.id)) {
		return pubRefusal("MALFORMED_REQUEST", "Invalid share setting id.", 400);
	}
	return Response.json(await revokeShareSetting(countryAccountsId, userId, params.id));
});
