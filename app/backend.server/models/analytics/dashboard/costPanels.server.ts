// Cost panels (Alex, 2026-10-22): the loader behind ~/utils/dashboard/costPanels.
// Source-reported money per disaster record (DesInventar valorloc in the
// country's currency, valorus in US dollars), the ruling that each country's
// values are in its own currency, and the World Bank official exchange rate
// for the record's year (ref.value FX_LCU_PER_USD). Values dated before a
// change of currency unit, local values that copy the dollar value, and years
// with no rate are left out and counted.

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql, type SQL } from "drizzle-orm";
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
import type { CostPanels, Money } from "~/utils/dashboard/costPanels";
import { currencyName, currencyUnitFrom } from "~/utils/currencyHistory";
import { measureValue } from "~/utils/valueState";

/** A median per person needs at least this many records reporting both. */
export const COST_PER_PERSON_MIN_RECORDS = 10;
/** Hazards listed, most costed records first. */
export const COST_HAZARD_TOP = 15;

const NUMERIC = "'^-?[0-9]+(\\.[0-9]+)?$'";
const legacyNumber = (key: string) =>
	sql.raw(
		`CASE WHEN rec."legacy_data" ->> '${key}' ~ ${NUMERIC} THEN (rec."legacy_data" ->> '${key}')::numeric END`,
	);

/** The only rate used for US dollars (Alex, 2026-10-22): one source, stated on every view. */
export const FX_RATE = {
	source: "World Bank",
	indicator: "PA.NUS.FCRF",
	label: "World Bank official exchange rate (annual average)",
} as const;

const DISCLAIMER = (code: string, name: string) =>
	`Source-reported values, taken to be in ${name} (${code}) for every record; DesInventar did not record the currency. Damage and losses are not separated. Converted to US dollars with one rate only: the World Bank official exchange rate (annual average, PA.NUS.FCRF) for the record's year. No parallel, market or central-bank rates are used. Not a Sendai C-1 value.`;

const money = (local: unknown, usd: unknown): Money => ({
	local: local == null ? null : Math.round(Number(local)),
	usd: usd == null ? null : Math.round(Number(usd)),
});

async function computeCostPanels(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<CostPanels> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const tenant = (
		await rows(sql`
			SELECT upper(c."iso3") AS iso3, s."currency_code" AS currency
			FROM "country_accounts" ca
			JOIN "countries" c ON c."id" = ca."country_id"
			LEFT JOIN "instance_system_settings" s ON s."country_accounts_id" = ca."id"
			WHERE ca."id" = ${ctx.countryAccountsId}`)
	)[0];
	const iso3 = (tenant?.iso3 as string | null) ?? "";
	const currency = (tenant?.currency as string | null) ?? "USD";
	// The tenant's newest World Bank release; earlier releases stay in the
	// store for audit but never mix into the figures.
	const fxRelease = (
		await rows(sql`
			SELECT rl."id" AS id, rl."version" AS version
			FROM ref."release" rl
			WHERE rl."deprecated_by" IS NULL AND EXISTS (
				SELECT 1 FROM ref."value" v WHERE v."release_id" = rl."id"
					AND v."country_accounts_id" = ${ctx.countryAccountsId}
					AND v."indicator_code" = 'FX_LCU_PER_USD')
			ORDER BY rl."created_at" DESC LIMIT 1`)
	)[0];
	const fxReleaseId = (fxRelease?.id as string | null) ?? null;
	const unitFrom = currencyUnitFrom(iso3) ?? 0;
	const isDollar = currency === "USD" || currency === "PAB";

	// The people measure: directly affected, or indirectly affected where the
	// country records only that (as the estimated split).
	const fr = humanEffectsFilteredRecords(filters);
	const direct = await rows(sql`
		WITH RECURSIVE ${fr}
		SELECT COUNT(*) AS n FROM filtered_records f
		JOIN "human_category_presence" hcp ON hcp."record_id" = f.record_id
		WHERE hcp."affected_direct_total" > 0`);
	const peopleMeasure: CostPanels["peopleMeasure"] =
		num(direct[0]?.n) > 0 ? "affected_direct" : "affected_indirect";
	const people = sql.raw(`hcp."${peopleMeasure}_total"`);
	const peopleFlag = sql.raw(`hcp."${peopleMeasure}"`);

	const base: SQL = sql`
		WITH RECURSIVE ${fr},
		fx AS (
			SELECT extract(year FROM v."period_start")::int AS year, v."value"::float8 AS rate
			FROM ref."value" v
			WHERE v."country_accounts_id" = ${ctx.countryAccountsId}
				AND v."release_id" = ${fxReleaseId}
				AND v."division_id" IS NULL AND v."indicator_code" = 'FX_LCU_PER_USD'
				AND v."value_state" = 'reported' AND v."value" > 0
		),
		r0 AS (
			SELECT fr.record_id, rec."disaster_event_id" AS ev,
				COALESCE(NULLIF(rec."hip_hazard_id", ''), 'cluster:' || NULLIF(rec."hip_cluster_id", ''), 'none') AS k,
				NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int AS year,
				${legacyNumber("valorloc")} AS loc,
				${legacyNumber("valorus")} AS usdsrc,
				CASE WHEN ${people} > 0 THEN ${people} END AS ppl,
				COALESCE((${people} = 0 AND ${peopleFlag} IS TRUE) OR (${peopleFlag} IS FALSE AND COALESCE(${people}, 0) = 0), false) AS ppl_zero
			FROM filtered_records fr
			JOIN "disaster_records" rec ON rec."id" = fr.record_id
			LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		),
		r1 AS (
			SELECT r0.*, fx.rate,
				-- COALESCE: a comparison with a missing value is not true; never let
				-- an unknown flag drop a good value.
				COALESCE(r0.loc > 0 AND r0.year < ${unitFrom}, false) AS pre,
				COALESCE(r0.loc > 0 AND r0.usdsrc = r0.loc AND NOT ${isDollar}, false) AS copy
			FROM r0 LEFT JOIN fx ON fx.year = r0.year
		),
		rv AS (
			SELECT r1.*,
				(r1.loc > 0 AND NOT r1.pre AND NOT r1.copy AND r1.rate IS NOT NULL) AS loc_ok,
				CASE
					WHEN r1.loc > 0 AND NOT r1.pre AND NOT r1.copy AND r1.rate IS NOT NULL THEN r1.loc::float8 / r1.rate
					WHEN r1.usdsrc > 0 THEN r1.usdsrc::float8
				END AS usd,
				CASE
					WHEN r1.loc > 0 AND NOT r1.pre AND NOT r1.copy AND r1.rate IS NOT NULL THEN r1.loc::float8
					WHEN r1.usdsrc > 0 AND r1.rate IS NOT NULL THEN r1.usdsrc::float8 * r1.rate
				END AS lcl
			FROM r1
		)`;

	// One pass: the hazard rows and the overall row (grouping sets).
	const [grouped, events] = await Promise.all([
		rows(sql`${base}
			SELECT GROUPING(rv.k, rv.year) AS g, rv.k, rv.year,
				COALESCE(hz."name_en", cl."name_en" || ' (specific hazard not recorded)', 'Hazard not coded') AS label,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE usd IS NOT NULL OR lcl IS NOT NULL) AS costed,
				COUNT(*) FILTER (WHERE usd IS NULL AND lcl IS NULL) AS not_costed,
				SUM(lcl) AS lcl_sum, SUM(usd) AS usd_sum,
				percentile_cont(0.5) WITHIN GROUP (ORDER BY lcl) AS lcl_med,
				percentile_cont(0.5) WITHIN GROUP (ORDER BY usd) AS usd_med,
				percentile_cont(0.5) WITHIN GROUP (ORDER BY lcl / ppl) FILTER (WHERE ppl IS NOT NULL) AS lcl_ppm,
				percentile_cont(0.5) WITHIN GROUP (ORDER BY usd / ppl) FILTER (WHERE ppl IS NOT NULL) AS usd_ppm,
				SUM(ppl) FILTER (WHERE usd IS NULL AND lcl IS NULL) AS ppl_not,
				SUM(ppl) FILTER (WHERE usd IS NOT NULL OR lcl IS NOT NULL) AS ppl_c,
				COUNT(ppl) FILTER (WHERE usd IS NOT NULL OR lcl IS NOT NULL) AS ppl_c_n,
				COUNT(*) FILTER (WHERE ppl IS NULL AND ppl_zero AND (usd IS NOT NULL OR lcl IS NOT NULL)) AS ppl_c_z,
				SUM(ppl) FILTER (WHERE usd IS NULL AND lcl IS NULL) AS ppl_n,
				COUNT(ppl) FILTER (WHERE usd IS NULL AND lcl IS NULL) AS ppl_n_n,
				COUNT(*) FILTER (WHERE ppl IS NULL AND ppl_zero AND usd IS NULL AND lcl IS NULL) AS ppl_n_z,
				SUM(lcl) FILTER (WHERE ppl IS NOT NULL) AS lcl_pp, SUM(usd) FILTER (WHERE ppl IS NOT NULL) AS usd_pp,
				SUM(ppl) FILTER (WHERE ppl IS NOT NULL AND usd IS NOT NULL) AS ppl_pp,
				COUNT(*) FILTER (WHERE ppl IS NOT NULL AND usd IS NOT NULL) AS pp_n,
				COUNT(*) FILTER (WHERE pre) AS pre, COUNT(*) FILTER (WHERE copy AND NOT pre) AS copy,
				COUNT(*) FILTER (WHERE loc > 0 AND NOT pre AND NOT copy AND rate IS NULL) AS norate
			FROM rv
			LEFT JOIN "hip_hazard" hz ON hz."id" = rv.k
			LEFT JOIN "hip_cluster" cl ON 'cluster:' || cl."id" = rv.k
			GROUP BY GROUPING SETS ((rv.k, hz."name_en", cl."name_en"), (rv.year), ())`),
		rows(sql`${base}
			SELECT COUNT(DISTINCT ev) AS total,
				COUNT(DISTINCT ev) FILTER (WHERE usd IS NOT NULL OR lcl IS NOT NULL) AS costed
			FROM rv WHERE ev IS NOT NULL`),
	]);
	// GROUPING(k, year): 1 = hazard rows, 2 = year rows, 3 = overall.
	const overall = grouped.filter((r) => num(r.g) === 3);
	const yearRows = grouped.filter((r) => num(r.g) === 2);
	const byHazard = grouped
		.filter((r) => num(r.g) === 1 && num(r.costed) > 0)
		.sort(
			(a, b) =>
				num(b.costed) - num(a.costed) ||
				String(a.label).localeCompare(String(b.label)),
		)
		.slice(0, COST_HAZARD_TOP);
	const o = overall[0] ?? {};
	const cell = (sum: unknown, n: unknown, z: unknown, t: unknown) =>
		measureValue({
			sum: num(n) > 0 ? (sum as number | string) : null,
			reported: n as number | string,
			zeroConfirmed: z as number | string,
			total: t as number | string,
		});
	const ppN = num(o.pp_n);
	const dated = yearRows.filter((r) => r.year != null);
	// The chart starts at the first year with a value (charts start where
	// their data starts); earlier records are counted, not drawn.
	const costedYears = dated.filter((r) => num(r.costed) > 0);
	const firstYear = Math.min(...costedYears.map((r) => num(r.year)));
	const lastYear = Math.max(...dated.map((r) => num(r.year)));
	const perYear = new Map(dated.map((r) => [num(r.year), r]));
	const byYear: CostPanels["byYear"] = [];
	for (let y = firstYear; costedYears.length > 0 && y <= lastYear; y++) {
		const r = perYear.get(y);
		byYear.push({
			year: y,
			records: num(r?.total),
			costedRecords: num(r?.costed),
			notCostedRecords: num(r?.not_costed),
			total:
				r && num(r.costed) > 0
					? money(r.lcl_sum, r.usd_sum)
					: { local: null, usd: null },
		});
	}
	const noYear = yearRows.find((r) => r.year == null);
	const name = currencyName(currency);

	return {
		currency: { code: currency, name },
		disclaimer: DISCLAIMER(currency, name),
		fxRate: {
			...FX_RATE,
			release: (fxRelease?.version as string | null) ?? null,
		},
		peopleMeasure,
		total: { ...money(o.lcl_sum, o.usd_sum), records: num(o.costed) },
		coverage: {
			records: {
				total: num(o.total),
				costed: num(o.costed),
				notCosted: num(o.total) - num(o.costed),
			},
			events: {
				total: num(events[0]?.total),
				costed: num(events[0]?.costed),
				notCosted: num(events[0]?.total) - num(events[0]?.costed),
			},
			people: {
				costed: cell(o.ppl_c, o.ppl_c_n, o.ppl_c_z, o.costed),
				notCosted: cell(o.ppl_n, o.ppl_n_n, o.ppl_n_z, o.not_costed),
			},
			costPerPerson: {
				local:
					ppN > 0 && num(o.ppl_pp) > 0
						? Math.round((num(o.lcl_pp) / num(o.ppl_pp)) * 100) / 100
						: null,
				usd:
					ppN > 0 && num(o.ppl_pp) > 0
						? Math.round((num(o.usd_pp) / num(o.ppl_pp)) * 100) / 100
						: null,
				records: ppN,
			},
		},
		excluded: {
			beforeCurrencyChange: num(o.pre),
			copiedFromUsd: num(o.copy),
			noRate: num(o.norate),
		},
		byHazard: byHazard.map((r) => {
			const n = num(r.pp_n);
			const shown = n >= COST_PER_PERSON_MIN_RECORDS;
			const pp = (v: unknown) =>
				shown && v != null ? Math.round(Number(v) * 100) / 100 : null;
			const perPerson = {
				local: pp(r.lcl_ppm),
				usd: pp(r.usd_ppm),
				records: n,
			};
			const pplNot = r.ppl_not == null ? null : num(r.ppl_not);
			return {
				key: r.k as string,
				label: r.label as string,
				costedRecords: num(r.costed),
				notCostedRecords: num(r.not_costed),
				total: money(r.lcl_sum, r.usd_sum),
				medianPerRecord: money(r.lcl_med, r.usd_med),
				medianPerPerson: perPerson,
				peopleNotCosted: pplNot,
				projectionNotCosted:
					shown && pplNot !== null && perPerson.usd !== null
						? money(
								perPerson.local === null ? null : perPerson.local * pplNot,
								perPerson.usd * pplNot,
							)
						: null,
			};
		}),
		byYear,
		recordsNoYear: num(noYear?.total),
		recordsBeforeFirstYear: dated
			.filter((r) => costedYears.length > 0 && num(r.year) < firstYear)
			.reduce((n, r) => n + num(r.total), 0),
		projectionNote: `Illustrative only: if the records with no value cost what the costed records of the same hazard cost per person affected (median, at least ${COST_PER_PERSON_MIN_RECORDS} records), this is the order of magnitude. Not a loss estimate: costed records are not a random sample, and the figure is never added to any total.`,
		meta: {
			method: `Per disaster record, the source-reported value (DesInventar valorloc in ${currency}, or valorus in US dollars where no usable local value exists). Local values are taken to be in ${currency}; US dollars use the World Bank official rate (PA.NUS.FCRF) for the record's start year. Left out and counted: local values dated before the country's change of currency unit, local values equal to the dollar value in a non-dollar country, and years with no rate. Cost per person uses ${peopleMeasure} over records reporting both.`,
			notApplied,
		},
	};
}

/** getCostPanels, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getCostPanels(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<CostPanels> {
	return cachedDashboard("getCostPanels", [ctx, query], () =>
		computeCostPanels(query, ctx),
	);
}
