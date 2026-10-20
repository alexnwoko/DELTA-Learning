// Estimated sex and age split of people affected (Alex, 2026-10-19): the
// loader behind ~/utils/dashboard/estimatedDisaggregation. For each start
// year, the reported people affected in the records in scope are split by
// the country's population structure for that year (UN DESA WPP 2024, five-
// year age groups by sex, held in ref.value). Left out and counted:
// Biological records (disease cases have their own age profile), records
// under review (a plausibility flag or above the ceiling), records with no
// start year, records before 1950 (no WPP year), and years with no reference
// structure. Deaths, missing, injured and displaced are refused: disaster
// mortality and injury skew by age and sex, so a population structure would
// mislead (seasonality and disaggregation research, 2026-10-19).

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import {
	underReviewFor,
	humanEffectsFilteredRecords,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import {
	ESTIMABLE_MEASURES,
	type EstimableMeasure,
	type EstimatedCell,
	type EstimatedDisaggregation,
} from "~/utils/dashboard/estimatedDisaggregation";

/** The reference structure the estimate uses. */
export const ESTIMATE_REFERENCE = {
	source: "UN DESA World Population Prospects 2024",
	release: "WPP 2024",
	licence: "CC BY 3.0 IGO",
} as const;

/** HIPs type of Biological hazards, left out of the estimate. */
const BIOLOGICAL_TYPE = "1037";
/** First year WPP covers. */
const FIRST_REFERENCE_YEAR = 1950;

const GROUPS = [
	...Array.from({ length: 20 }, (_, i) => `${i * 5}-${i * 5 + 4}`),
	"100+",
];
const groupCode = (sex: "F" | "M", g: string) =>
	g === "100+"
		? `POP_${sex}_100P`
		: `POP_${sex}_${g
				.split("-")
				.map((x) => x.padStart(2, "0"))
				.join("_")}`;
const bandOf = (g: string): "0-14" | "15-64" | "65+" => {
	const lo = Number(g.replace("+", "").split("-")[0]);
	return lo < 15 ? "0-14" : lo < 65 ? "15-64" : "65+";
};

/** Three significant figures: an estimate never claims single-person precision. */
const round3 = (v: number) => {
	if (v === 0) return 0;
	const mag = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 2);
	return Math.round(v / mag) * mag;
};
const est = (v: number | null): EstimatedCell =>
	v === null
		? { value: null, state: "suppressed" }
		: { value: round3(v), state: "estimated" };

const FOOTNOTE = (m: EstimableMeasure) =>
	`Estimated: the country's sex and age pattern (UN DESA WPP 2024) applied to people ${
		m === "affected_direct" ? "directly" : "indirectly"
	} affected. Not recorded data; not for targeting.`;

async function computeEstimatedDisaggregation(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EstimatedDisaggregation> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const asked = query.measure ?? null;
	const measure: EstimableMeasure = (
		ESTIMABLE_MEASURES as readonly string[]
	).includes(asked ?? "")
		? (asked as EstimableMeasure)
		: "affected_direct";
	const refused =
		asked && !(ESTIMABLE_MEASURES as readonly string[]).includes(asked)
			? {
					measure: asked,
					reason:
						"Not estimated: deaths, missing, injured and displaced skew by age and sex in ways a population structure cannot show.",
				}
			: null;
	const total = sql.raw(`hcp."${measure}_total"`);
	const value = sql`CASE WHEN ${total} > 0 THEN ${total} END`;

	const [perYear, reference] = await Promise.all([
		rows(sql`
			WITH RECURSIVE ${humanEffectsFilteredRecords(filters)}
			SELECT NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int AS year,
				(rec."hip_type_id" = ${BIOLOGICAL_TYPE}) AS bio,
				${underReviewFor(measure, sql`fr.pflags`, value)} AS fl,
				SUM(${value}) AS sum, COUNT(${value}) AS n
			FROM filtered_records fr
			JOIN "disaster_records" rec ON rec."id" = fr.record_id
			JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			WHERE ${value} IS NOT NULL
			GROUP BY 1, 2, 3`),
		rows(sql`
			SELECT extract(year FROM v."period_start")::int AS year,
				v."indicator_code" AS code, v."value"::float8 AS value
			FROM ref."value" v
			JOIN ref."release" rl ON rl."id" = v."release_id"
			JOIN ref."source" s ON s."id" = rl."source_id"
			WHERE v."country_accounts_id" = ${ctx.countryAccountsId}
				AND v."division_id" IS NULL
				AND v."value_state" = 'reported'
				AND v."indicator_code" ~ '^POP_[FM]_'
				AND s."name" = ${ESTIMATE_REFERENCE.source}
				AND rl."version" = ${ESTIMATE_REFERENCE.release}`),
	]);

	const structure = new Map<number, Map<string, number>>();
	for (const r of reference) {
		const y = num(r.year);
		const m = structure.get(y) ?? new Map<string, number>();
		m.set(r.code as string, Number(r.value));
		structure.set(y, m);
	}

	const excluded = {
		biological: 0,
		underReview: 0,
		noYear: 0,
		before1950: 0,
		noReference: 0,
	};
	const sums = new Map<string, number>();
	let baseTotal = 0;
	let recordsUsed = 0;
	for (const r of perYear) {
		const n = num(r.n);
		if (r.bio === true) excluded.biological += n;
		else if (r.fl === true) excluded.underReview += n;
		else if (r.year == null) excluded.noYear += n;
		else if (num(r.year) < FIRST_REFERENCE_YEAR) excluded.before1950 += n;
		else {
			const s = structure.get(num(r.year));
			const all = s ? [...s.values()].reduce((a, b) => a + b, 0) : 0;
			if (!s || all <= 0) {
				excluded.noReference += n;
				continue;
			}
			const sum = Number(r.sum);
			baseTotal += sum;
			recordsUsed += n;
			for (const [code, pop] of s)
				sums.set(code, (sums.get(code) ?? 0) + (sum * pop) / all);
		}
	}

	const has = recordsUsed > 0 && !refused;
	const cell = (codes: string[]) =>
		est(has ? codes.reduce((a, c) => a + (sums.get(c) ?? 0), 0) : null);
	const codesOf = (sex: "F" | "M", f: (g: string) => boolean) =>
		GROUPS.filter(f).map((g) => groupCode(sex, g));

	return {
		measure,
		refused,
		baseTotal: has ? baseTotal : null,
		recordsUsed,
		bands: (["0-14", "15-64", "65+"] as const).map((band) => ({
			band,
			female: cell(codesOf("F", (g) => bandOf(g) === band)),
			male: cell(codesOf("M", (g) => bandOf(g) === band)),
		})),
		groups: GROUPS.map((group) => ({
			group,
			female: cell([groupCode("F", group)]),
			male: cell([groupCode("M", group)]),
		})),
		female: cell(codesOf("F", () => true)),
		male: cell(codesOf("M", () => true)),
		excluded,
		reference: { ...ESTIMATE_REFERENCE },
		footnote: FOOTNOTE(measure),
		notForTargeting: true,
		meta: {
			method: `Estimate: for each start year, reported ${measure} in the records in scope multiplied by the country's share of population in each sex and five-year age group that year (${ESTIMATE_REFERENCE.source}, ${ESTIMATE_REFERENCE.release}), then summed; rounded to three significant figures. Left out and counted: Biological records, records under review, records with no start year or before ${FIRST_REFERENCE_YEAR}, and years with no reference structure. Deaths, missing, injured and displaced are not estimated. Not recorded data; not for targeting.`,
			notApplied,
		},
	};
}

/** getEstimatedDisaggregation, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getEstimatedDisaggregation(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EstimatedDisaggregation> {
	return cachedDashboard("getEstimatedDisaggregation", [ctx, query], () =>
		computeEstimatedDisaggregation(query, ctx),
	);
}
