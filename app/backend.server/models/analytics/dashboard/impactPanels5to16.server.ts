// D1 Analysis dashboard, Disaster impact panels 5 to 16: the loader behind
// the payload types in ~/utils/dashboard/impactPanels5to16. Same rules as
// panels 1 to 4: one delta.query/1 object in, every figure a cell with its
// value state and record counts (TR-076), never a bare 0.

import { sql, type SQL } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	getAffectedPeopleByHazardFilters,
	getHumanEffectsGrouped,
	humanEffectMeasuresFromRow,
	humanEffectMeasuresSelect,
	humanEffectsFilteredRecords,
	plausibilityFlagged,
	type HazardFilters,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	displacedHeadlineSql,
	evacuatedSql,
	relocatedSql,
} from "~/backend.server/models/analytics/displacedHeadline";
import {
	chosenMeasure,
	EMPTY_CELL,
	hipTypeLabels,
	impactFiltersFromQuery,
	rankValue,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import type { DeltaQuery, QueryHumanEffect } from "~/utils/deltaQuery";
import { measureValue } from "~/utils/valueState";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type {
	CompletenessMatrix,
	DisaggregationPanel,
	ExtensiveIntensive,
	HazardEffectMatrix,
	HazardSectorMatrix,
	HousesPanel,
	ImpactPanels5to16,
	LargestRecords,
	PeopleMovedPanel,
	PeriodChange,
	RankedDivisions,
	SeasonGrid,
	SendaiCountsPanel,
} from "~/utils/dashboard/impactPanels5to16";
import type {
	ImpactMapArea,
	ImpactMapPayload,
} from "~/utils/dashboard/impactMap";
import { divisionLabelPoints } from "~/backend.server/models/analytics/divisionLabelPoints";

/** Simplification tolerance for the impact map shapes, in degrees (about 500 m). */
export const MAP_SIMPLIFY_DEGREES = 0.005;
/** Divisions shown by name in panel 7 before the rest are grouped. */
export const RANKED_DIVISIONS_TOP = 15;
/** Records listed in panel 11. */
export const LARGEST_RECORDS_TOP = 10;
/** Years in each period of panel 14. */
export const PERIOD_YEARS = 10;
/** GAR 2015 intensive-risk thresholds per record (ruling RV-2). */
export const GAR_THRESHOLD = { deaths: 30, housesDestroyed: 600 } as const;

/** The Housing sector (seed migration 20250813075915). */
const HOUSING_SECTOR_ID = "6ac0b833-6218-49d0-9882-827c1b748d7a";

/** Effects drawn in the hazard by effect matrix, in column order. */
const MATRIX_EFFECTS: QueryHumanEffect[] = [
	"deaths",
	"missing",
	"injured",
	"affected_direct",
	"displaced",
];

/**
 * Houses destroyed (td) and damaged (pd) per record: counted damage rows in
 * the Housing sector or below it, leaving out furniture and equipment.
 */
export const housesCte = sql`houses AS (
	SELECT d."record_id",
		SUM(d."td_damage_amount") AS td,
		SUM(d."pd_damage_amount") AS pd
	FROM "damages" d
	JOIN filtered_records fr ON fr.record_id = d."record_id"
	JOIN "asset" a ON a."id" = d."asset_id"
	WHERE d."unit" = 'number_count'
		AND d."sector_id" IN (
			SELECT s."id" FROM "sector" s
			WHERE s."id" = ${HOUSING_SECTOR_ID}::uuid
				OR s."parent_id" = ${HOUSING_SECTOR_ID}::uuid
				OR s."parent_id" IN (
					SELECT "id" FROM "sector" WHERE "parent_id" = ${HOUSING_SECTOR_ID}::uuid
				)
		)
		AND COALESCE(a."built_in_category" ->> 'en', a."custom_category", '')
			<> 'Furniture and Equipment'
	GROUP BY 1
)`;

/** Each record's level-1 divisions (a record in several counts in each). */
function recordDivisionsCte(countryAccountsId: string): SQL {
	return sql`div_up AS (
		SELECT "id", "id" AS l1_id
		FROM "division"
		WHERE "level" = 1 AND "country_accounts_id" = ${countryAccountsId}
		UNION ALL
		SELECT d."id", u.l1_id
		FROM "division" d
		JOIN div_up u ON d."parent_id" = u."id"
	),
	rec_l1 AS (
		SELECT DISTINCT fr.record_id, u.l1_id
		FROM filtered_records fr
		JOIN "disaster_records_division" drd ON drd."disaster_record_id" = fr.record_id
		JOIN div_up u ON u."id" = drd."division_id"
	)`;
}

const yearExpr = sql`NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int`;
const monthExpr = sql`NULLIF(substring(rec."start_date" from '^[0-9]{4}-([0-9]{2})'), '')::int`;

export async function rows(query: SQL): Promise<Record<string, unknown>[]> {
	return (await dr.execute(query)).rows as Record<string, unknown>[];
}

export const num = (v: unknown): number =>
	v === null || v === undefined ? 0 : Number(v);

/** A count measure without a confirmed-zero source (houses, evacuated, relocated). */
function countCell(sum: unknown, reported: unknown, total: unknown): PanelCell {
	return measureValue({
		sum: sum as number | string | null,
		reported: reported as number | string,
		zeroConfirmed: 0,
		total: total as number | string,
	});
}

/** Adds cells of one measure: values of reported cells, and the record counts. */
function addCells(cells: PanelCell[]): PanelCell {
	const reported = cells.filter((c) => c.valueState === "reported");
	return measureValue({
		sum: reported.length
			? reported.reduce((s, c) => s + (c.value ?? 0), 0)
			: null,
		reported: cells.reduce((s, c) => s + c.recordsReported, 0),
		zeroConfirmed: cells.reduce((s, c) => s + c.recordsZeroConfirmed, 0),
		total: cells.reduce((s, c) => s + c.recordsTotal, 0),
		flagged: cells.reduce((s, c) => s + c.recordsFlagged, 0),
	});
}

/** A cell divided by a number of years, keeping its state and counts. */
function perYear(c: PanelCell, years: number): PanelCell {
	return c.value === null
		? c
		: { ...c, value: Math.round((c.value / years) * 100) / 100 };
}

/** Human-effect measures grouped by up to two keys, with optional divisions. */
async function groupedMeasures(
	filters: HazardFilters,
	keys: SQL,
	opts: { divisions?: boolean } = {},
) {
	const divs = opts.divisions
		? sql`, ${recordDivisionsCte(filters.countryAccountsId)}`
		: sql``;
	const divJoin = opts.divisions
		? sql`LEFT JOIN rec_l1 rl ON rl.record_id = fr.record_id`
		: sql``;
	return (
		await rows(sql`
		WITH RECURSIVE ${humanEffectsFilteredRecords(filters)}${divs}
		SELECT ${keys}, ${humanEffectMeasuresSelect()}
		FROM filtered_records fr
		${divJoin}
		LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id
		GROUP BY 1, 2
		ORDER BY 1 NULLS LAST, 2 NULLS LAST`)
	).map((r) => ({
		k1: r.k1,
		k2: r.k2,
		measures: humanEffectMeasuresFromRow(r),
	}));
}

async function divisionNames(
	countryAccountsId: string,
): Promise<Map<string, string>> {
	const res = await rows(sql`
		SELECT "id"::text AS id, COALESCE("name" ->> 'en', "national_id", "id"::text) AS name
		FROM "division"
		WHERE "level" = 1 AND "country_accounts_id" = ${countryAccountsId}`);
	return new Map(res.map((r) => [r.id as string, r.name as string]));
}

const SEX_LABELS: Record<string, string> = {
	m: "Male",
	f: "Female",
	o: "Other",
};

/** The disaggregation table and column read for each effect. */
const DSG_SOURCE: Record<QueryHumanEffect, { table: string; col: string }> = {
	deaths: { table: "deaths", col: "deaths" },
	injured: { table: "injured", col: "injured" },
	missing: { table: "missing", col: "missing" },
	displaced: { table: "displaced", col: "displaced" },
	affected_direct: { table: "affected", col: "direct" },
	affected_indirect: { table: "affected", col: "indirect" },
};

const DSG_DIMS = ["sex", "age", "disability"] as const;
const ALL_DSG_DIMS = [
	"sex",
	"age",
	"disability",
	"global_poverty_line",
	"national_poverty_line",
];

export async function getImpactPanels5to16(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactPanels5to16> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const measure = chosenMeasure(query);
	const fr = humanEffectsFilteredRecords(filters);
	const meta = (method: string, coverage?: string): PanelMeta => ({
		method,
		...(coverage ? { coverage } : {}),
		notApplied,
	});

	const [headline, byType, byYear, labels, divNames] = await Promise.all([
		getAffectedPeopleByHazardFilters(filters),
		getHumanEffectsGrouped(filters, "hipType"),
		getHumanEffectsGrouped(filters, "year"),
		hipTypeLabels(),
		divisionNames(ctx.countryAccountsId),
	]);
	const typeLabel = (id: string | null) =>
		id === null ? "No HIPs type" : (labels.get(id) ?? `HIPs type ${id}`);
	const headCell = headline.measures[measure];
	const coverageText = `Based on ${headCell.recordsReported + headCell.recordsZeroConfirmed} of ${headCell.recordsTotal} records`;
	const typeOrder = [...byType]
		.sort(
			(a, b) => rankValue(b.measures[measure]) - rankValue(a.measures[measure]),
		)
		.map((r) => r.hipTypeId);
	const typeTotals = new Map(
		byType.map((r) => [r.hipTypeId, r.measures.deaths.recordsTotal]),
	);

	// Houses, people moved and the per-record figures, by HIPs type.
	const typeExtras = await rows(sql`
		WITH RECURSIVE ${fr}, ${housesCte}
		SELECT NULLIF(rec."hip_type_id", '') AS hip_type_id,
			SUM(h.td) FILTER (WHERE h.td > 0) AS td_sum,
			COUNT(*) FILTER (WHERE h.td > 0) AS td_reported,
			SUM(h.pd) FILTER (WHERE h.pd > 0) AS pd_sum,
			COUNT(*) FILTER (WHERE h.pd > 0) AS pd_reported,
			SUM(x.evac) FILTER (WHERE x.evac > 0) AS evac_sum,
			COUNT(*) FILTER (WHERE x.evac > 0) AS evac_reported,
			SUM(x.reloc) FILTER (WHERE x.reloc > 0) AS reloc_sum,
			COUNT(*) FILTER (WHERE x.reloc > 0) AS reloc_reported,
			COUNT(*) AS records_total
		FROM filtered_records fr
		JOIN "disaster_records" rec ON rec."id" = fr.record_id
		LEFT JOIN houses h ON h."record_id" = fr.record_id
		CROSS JOIN LATERAL (
			SELECT ${evacuatedSql("fr")} AS evac, ${relocatedSql("fr")} AS reloc
		) x
		GROUP BY 1`);
	const extrasByType = new Map(
		typeExtras.map((r) => [(r.hip_type_id as string | null) ?? null, r]),
	);
	const houseCells = (r: Record<string, unknown> | undefined) => ({
		destroyed: r
			? countCell(r.td_sum, r.td_reported, r.records_total)
			: EMPTY_CELL,
		damaged: r
			? countCell(r.pd_sum, r.pd_reported, r.records_total)
			: EMPTY_CELL,
	});
	const housesAll = {
		destroyed: addCells(typeExtras.map((r) => houseCells(r).destroyed)),
		damaged: addCells(typeExtras.map((r) => houseCells(r).damaged)),
	};

	// Panel 5: Sendai counts.
	const sendai: SendaiCountsPanel = {
		indicators: [
			{ code: "A-2", label: "Deaths", cell: headline.measures.deaths },
			{
				code: "A-3",
				label: "Missing persons",
				cell: headline.measures.missing,
			},
			{ code: "B-2", label: "Injured or ill", cell: headline.measures.injured },
		],
		inputs: [
			{ inputTo: "B-3", label: "Houses damaged", cell: housesAll.damaged },
			{ inputTo: "B-4", label: "Houses destroyed", cell: housesAll.destroyed },
		],
		refused: [
			{ code: "A-1", reason: "Rates need a population denominator (TR-152)" },
			{ code: "B-1", reason: "Rates need a population denominator (TR-152)" },
			{
				code: "B-1 count",
				reason:
					"Directly affected is shown as recorded and is not built from its parts (TR-216)",
			},
		],
	};

	// Panel 6: hazard by effect.
	const hazardEffect: HazardEffectMatrix = {
		effects: MATRIX_EFFECTS,
		rows: typeOrder.map((id) => {
			const r = byType.find((t) => t.hipTypeId === id)!;
			return {
				hipTypeId: id ?? "none",
				label: typeLabel(id),
				cells: MATRIX_EFFECTS.map((e) => r.measures[e]),
			};
		}),
	};

	// Panel 7: ranked divisions; panel 14 reads the same division keys.
	const byDivision = await groupedMeasures(
		filters,
		sql`rl.l1_id::text AS k1, NULL::text AS k2`,
		{ divisions: true },
	);
	const multi = await rows(sql`
		WITH RECURSIVE ${fr}, ${recordDivisionsCte(ctx.countryAccountsId)}
		SELECT COUNT(*) AS n FROM (
			SELECT record_id FROM rec_l1 GROUP BY 1 HAVING COUNT(*) > 1
		) m`);
	const divRows = byDivision
		.map((r) => ({
			divisionId: (r.k1 as string | null) ?? "none",
			name:
				r.k1 === null
					? "No division recorded"
					: (divNames.get(r.k1 as string) ?? `Division ${r.k1}`),
			cell: r.measures[measure],
		}))
		.sort((a, b) => rankValue(b.cell) - rankValue(a.cell));
	const rest = divRows.slice(RANKED_DIVISIONS_TOP);
	const rankedDivisions: RankedDivisions = {
		rows: divRows.slice(0, RANKED_DIVISIONS_TOP),
		rest: rest.length
			? { divisions: rest.length, cell: addCells(rest.map((r) => r.cell)) }
			: null,
		multiDivisionRecords: num(multi[0]?.n),
	};

	// Panel 8: hazard by sector (level-2 sectors).
	const sectorHits = await rows(sql`
		WITH RECURSIVE ${fr},
		sec_up AS (
			SELECT "id", "id" AS top_id FROM "sector" WHERE "level" = 2
			UNION ALL
			SELECT s."id", u.top_id FROM "sector" s JOIN sec_up u ON s."parent_id" = u."id"
		),
		hits AS (
			SELECT x.record_id, u.top_id, bool_or(x.hit) AS hit
			FROM (
				SELECT sdr."disaster_record_id" AS record_id, sdr."sector_id", sdr."with_damage" AS hit
				FROM "sector_disaster_records_relation" sdr
				UNION ALL
				SELECT d."record_id", d."sector_id",
					COALESCE(d."td_damage_amount", 0) + COALESCE(d."pd_damage_amount", 0) > 0
				FROM "damages" d
			) x
			JOIN filtered_records fr ON fr.record_id = x.record_id
			JOIN sec_up u ON u."id" = x."sector_id"
			GROUP BY 1, 2
		)
		SELECT NULLIF(rec."hip_type_id", '') AS hip_type_id, h.top_id::text AS sector_id,
			COALESCE(s."name" ->> 'en', s."sectorname") AS sector_label,
			COUNT(*) FILTER (WHERE h.hit) AS hits,
			COUNT(*) FILTER (WHERE h.hit IS FALSE) AS no_hits
		FROM hits h
		JOIN "disaster_records" rec ON rec."id" = h.record_id
		JOIN "sector" s ON s."id" = h.top_id
		GROUP BY 1, 2, 3`);
	const sectors = [
		...new Map(
			sectorHits.map((r) => [r.sector_id as string, r.sector_label as string]),
		),
	]
		.map(([sectorId, label]) => ({ sectorId, label }))
		.sort((a, b) => a.label.localeCompare(b.label));
	const hazardSector: HazardSectorMatrix = {
		sectors,
		rows: typeOrder.map((id) => ({
			hipTypeId: id ?? "none",
			label: typeLabel(id),
			cells: sectors.map((s) => {
				const h = sectorHits.find(
					(r) => (r.hip_type_id ?? null) === id && r.sector_id === s.sectorId,
				);
				return measureValue({
					sum: h ? num(h.hits) : null,
					reported: h ? num(h.hits) : 0,
					zeroConfirmed: h ? num(h.no_hits) : 0,
					total: typeTotals.get(id) ?? 0,
				});
			}),
		})),
	};

	// Panel 9: people moved, three figures never added (contract O-2).
	const peopleMoved: PeopleMovedPanel = {
		rows: typeOrder.map((id) => {
			const r = byType.find((t) => t.hipTypeId === id)!;
			const x = extrasByType.get(id);
			return {
				hipTypeId: id ?? "none",
				label: typeLabel(id),
				displaced: r.measures.displaced,
				evacuated: x
					? countCell(x.evac_sum, x.evac_reported, x.records_total)
					: EMPTY_CELL,
				relocated: x
					? countCell(x.reloc_sum, x.reloc_reported, x.records_total)
					: EMPTY_CELL,
			};
		}),
		overlapNote:
			"Displaced includes people evacuated before the event and leaves out people relocated permanently after it. Evacuated and relocated overlap with displaced, so the three figures are never added.",
	};

	// Panel 10: houses by HIPs type.
	const houses: HousesPanel = {
		groupBy: "hipType",
		rows: typeOrder.map((id) => ({
			key: id ?? "none",
			label: typeLabel(id),
			...houseCells(extrasByType.get(id)),
		})),
	};

	// Panel 11: largest records for the chosen measure.
	const valueSql =
		measure === "displaced"
			? displacedHeadlineSql("hcp")
			: sql.raw(`hcp."${measure}_total"`);
	const largest = await rows(sql`
		WITH RECURSIVE ${fr}
		SELECT rec."id"::text AS id, rec."start_date",
			(SELECT string_agg(DISTINCT dv."name" ->> 'en', ', ')
				FROM "disaster_records_division" drd
				JOIN "division" dv ON dv."id" = drd."division_id"
				WHERE drd."disaster_record_id" = rec."id") AS division_name,
			COALESCE(hh."name_en", hc."name_en", ht."name_en", 'No HIPs type') AS hazard_label,
			v.value,
			${plausibilityFlagged(sql`rec."legacy_data"`, [measure])} AS flagged,
			(SELECT array_agg(DISTINCT pf ->> 'code')
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(rec."legacy_data" -> 'migration' -> 'plausibility_flags') = 'array'
						THEN rec."legacy_data" -> 'migration' -> 'plausibility_flags'
						ELSE '[]'::jsonb END) pf) AS flags
		FROM filtered_records fr
		JOIN "disaster_records" rec ON rec."id" = fr.record_id
		JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		CROSS JOIN LATERAL (SELECT ${valueSql} AS value) v
		LEFT JOIN "hip_hazard" hh ON hh."id"::text = rec."hip_hazard_id"
		LEFT JOIN "hip_cluster" hc ON hc."id"::text = rec."hip_cluster_id"
		LEFT JOIN "hip_class" ht ON ht."id"::text = rec."hip_type_id"
		WHERE v.value > 0
		ORDER BY v.value DESC, rec."id"
		LIMIT ${LARGEST_RECORDS_TOP}`);
	const largestRecords: LargestRecords = {
		measure,
		rows: largest.map((r) => ({
			recordId: r.id as string,
			startDate: (r.start_date as string | null) || null,
			divisionName: (r.division_name as string | null) ?? null,
			hazardLabel: r.hazard_label as string,
			cell: measureValue({
				sum: r.value as number | string,
				reported: 1,
				zeroConfirmed: 0,
				total: 1,
				flagged: r.flagged ? 1 : 0,
			}),
			flags: ((r.flags as (string | null)[] | null) ?? []).filter(
				(f): f is string => !!f,
			),
		})),
	};

	// Panel 12: completeness.
	const comp = (
		await rows(sql`
		WITH RECURSIVE ${fr}, ${housesCte}
		SELECT COUNT(*) AS total,
			COUNT(*) FILTER (WHERE rec."start_date" ~ '^[0-9]{4}-[0-9]{2}') AS with_month,
			COUNT(*) FILTER (WHERE EXISTS (
				SELECT 1 FROM "disaster_records_division" drd
				WHERE drd."disaster_record_id" = fr.record_id)) AS with_division,
			COUNT(*) FILTER (WHERE NULLIF(rec."hip_type_id", '') IS NOT NULL) AS with_type,
			COUNT(*) FILTER (WHERE h."record_id" IS NOT NULL) AS with_houses
		FROM filtered_records fr
		JOIN "disaster_records" rec ON rec."id" = fr.record_id
		LEFT JOIN houses h ON h."record_id" = fr.record_id`)
	)[0];
	const total = num(comp?.total);
	const share = (n: number) => (total > 0 ? n / total : null);
	const effectLabels: Record<string, string> = {
		deaths: "Deaths",
		missing: "Missing",
		injured: "Injured or ill",
		affected_direct: "Directly affected",
		displaced: "Displaced",
	};
	const completeness: CompletenessMatrix = {
		rows: [
			...MATRIX_EFFECTS.map((e) => {
				const c = headline.measures[e];
				const n = c.recordsReported + c.recordsZeroConfirmed;
				return {
					key: e,
					label: effectLabels[e],
					share: share(n),
					recordsWith: n,
					recordsTotal: total,
				};
			}),
			...(
				[
					[
						"housesDamagedOrDestroyed",
						"Houses damaged or destroyed",
						comp?.with_houses,
					],
					["startMonth", "Start date to the month", comp?.with_month],
					["division", "Division recorded", comp?.with_division],
					["hipType", "HIPs type recorded", comp?.with_type],
				] as const
			).map(([key, label, n]) => ({
				key,
				label,
				share: share(num(n)),
				recordsWith: num(n),
				recordsTotal: total,
			})),
		],
		lowShareThreshold: 0.25,
	};

	// Panel 13: season of impact.
	const byMonth = await groupedMeasures(
		filters,
		sql`${yearExpr} AS k1, ${monthExpr} AS k2`,
	);
	const season: SeasonGrid = {
		measure,
		cells: byMonth
			.filter((r) => r.k1 !== null && r.k2 !== null)
			.map((r) => ({
				year: Number(r.k1),
				month: Number(r.k2),
				cell: r.measures[measure],
			})),
		recordsWithoutMonth: byMonth
			.filter((r) => r.k1 === null || r.k2 === null)
			.reduce((s, r) => s + r.measures[measure].recordsTotal, 0),
	};

	// Panel 14: two periods of PERIOD_YEARS ending at the last year with records.
	const years = byYear
		.map((r) => r.year)
		.filter((y): y is number => y !== null);
	const lastYear = years.length
		? Math.max(...years)
		: new Date().getFullYear() - 1;
	const periodB = {
		from: lastYear - PERIOD_YEARS + 1,
		to: lastYear,
		years: PERIOD_YEARS,
	};
	const periodA = {
		from: periodB.from - PERIOD_YEARS,
		to: periodB.from - 1,
		years: PERIOD_YEARS,
	};
	const byDivPeriod = await groupedMeasures(
		filters,
		sql`rl.l1_id::text AS k1,
			CASE
				WHEN ${yearExpr} BETWEEN ${periodA.from} AND ${periodA.to} THEN 'A'
				WHEN ${yearExpr} BETWEEN ${periodB.from} AND ${periodB.to} THEN 'B'
			END AS k2`,
		{ divisions: true },
	);
	const periodCell = (id: unknown, p: "A" | "B") => {
		const r = byDivPeriod.find((x) => x.k1 === id && x.k2 === p);
		return r ? perYear(r.measures[measure], PERIOD_YEARS) : EMPTY_CELL;
	};
	const periodChange: PeriodChange = {
		measure,
		periodA,
		periodB,
		rows: [
			...new Set(byDivPeriod.filter((r) => r.k1 !== null).map((r) => r.k1)),
		]
			.map((id) => ({
				divisionId: id as string,
				name: divNames.get(id as string) ?? `Division ${id}`,
				averageA: periodCell(id, "A"),
				averageB: periodCell(id, "B"),
			}))
			.sort((a, b) => rankValue(b.averageB) - rankValue(a.averageB)),
		label: "Analytical periods; not a Sendai performance measure.",
	};

	// Panel 15: extensive and intensive risk (GAR 2015 per record).
	const gar = (
		await rows(sql`
		WITH RECURSIVE ${fr}, ${housesCte},
		per_rec AS (
			SELECT hcp."deaths_total" AS deaths, hcp."deaths" AS deaths_flag, h.td
			FROM filtered_records fr
			LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			LEFT JOIN houses h ON h."record_id" = fr.record_id
		),
		classed AS (
			SELECT *,
				CASE
					WHEN deaths >= ${GAR_THRESHOLD.deaths} OR td >= ${GAR_THRESHOLD.housesDestroyed} THEN 'intensive'
					WHEN deaths IS NOT NULL OR deaths_flag IS NOT NULL OR td IS NOT NULL THEN 'extensive'
				END AS class
			FROM per_rec
		)
		SELECT class,
			SUM(deaths) FILTER (WHERE deaths > 0) AS sum,
			COUNT(*) FILTER (WHERE deaths > 0) AS reported,
			COUNT(*) FILTER (
				WHERE (deaths = 0 AND deaths_flag IS TRUE)
					OR (deaths_flag IS FALSE AND COALESCE(deaths, 0) = 0)
			) AS zero,
			COUNT(*) AS total
		FROM classed
		GROUP BY 1`)
	).reduce<Record<string, Record<string, unknown>>>(
		(m, r) => ({ ...m, [(r.class as string | null) ?? "none"]: r }),
		{},
	);
	const garCell = (r: Record<string, unknown> | undefined) =>
		r
			? measureValue({
					sum: r.sum as number | string | null,
					reported: r.reported as number | string,
					zeroConfirmed: r.zero as number | string,
					total: r.total as number | string,
				})
			: EMPTY_CELL;
	const unclassed = num(gar.none?.total);
	const extensiveIntensive: ExtensiveIntensive = {
		threshold: { ...GAR_THRESHOLD, source: "GAR 2015" },
		note: `The GAR threshold is defined on records; it is applied here to records. ${unclassed} records report neither deaths nor houses destroyed and are not classified.`,
		measure: "deaths",
		intensive: garCell(gar.intensive),
		extensive: garCell(gar.extensive),
		intensiveRecords: num(gar.intensive?.total),
		extensiveRecords: num(gar.extensive?.total),
	};

	// Panel 16: disaggregation of the chosen effect, one dimension at a time.
	const src = DSG_SOURCE[measure];
	const srcTable = sql.raw(`"${src.table}"`);
	const srcCol = sql.raw(`t."${src.col}"`);
	const relocatedOut =
		src.table === "displaced"
			? sql`AND t."duration" IS DISTINCT FROM 'permanent'`
			: sql``;
	const branches = DSG_DIMS.map((d) => {
		const others = ALL_DSG_DIMS.filter((o) => o !== d).map((o) =>
			sql.raw(`hd."${o}" IS NULL`),
		);
		return sql`
			SELECT hd."record_id", ${d}::text AS dimension, ${sql.raw(`hd."${d}"`)}::text AS category, ${srcCol} AS val
			FROM filtered_records fr
			JOIN "human_dsg" hd ON hd."record_id" = fr.record_id
			JOIN ${srcTable} t ON t."dsg_id" = hd."id"
			WHERE ${sql.raw(`hd."${d}"`)} IS NOT NULL
				AND ${sql.join(others, sql` AND `)}
				AND ${srcCol} IS NOT NULL
				${relocatedOut}
				AND (hd."custom" IS NULL OR hd."custom" = '{}'::jsonb OR (
					SELECT COUNT(*) FROM jsonb_each(hd."custom") WHERE jsonb_typeof(value) != 'null'
				) = 0)`;
	});
	const dsg = await rows(sql`
		WITH RECURSIVE ${fr},
		dim_rows AS (${sql.join(branches, sql` UNION ALL `)}),
		dim_records AS (
			SELECT dimension, COUNT(DISTINCT "record_id") AS n FROM dim_rows GROUP BY 1
		)
		SELECT r.dimension, r.category,
			SUM(r.val) FILTER (WHERE r.val > 0) AS sum,
			COUNT(DISTINCT r."record_id") FILTER (WHERE r.val > 0) AS reported,
			COUNT(DISTINCT r."record_id") FILTER (WHERE r.val = 0) AS zero,
			MAX(dr2.n) AS dim_total,
			(SELECT COUNT(DISTINCT "record_id") FROM dim_rows) AS any_total,
			(SELECT COUNT(*) FROM filtered_records) AS records_total
		FROM dim_rows r
		JOIN dim_records dr2 ON dr2.dimension = r.dimension
		GROUP BY 1, 2
		ORDER BY 1, 2`);
	const disaggregation: DisaggregationPanel = {
		effect: measure,
		rows: dsg.map((r) => ({
			dimension: r.dimension as "sex" | "age" | "disability",
			category:
				r.dimension === "sex"
					? (SEX_LABELS[r.category as string] ?? (r.category as string))
					: (r.category as string),
			cell: measureValue({
				sum: r.sum as number | string | null,
				reported: r.reported as number | string,
				zeroConfirmed: r.zero as number | string,
				total: r.dim_total as number | string,
			}),
		})),
		coverage: {
			recordsWithBreakdown: num(dsg[0]?.any_total),
			recordsTotal: dsg.length ? num(dsg[0].records_total) : total,
		},
	};

	return {
		sendai,
		hazardEffect,
		rankedDivisions,
		hazardSector,
		peopleMoved,
		houses,
		largestRecords,
		completeness,
		season,
		periodChange,
		extensiveIntensive,
		disaggregation,
		meta: {
			sendai: meta(
				"Sum over records in scope; a record counts once. Houses are counted damage rows in the Housing sector, furniture and equipment left out",
				coverageText,
			),
			hazardEffect: meta(
				"Sum per HIPs type and effect; records without a HIPs type are their own row",
			),
			rankedDivisions: meta(
				`Sum per level-1 division; a record in several divisions counts in each; top ${RANKED_DIVISIONS_TOP} shown`,
				coverageText,
			),
			hazardSector: meta(
				"Records reporting damage per HIPs type and level-2 sector, from the sector flag or a counted damage row",
			),
			peopleMoved: meta(
				"Displaced, evacuated and relocated per contract O-2; never added",
			),
			houses: meta(
				"Sum of houses destroyed and damaged per HIPs type: counted damage rows in the Housing sector, furniture and equipment left out",
			),
			largestRecords: meta(
				`Records in scope with the chosen measure above 0, largest first, top ${LARGEST_RECORDS_TOP}, with their plausibility flag codes (C30)`,
			),
			completeness: meta(
				"Share of records in scope that report each field, a confirmed zero included",
			),
			season: meta(
				"Sum per start month; records without a month are left out and counted",
			),
			periodChange: meta(
				`Annual average per level-1 division over two periods of ${PERIOD_YEARS} years ending ${periodB.to}`,
			),
			extensiveIntensive: meta(
				`GAR 2015: a record with ${GAR_THRESHOLD.deaths} or more deaths or ${GAR_THRESHOLD.housesDestroyed} or more houses destroyed is intensive`,
			),
			disaggregation: meta(
				"Sum per category over rows split by that dimension alone; relocated people left out of displaced",
			),
		},
	};
}

/**
 * The D1 Disaster impact map (slot M0): per level-1 division, the number of
 * deaths for the shading and dwellings destroyed and damaged for the bars.
 * Every level-1 division is listed, so an area nobody reported reads as not
 * reported, never as absent or 0.
 */
export async function getImpactMap(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactMapPayload> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const fr = humanEffectsFilteredRecords(filters);
	const [byDivision, houseRows, multi, divNames] = await Promise.all([
		groupedMeasures(filters, sql`rl.l1_id::text AS k1, NULL::text AS k2`, {
			divisions: true,
		}),
		rows(sql`
			WITH RECURSIVE ${fr}, ${housesCte}, ${recordDivisionsCte(ctx.countryAccountsId)}
			SELECT rl.l1_id::text AS division_id,
				SUM(h.td) FILTER (WHERE h.td > 0) AS td_sum,
				COUNT(*) FILTER (WHERE h.td > 0) AS td_reported,
				SUM(h.pd) FILTER (WHERE h.pd > 0) AS pd_sum,
				COUNT(*) FILTER (WHERE h.pd > 0) AS pd_reported,
				COUNT(*) AS records_total
			FROM rec_l1 rl
			LEFT JOIN houses h ON h."record_id" = rl.record_id
			GROUP BY 1`),
		rows(sql`
			WITH RECURSIVE ${fr}, ${recordDivisionsCte(ctx.countryAccountsId)}
			SELECT COUNT(*) AS n FROM (
				SELECT record_id FROM rec_l1 GROUP BY 1 HAVING COUNT(*) > 1
			) m`),
		divisionNames(ctx.countryAccountsId),
	]);
	const { ids, points, shapeBy } = await levelOneAreas(
		ctx.countryAccountsId,
		divNames,
	);
	const measuresBy = new Map(byDivision.map((r) => [r.k1 as string | null, r]));
	const housesBy = new Map(houseRows.map((r) => [r.division_id as string, r]));
	const areas: ImpactMapArea[] = ids
		.map((id) => {
			const m = measuresBy.get(id);
			const h = housesBy.get(id);
			return {
				divisionId: id,
				name: divNames.get(id) as string,
				geojson: shapeBy.get(id) ?? null,
				labelPoint: points.get(id) ?? null,
				deaths: m ? m.measures.deaths : EMPTY_CELL,
				dwellingsDestroyed: h
					? countCell(h.td_sum, h.td_reported, h.records_total)
					: EMPTY_CELL,
				dwellingsDamaged: h
					? countCell(h.pd_sum, h.pd_reported, h.records_total)
					: EMPTY_CELL,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		areas,
		recordsWithoutDivision:
			measuresBy.get(null)?.measures.deaths.recordsTotal ?? 0,
		multiDivisionRecords: num(multi[0]?.n),
		legend: {
			shading: "Number of deaths",
			bars: ["Dwellings destroyed", "Dwellings damaged"],
			note: "Sub-national figures. Not a Sendai indicator value.",
		},
		meta: {
			method:
				"Per level-1 division: the number of deaths (sum over records, a record in several divisions counts in each) shades the area; dwellings destroyed and damaged are counted damage rows in the Housing sector, furniture and equipment left out, drawn as two bars that are never added",
			notApplied,
		},
	};
}

/**
 * Each level-1 division's display shape (simplified, MAP_SIMPLIFY_DEGREES)
 * and anchor point, shared by every D1 map so all three draw the same areas.
 */
export async function levelOneAreas(
	countryAccountsId: string,
	divNames?: Map<string, string>,
): Promise<{
	ids: string[];
	names: Map<string, string>;
	points: Map<string, [number, number]>;
	shapeBy: Map<string, unknown>;
}> {
	const names = divNames ?? (await divisionNames(countryAccountsId));
	const ctx = { countryAccountsId };
	const ids = [...names.keys()];
	const [points, shapes] = await Promise.all([
		divisionLabelPoints(ids, ctx.countryAccountsId),
		// Simplified to about 500 m (0.005 degrees): the largest tenant's
		// level-1 shapes drop from 23 MB stored to about 150 kB. The stored
		// geojson is the fallback for a division without geom.
		rows(sql`
			SELECT "id"::text AS id,
				COALESCE(
					ST_AsGeoJSON(ST_SimplifyPreserveTopology("geom", ${MAP_SIMPLIFY_DEGREES}), 4)::jsonb,
					"geojson"
				) AS geojson
			FROM "division"
			WHERE "level" = 1 AND "country_accounts_id" = ${ctx.countryAccountsId}`),
	]);
	const shapeBy = new Map(
		shapes.map((r) => [r.id as string, r.geojson ?? null]),
	);
	return { ids, names, points, shapeBy };
}
