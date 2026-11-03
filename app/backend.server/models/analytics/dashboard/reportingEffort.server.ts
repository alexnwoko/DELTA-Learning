// Reporting effort panel (FR-AN-090), the loader behind
// ~/utils/dashboard/reportingEffort. Divisions follow the query's admin level.

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import { humanEffectsFilteredRecords } from "~/backend.server/models/analytics/hazard-analysis";
import {
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	recordDivisionsCte,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { showByLevel, type DeltaQuery } from "~/utils/deltaQuery";
import type { ReportingEffort } from "~/utils/dashboard/reportingEffort";

/** Fewest reporting divisions in a year for records per division to be shown. */
export const REPORTING_EFFORT_MIN_DIVISIONS = 10;

async function computeReportingEffort(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ReportingEffort> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const perYear = await rows(sql`
		WITH RECURSIVE ${humanEffectsFilteredRecords(filters)},
		${recordDivisionsCte(ctx.countryAccountsId, showByLevel(query))},
		ry AS (
			SELECT fr.record_id,
				NULLIF(substring(r."start_date" from '^[0-9]{4}'), '')::int AS year,
				NULLIF(btrim(r."primary_data_source"), '') AS source
			FROM filtered_records fr
			JOIN "disaster_records" r ON r."id" = fr.record_id
		)
		SELECT ry.year, COUNT(DISTINCT ry.record_id) AS records,
			COUNT(DISTINCT rl.l1_id) AS divisions, COUNT(DISTINCT ry.source) AS sources
		FROM ry LEFT JOIN rec_l1 rl ON rl.record_id = ry.record_id
		GROUP BY 1`);
	return {
		years: perYear
			.filter((r) => r.year != null)
			.map((r) => {
				const records = num(r.records);
				const divisions = num(r.divisions);
				return {
					year: num(r.year),
					records,
					divisions,
					sources: num(r.sources),
					recordsPerDivision:
						divisions >= REPORTING_EFFORT_MIN_DIVISIONS
							? Math.round((records / divisions) * 10) / 10
							: null,
				};
			})
			.sort((a, b) => a.year - b.year),
		recordsNoYear: num(perYear.find((r) => r.year == null)?.records),
		minDivisions: REPORTING_EFFORT_MIN_DIVISIONS,
		note: "More records can mean more reporting, not more disasters. Read trends beside these counts.",
		meta: {
			method: `Per start year: disaster records in scope, distinct divisions with a record (rolled up to the chosen admin level) and distinct primary data sources (exact text after trimming, so one organisation may appear under several spellings). Records per division is shown from ${REPORTING_EFFORT_MIN_DIVISIONS} divisions in the year. Years with no record are not listed.`,
			notApplied,
		},
	};
}

/** getReportingEffort, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getReportingEffort(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ReportingEffort> {
	return cachedDashboard("getReportingEffort", [ctx, query], () =>
		computeReportingEffort(query, ctx),
	);
}
