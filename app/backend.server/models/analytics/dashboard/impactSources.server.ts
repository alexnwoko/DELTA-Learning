// D1 Analysis dashboard, Disaster impact view, panel DI-18: the reporting
// sources of the disaster records in scope (disaster_records.
// primary_data_source). Counts are counts of records.

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
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { ImpactSources } from "~/utils/dashboard/impactSources";

/** Sources listed by name; the rest are summed. */
export const SOURCES_TOP = 15;

async function computeImpactSources(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactSources> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const bySource = await rows(sql`
		WITH RECURSIVE ${humanEffectsFilteredRecords(filters)}
		SELECT NULLIF(btrim(r."primary_data_source"), '') AS source, COUNT(*) AS records
		FROM filtered_records fr
		JOIN public."disaster_records" r ON r."id" = fr.record_id
		GROUP BY 1`);
	const named = bySource
		.filter((r) => r.source !== null)
		.map((r) => ({ source: r.source as string, records: num(r.records) }))
		.sort((a, b) => b.records - a.records || a.source.localeCompare(b.source));
	const rest = named.slice(SOURCES_TOP);
	const without = num(bySource.find((r) => r.source === null)?.records);
	return {
		rows: named.slice(0, SOURCES_TOP),
		rest: rest.length
			? {
					sources: rest.length,
					records: rest.reduce((s, r) => s + r.records, 0),
				}
			: null,
		recordsWithoutSource: without,
		recordsInScope: named.reduce((s, r) => s + r.records, 0) + without,
		distinctSources: named.length,
		meta: {
			method: `Disaster records in scope per reporting source (primary data source), top ${SOURCES_TOP}; sources are free text, grouped by exact text after trimming, so one organisation may appear under several spellings`,
			notApplied,
		},
	};
}

/** getImpactSources, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getImpactSources(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactSources> {
	return cachedDashboard("getImpactSources", [ctx, query], () =>
		computeImpactSources(query, ctx),
	);
}
