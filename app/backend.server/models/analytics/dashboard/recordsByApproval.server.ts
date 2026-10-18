// How many records in scope are published and how many are not, whatever
// the approval basis, so the D1 dashboard can say why a published view is
// empty ("No published records yet") instead of drawing empty panels.
// Retired records are left out, as on every basis.

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import { humanEffectsFilteredRecords } from "~/backend.server/models/analytics/hazard-analysis";
import {
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { approvalBasis, basisColumns, notRetired } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";

export interface RecordsByApproval {
	published: number;
	unpublished: number;
}

async function computeGetRecordsByApproval(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<RecordsByApproval> {
	const { filters } = impactFiltersFromQuery(query, ctx);
	const fr = humanEffectsFilteredRecords(filters, (alias) =>
		notRetired(sql`${sql.identifier(alias)}."legacy_data"`),
	);
	// Published means the public basis, from the shared helper (TR-192).
	const published = approvalBasis(
		"public",
		basisColumns("rec", { legacyData: false }),
	);
	const r = (
		await rows(sql`
			WITH RECURSIVE ${fr}
			SELECT
				COUNT(*) FILTER (WHERE ${published}) AS published,
				COUNT(*) FILTER (WHERE NOT ${published}) AS unpublished
			FROM filtered_records fr
			JOIN "disaster_records" rec ON rec."id" = fr.record_id`)
	)[0];
	return { published: num(r?.published), unpublished: num(r?.unpublished) };
}

/** getRecordsByApproval, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getRecordsByApproval(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<RecordsByApproval> {
	return cachedDashboard("getRecordsByApproval", [ctx, query], () =>
		computeGetRecordsByApproval(query, ctx),
	);
}
