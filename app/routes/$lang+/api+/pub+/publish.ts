import { isUuid, jsonBody, pubAction, pubRefusal } from "~/backend.server/handlers/pub";
import { publishPackage } from "~/backend.server/models/pub/publish";

// Builds a delta.pub/1 package for one active consent and writes it to the
// outbox. purpose "publication" (default) uses published records only and
// must be signed; "specification_test" uses every status and is never sent.
export const action = pubAction(async ({ request }, { countryAccountsId, userId }) => {
	const b = await jsonBody(request);
	const settingId = String(b.shareSettingId ?? "");
	const purpose = b.purpose === "specification_test" ? "specification_test" : "publication";
	if (!isUuid(settingId) || (b.purpose !== undefined && b.purpose !== purpose)) {
		return pubRefusal("MALFORMED_REQUEST", "shareSettingId (uuid) is required; purpose is publication or specification_test.", 400);
	}
	const pkg = await publishPackage(countryAccountsId, userId, settingId, {
		purpose,
		refresh: b.refresh !== false,
	});
	return Response.json(
		{
			packageId: pkg.header.package_id,
			contentDigest: pkg.integrity.content_digest,
			observations: pkg.observations.length,
			suppression: pkg.header.suppression,
		},
		{ status: 201 },
	);
});
