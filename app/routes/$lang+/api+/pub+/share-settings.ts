import { jsonBody, pubAction, pubLoader } from "~/backend.server/handlers/pub";
import { grantShareSetting, listShareSettings } from "~/backend.server/models/pub/publish";

// Consent to share (ADR-11, T2): one active setting per dataset and tier, with
// the admin level the country chose. GET lists the history; POST grants.
export const loader = pubLoader(async (_args, { countryAccountsId }) =>
	Response.json({ settings: await listShareSettings(countryAccountsId) }),
);

export const action = pubAction(async ({ request }, { countryAccountsId, userId }) => {
	const b = await jsonBody(request);
	const setting = await grantShareSetting(countryAccountsId, userId, {
		dataset: String(b.dataset ?? ""),
		tier: String(b.tier ?? ""),
		adminLevel: Number(b.adminLevel),
		hipLevel: b.hipLevel === undefined ? undefined : String(b.hipLevel),
		redistribution: b.redistribution === undefined ? undefined : String(b.redistribution),
	});
	return Response.json({ setting }, { status: 201 });
});
