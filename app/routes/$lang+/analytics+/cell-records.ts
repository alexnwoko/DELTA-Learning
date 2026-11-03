// The records behind a Hazard by month box (FR-AN-068), for the panel's list.
// The same guard, query and approval basis as the Analysis page.
import type { LoaderFunctionArgs } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { getCellRecords } from "~/backend.server/models/analytics/dashboard/cellRecords.server";
import { CELL_KEY_PARAM, CELL_MONTH_PARAM, parseCellRequest } from "~/frontend/analytics/dashboard/panels/CellRecordsList";
import { authLoaderPublicOrWithPerm } from "~/utils/auth";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import { getCountryAccountsIdFromSession, getCountrySettingsFromSession } from "~/utils/session";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request }: LoaderFunctionArgs) => {
	const params = new URL(request.url).searchParams;
	const cell = parseCellRequest(params);
	if (!cell) return Response.json({ refused: "A cell needs a hazard key and a month from 1 to 12." }, { status: 422 });
	params.delete(CELL_KEY_PARAM);
	params.delete(CELL_MONTH_PARAM);
	const { query, issues } = parseDeltaQuery(params);
	// A filter that cannot be applied is refused, never silently dropped.
	if (issues.length > 0) return Response.json({ refused: issues }, { status: 422 });
	// 403 for the provisional basis without ValidateData.
	const audience = await approvalAudienceForBasis(request, query.scope.basis);
	const countryAccountsId = await getCountryAccountsIdFromSession(request);
	if (!countryAccountsId) return Response.json({ refused: "No instance selected" }, { status: 400 });
	const settings = await getCountrySettingsFromSession(request);
	const body = await getCellRecords(
		query,
		{ countryAccountsId, audience, tenantName: (settings?.countryName as string | undefined) || null, provisional: basisIncludesProvisional(audience) },
		cell,
	);
	return Response.json(body, { headers: { "Cache-Control": "private, no-cache" } });
});
