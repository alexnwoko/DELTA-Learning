// Human toll ratios by hazard: the loader behind ~/utils/dashboard/impactRatios.
// Per specific HIPs hazard (cluster when no hazard is coded), the median of
// injured / deaths over records reporting both above 0, and the median of
// displaced / dwellings destroyed over records reporting both above 0.
// Records under review for either measure are left out.

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import { displacedHeadlineSql } from "~/backend.server/models/analytics/displacedHeadline";
import {
	humanEffectsFilteredRecords,
	underReviewFor,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	housesCte,
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { ImpactRatio, ImpactRatios } from "~/utils/dashboard/impactRatios";

/** A ratio needs at least this many records reporting both figures. */
export const RATIO_MIN_RECORDS = 10;
/** Hazards listed, most records first. */
export const RATIO_TOP = 15;

const ratio = (median: unknown, n: unknown): ImpactRatio => {
	const records = num(n);
	const suppressed = records < RATIO_MIN_RECORDS || median == null;
	return {
		median: suppressed ? null : Math.round(Number(median) * 100) / 100,
		records,
		suppressed,
	};
};

async function computeImpactRatios(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactRatios> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const deaths = sql`hcp."deaths_total"`;
	const injured = sql`hcp."injured_total"`;
	const displaced = displacedHeadlineSql("hcp");
	const result = await rows(sql`
		WITH RECURSIVE ${humanEffectsFilteredRecords(filters)}, ${housesCte},
		rv AS (
			SELECT
				COALESCE(NULLIF(rec."hip_hazard_id", ''), 'cluster:' || NULLIF(rec."hip_cluster_id", ''), 'none') AS k,
				CASE WHEN ${deaths} > 0 AND ${injured} > 0
					AND NOT ${underReviewFor("deaths", sql`fr.pflags`, deaths)}
					AND NOT ${underReviewFor("injured", sql`fr.pflags`, injured)}
					THEN ${injured}::float8 / ${deaths} END AS ipd,
				CASE WHEN ${displaced} > 0 AND h.td > 0
					AND NOT ${underReviewFor("displaced", sql`fr.pflags`, displaced)}
					AND NOT ${underReviewFor("houses_destroyed", sql`fr.pflags`, sql`h.td`)}
					THEN ${displaced}::float8 / h.td END AS dpd
			FROM filtered_records fr
			JOIN "disaster_records" rec ON rec."id" = fr.record_id
			LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			LEFT JOIN houses h ON h."record_id" = fr.record_id
		)
		SELECT rv.k,
			COALESCE(hz."name_en", cl."name_en" || ' (specific hazard not recorded)', 'Hazard not coded') AS label,
			COUNT(*) AS n_all,
			percentile_cont(0.5) WITHIN GROUP (ORDER BY ipd) AS ipd_median, COUNT(ipd) AS ipd_n,
			percentile_cont(0.5) WITHIN GROUP (ORDER BY dpd) AS dpd_median, COUNT(dpd) AS dpd_n
		FROM rv
		LEFT JOIN "hip_hazard" hz ON hz."id" = rv.k
		LEFT JOIN "hip_cluster" cl ON 'cluster:' || cl."id" = rv.k
		GROUP BY 1, 2
		HAVING COUNT(ipd) > 0 OR COUNT(dpd) > 0
		ORDER BY COUNT(ipd) + COUNT(dpd) DESC, 2
		LIMIT ${RATIO_TOP}`);
	return {
		minRecords: RATIO_MIN_RECORDS,
		rows: result.map((r) => ({
			key: r.k as string,
			label: r.label as string,
			injuredPerDeath: ratio(r.ipd_median, r.ipd_n),
			displacedPerDwellingDestroyed: ratio(r.dpd_median, r.dpd_n),
		})),
		meta: {
			method: `Per specific HIPs hazard, the median of injured per death over disaster records reporting both above 0, and the median of people displaced per dwelling destroyed over records reporting both above 0; records under review for either figure are left out; a ratio needs ${RATIO_MIN_RECORDS} or more records, else it is not shown. A pattern across records, not a rate: reporting practice differs by hazard and country.`,
			notApplied,
		},
	};
}

/** getImpactRatios, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getImpactRatios(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactRatios> {
	return cachedDashboard("getImpactRatios", [ctx, query], () =>
		computeImpactRatios(query, ctx),
	);
}
