import { and, eq, gte, lte, SQL, sql } from "drizzle-orm";
import { divisionAndDescendantsSql } from "~/backend.server/utils/geographicFilters";
import {
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	type MeasureValue,
} from "~/utils/valueState";
import {
	plausibilitySourceFields,
	type PlausibilityMeasure,
} from "~/utils/plausibility";
import { dr } from "~/db.server";
import {
	approvalBasis,
	basisColumns,
	type ApprovalAudience,
} from "~/utils/approvalBasis";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { disasterRecordsDivisionTable } from "~/drizzle/schema/disasterRecordsDivisionTable";

interface HazardFilters {
	countryAccountsId: string;
	hazardTypeId: string | null;
	hazardClusterId: string | null;
	specificHazardId: string | null;
	geographicLevelId: string | null;
	fromDate: string | null;
	toDate: string | null;
	/** Approval basis (C23): public or signed-in, from the request. */
	audience: ApprovalAudience;
}

/**
 * Retrieves the count of disaster event records based on the provided filters.
 * @param filters - Object containing filter values from HazardFilters including tenant context
 * @returns Promise<number> - The count of matching disaster events
 */
export async function getDisasterEventCount(
	filters: HazardFilters,
): Promise<number> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	const conditions: any[] = [
		eq(disasterEventTable.countryAccountsId, countryAccountsId),
		approvalBasis(filters.audience, disasterEventTable),
	];

	if (hazardTypeId) {
		conditions.push(eq(disasterEventTable.hipTypeId, hazardTypeId));
	}

	if (hazardClusterId) {
		conditions.push(eq(disasterEventTable.hipClusterId, hazardClusterId));
	}

	if (specificHazardId) {
		conditions.push(eq(disasterEventTable.hipHazardId, specificHazardId));
	}

	if (geographicLevelId) {
		conditions.push(
			sql`EXISTS (
				SELECT 1
				FROM disaster_event_division ded
				WHERE ded.disaster_event_id = ${disasterEventTable.id}
					AND ded.division_id IN ${divisionAndDescendantsSql(geographicLevelId, countryAccountsId)}
			)`,
		);
	}

	if (fromDate) {
		conditions.push(gte(disasterEventTable.startDate, fromDate));
	}

	if (toDate) {
		conditions.push(lte(disasterEventTable.endDate, toDate));
	}

	const result = await dr
		.select({
			disaster_count: sql<number>`count(*)`,
		})
		.from(disasterEventTable)
		.where(and(...conditions));

	return Number(result[0]?.disaster_count ?? 0);
}

export interface YearlyDisasterCount {
	year: number;
	count: number;
}

export async function getDisasterEventCountByYear(
	filters: HazardFilters,
): Promise<YearlyDisasterCount[]> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	const conditions: any[] = [
		eq(disasterEventTable.countryAccountsId, countryAccountsId),
		approvalBasis(filters.audience, disasterEventTable),
	];

	if (hazardTypeId) {
		conditions.push(eq(disasterEventTable.hipTypeId, hazardTypeId));
	}

	if (hazardClusterId) {
		conditions.push(eq(disasterEventTable.hipClusterId, hazardClusterId));
	}

	if (specificHazardId) {
		conditions.push(eq(disasterEventTable.hipHazardId, specificHazardId));
	}

	if (geographicLevelId) {
		conditions.push(
			sql`EXISTS (
				SELECT 1
				FROM disaster_event_division ded
				WHERE ded.disaster_event_id = ${disasterEventTable.id}
					AND ded.division_id IN ${divisionAndDescendantsSql(geographicLevelId, countryAccountsId)}
			)`,
		);
	}

	if (fromDate) {
		conditions.push(gte(disasterEventTable.startDate, fromDate));
	}

	if (toDate) {
		conditions.push(lte(disasterEventTable.endDate, toDate));
	}

	// An event without a readable end date has no year: NULL, never year 0 (C09).
	const yearExpr = sql<number | null>`
  EXTRACT(YEAR FROM TO_DATE(
      ${disasterEventTable.endDate},
      CASE
        WHEN ${disasterEventTable.endDate} ~ '^[0-9]{4}$' THEN 'YYYY'
        WHEN ${disasterEventTable.endDate} ~ '^[0-9]{4}-[0-9]{2}$' THEN 'YYYY-MM'
        WHEN ${disasterEventTable.endDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN 'YYYY-MM-DD'
        ELSE NULL
      END
    ))
`;

	const result = await dr
		.select({
			year: yearExpr,
			disaster_count: sql<number>`COUNT(*)`,
		})
		.from(disasterEventTable)
		.where(and(...conditions))
		.groupBy(yearExpr)
		.orderBy(yearExpr);

	return result
		.filter((r) => r.year !== null)
		.map((r) => ({
			year: Number(r.year),
			count: Number(r.disaster_count),
		}));
}

interface AffectedPeopleResult {
	/** null when no record in scope reported the measure (never a false 0). */
	totalDeaths: number | null;
	totalInjured: number | null;
	totalMissing: number | null;
	totalDisplaced: number | null;
	totalAffectedDirect: number | null;
	totalAffectedIndirect: number | null;
	/** Value, state and record counts per measure (TR-076, pack C10). */
	measures: Record<HumanEffectMeasure, MeasureValue>;
}

const HUMAN_EFFECT_MEASURES = [
	"deaths",
	"injured",
	"missing",
	"displaced",
	"affected_direct",
	"affected_indirect",
] as const;
type HumanEffectMeasure = (typeof HUMAN_EFFECT_MEASURES)[number];

/**
 * True when the record's plausibility flags (legacy_data.migration) name any
 * of the source fields that feed one of the measures (solution pack C30).
 */
function plausibilityFlagged(
	legacyData: SQL,
	measures: PlausibilityMeasure[],
): SQL {
	const fields = measures.flatMap((m) => plausibilitySourceFields(m));
	return sql`EXISTS (
		SELECT 1
		FROM jsonb_array_elements(
			CASE
				WHEN jsonb_typeof(${legacyData} -> 'migration' -> 'plausibility_flags') = 'array'
					THEN ${legacyData} -> 'migration' -> 'plausibility_flags'
				ELSE '[]'::jsonb
			END
		) AS pf
		WHERE pf -> 'fields' ?| ARRAY[${sql.join(
			fields.map((f) => sql`${f}`),
			sql`, `,
		)}]::text[]
	)`;
}

/**
 * Per-measure sum and record counts from human_category_presence, for the
 * records in `filtered_records`. A record counts as reported when its total is
 * above 0; as a confirmed zero when its total is 0 with a Yes flag, or when it
 * holds an explicit No with no value; otherwise as not reported. Totals are
 * read from the presence table, so the disaggregation cube is never summed.
 */
function humanEffectMeasuresSelect(): SQL {
	const parts = HUMAN_EFFECT_MEASURES.map((m) => {
		const flag = sql.raw(`hcp."${m}"`);
		const total = sql.raw(`hcp."${m}_total"`);
		return sql`
			SUM(${total}) FILTER (WHERE ${total} > 0) AS ${sql.raw(`"${m}_sum"`)},
			COUNT(*) FILTER (WHERE ${total} > 0) AS ${sql.raw(`"${m}_reported"`)},
			COUNT(*) FILTER (
				WHERE (${total} = 0 AND ${flag} IS TRUE)
					OR (${flag} IS FALSE AND COALESCE(${total}, 0) = 0)
			) AS ${sql.raw(`"${m}_zero"`)},
			COUNT(*) FILTER (
				WHERE ${plausibilityFlagged(sql.raw(`rec."legacy_data"`), [m])}
			) AS ${sql.raw(`"${m}_flagged"`)}`;
	});
	return sql.join([...parts, sql`COUNT(*) AS records_total`], sql`, `);
}

/**
 * Records in scope for the human-effects figures: tenant, approval basis,
 * HIPs, date range and, when set, the level-1 division. Returns the CTE body
 * (division_hierarchy when needed, then filtered_records) to follow
 * WITH RECURSIVE. Every record counts, including those with no
 * human-effects rows, so "not reported" is measured rather than dropped.
 */
function humanEffectsFilteredRecords(filters: HazardFilters): SQL {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// Build WHERE conditions for disaster_records
	const whereConditions: SQL[] = [];
	whereConditions.push(approvalBasis(filters.audience, basisColumns("dr")));
	whereConditions.push(sql`dr."country_accounts_id" = ${countryAccountsId}`);
	if (hazardTypeId)
		whereConditions.push(sql`dr."hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`dr."hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`dr."hip_hazard_id" = ${specificHazardId}`);

	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
        (
          CASE 
            WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM-DD')
            WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM')
            WHEN dr."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."start_date", 'YYYY')
            ELSE NULL
          END IS NULL OR 
          CASE 
            WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM-DD')
            WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM')
            WHEN dr."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."start_date", 'YYYY')
            ELSE NULL
          END <= ${to}::date
        ) AND (
          CASE 
            WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM-DD')
            WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM')
            WHEN dr."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."end_date", 'YYYY')
            ELSE NULL
          END IS NULL OR 
          CASE 
            WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM-DD')
            WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM')
            WHEN dr."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."end_date", 'YYYY')
            ELSE NULL
          END >= ${from}::date
        )
      `);
	}

	// Check if we need geographic filtering
	const needsGeographicFilter =
		geographicLevelId && geographicLevelId.trim() !== "";

	// Records in scope; every record counts, including those with no
	// human-effects rows, so "not reported" is measured rather than dropped.
	let filteredRecords: SQL;
	if (needsGeographicFilter) {
		const geoConditions = [
			...whereConditions,
			sql`drd."division_id" IS NOT NULL`,
			sql`dh.level1_id IN (
                SELECT level1_id 
                FROM division_hierarchy 
                WHERE id = ${geographicLevelId}
            )`,
		];
		filteredRecords = sql`
          division_hierarchy AS (
            SELECT id, parent_id, id AS level1_id
            FROM "division"
            WHERE parent_id IS NULL
            UNION ALL
            SELECT d.id, d.parent_id, dh.level1_id
            FROM "division" d
            INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
          ),
          filtered_records AS (
            SELECT DISTINCT dr."id" AS record_id
            FROM "disaster_records" dr
			LEFT JOIN "disaster_records_division" drd
			  ON dr."id" = drd."disaster_record_id"
            LEFT JOIN division_hierarchy dh 
			  ON drd."division_id" = dh.id
            WHERE ${and(...geoConditions)}
          )`;
	} else {
		filteredRecords = sql`
          filtered_records AS (
            SELECT dr."id" AS record_id
            FROM "disaster_records" dr
            WHERE ${and(...whereConditions)}
          )`;
	}

	return filteredRecords;
}

/**
 * Aggregates human impact data (deaths, injured, missing, displaced, affected)
 * from disaster records filtered by hazard type, geography, and date range.
 *
 * Builds two different SQL queries depending on whether geographic filtering is needed:
 * - **With geography**: uses a recursive CTE (`division_hierarchy`) to traverse the
 *   division tree, `LEFT JOIN LATERAL` to unnest JSON spatial footprint arrays, and
 *   JSON path queries to match division IDs in two different JSON structures.
 * - **Without geography**: simpler direct join on disaster_records.
 *
 * Both paths join `human_dsg` with `IS NULL` filters on all dimension columns
 * (sex, age, disability, poverty lines) to select only aggregate (non-disaggregated) rows,
 * then LEFT JOIN the five effect tables (deaths, injured, missing, displaced, affected).
 *
 * Date filtering handles three variable-precision text formats: YYYY, YYYY-MM, YYYY-MM-DD.
 */
export async function getAffectedPeopleByHazardFilters(
	filters: HazardFilters,
): Promise<AffectedPeopleResult> {
	const filteredRecords = humanEffectsFilteredRecords(filters);

	const rawQuery = sql`
          WITH RECURSIVE ${filteredRecords}
          SELECT ${humanEffectMeasuresSelect()}
          FROM filtered_records fr
          LEFT JOIN "human_category_presence" hcp
            ON hcp."record_id" = fr.record_id
          LEFT JOIN "disaster_records" rec
            ON rec."id" = fr.record_id
        `;

	const result = await dr.execute(rawQuery);
	const row: Record<string, unknown> = result.rows[0] || {};
	const measures = Object.fromEntries(
		HUMAN_EFFECT_MEASURES.map((m) => [
			m,
			measureValue(
				{
					sum: row[`${m}_sum`] as number | string | null,
					reported: row[`${m}_reported`] as number | string,
					zeroConfirmed: row[`${m}_zero`] as number | string,
					total: row.records_total as number | string,
					flagged: row[`${m}_flagged`] as number | string,
				},
				PROVISIONAL_ZERO_COVERAGE,
			),
		]),
	) as Record<HumanEffectMeasure, MeasureValue>;

	return {
		totalDeaths: measures.deaths.value,
		totalInjured: measures.injured.value,
		totalMissing: measures.missing.value,
		totalDisplaced: measures.displaced.value,
		totalAffectedDirect: measures.affected_direct.value,
		totalAffectedIndirect: measures.affected_indirect.value,
		measures,
	};
}

type DisaggregationDimension =
	| "sex"
	| "age"
	| "disability"
	| "global_poverty_line"
	| "national_poverty_line";

const DISAGGREGATION_DIMENSIONS: DisaggregationDimension[] = [
	"sex",
	"age",
	"disability",
	"global_poverty_line",
	"national_poverty_line",
];

export interface DisaggregationCoverage {
	/** Records in scope with at least one value broken down by the dimension. */
	recordsWithBreakdown: number;
	/** All records in scope. */
	recordsTotal: number;
}

/**
 * People affected (injured, missing, displaced, directly affected) broken down
 * by one dimension. Only rows split by that dimension alone are read: every
 * other dimension and the custom columns must be empty, so cross-tab rows
 * (for example sex by age) are never counted twice. A category is null when no
 * record in scope carries the breakdown (TR-076, pack C10).
 */
async function getDisaggregationPanel(
	filters: HazardFilters,
	dimension: DisaggregationDimension,
): Promise<{
	byCategory: Record<string, number>;
	coverage: DisaggregationCoverage;
}> {
	const others = DISAGGREGATION_DIMENSIONS.filter((d) => d !== dimension).map(
		(d) => sql.raw(`hd."${d}" IS NULL`),
	);
	const dim = sql.raw(`hd."${dimension}"`);
	const rawQuery = sql`
          WITH RECURSIVE ${humanEffectsFilteredRecords(filters)},
          dim_rows AS (
            SELECT
              hd."record_id",
              ${dim}::text AS category,
              (CASE WHEN inj."injured" > 0 THEN inj."injured" ELSE 0 END +
               CASE WHEN mis."missing" > 0 THEN mis."missing" ELSE 0 END +
               CASE WHEN dsp."displaced" > 0 THEN dsp."displaced" ELSE 0 END +
               CASE WHEN aff."direct" > 0 THEN aff."direct" ELSE 0 END) AS v,
              (inj."injured" IS NOT NULL OR mis."missing" IS NOT NULL
               OR dsp."displaced" IS NOT NULL OR aff."direct" IS NOT NULL) AS has_value
            FROM filtered_records fr
            INNER JOIN "human_dsg" hd ON hd."record_id" = fr.record_id
            LEFT JOIN "injured" inj ON inj."dsg_id" = hd."id"
            LEFT JOIN "missing" mis ON mis."dsg_id" = hd."id"
            LEFT JOIN "displaced" dsp ON dsp."dsg_id" = hd."id"
            LEFT JOIN "affected" aff ON aff."dsg_id" = hd."id"
            WHERE ${dim} IS NOT NULL
              AND ${and(...others)}
              AND (
                hd."custom" IS NULL
                OR hd."custom" = '{}'::jsonb
                OR (
                  SELECT COUNT(*)
                  FROM jsonb_each(hd."custom")
                  WHERE jsonb_typeof(value) != 'null'
                ) = 0
              )
          ),
          by_category AS (
            SELECT category, SUM(v) AS total
            FROM dim_rows
            WHERE has_value
            GROUP BY category
          )
          SELECT
            (SELECT COUNT(*) FROM filtered_records) AS records_total,
            (SELECT COUNT(DISTINCT "record_id") FROM dim_rows WHERE has_value) AS records_with_breakdown,
            (SELECT jsonb_object_agg(category, total) FROM by_category) AS by_category
        `;
	const result = await dr.execute(rawQuery);
	const row: Record<string, unknown> = result.rows[0] || {};
	const raw = (row.by_category ?? {}) as Record<string, unknown>;
	const byCategory: Record<string, number> = {};
	for (const [k, v] of Object.entries(raw)) {
		const n = Number(v);
		if (Number.isFinite(n)) byCategory[k] = n;
	}
	return {
		byCategory,
		coverage: {
			recordsWithBreakdown: Number(row.records_with_breakdown ?? 0),
			recordsTotal: Number(row.records_total ?? 0),
		},
	};
}

/**
 * A category's value within the records that carry the breakdown: 0 when those
 * records hold none in the category, null when no record carries the breakdown.
 */
function categoryValue(
	panel: {
		byCategory: Record<string, number>;
		coverage: DisaggregationCoverage;
	},
	...categories: string[]
): number | null {
	if (panel.coverage.recordsWithBreakdown === 0) {
		return null;
	}
	return categories.reduce((sum, c) => sum + (panel.byCategory[c] ?? 0), 0);
}

interface GenderTotals {
	totalMen: number | null;
	totalWomen: number | null;
	totalNonBinary: number | null;
	genderCoverage: DisaggregationCoverage;
}

/** People affected by sex (m, f, o); null when no record carries a sex breakdown. */
export async function getGenderTotalsByHazardFilters(
	filters: HazardFilters,
): Promise<GenderTotals> {
	const panel = await getDisaggregationPanel(filters, "sex");
	return {
		totalMen: categoryValue(panel, "m"),
		totalWomen: categoryValue(panel, "f"),
		totalNonBinary: categoryValue(panel, "o"),
		genderCoverage: panel.coverage,
	};
}

interface AgeTotals {
	totalChildren: number | null;
	totalAdults: number | null;
	totalSeniors: number | null;
	ageCoverage: DisaggregationCoverage;
}

/** People affected by age group; null when no record carries an age breakdown. */
export async function getAgeTotalsByHazardFilters(
	filters: HazardFilters,
): Promise<AgeTotals> {
	const panel = await getDisaggregationPanel(filters, "age");
	return {
		totalChildren: categoryValue(panel, "0-14"),
		totalAdults: categoryValue(panel, "15-64"),
		totalSeniors: categoryValue(panel, "65+"),
		ageCoverage: panel.coverage,
	};
}

/** People affected with a disability (any stored disability value). */
export async function getDisabilityTotalByHazardFilters(
	filters: HazardFilters,
): Promise<number | null> {
	const panel = await getDisaggregationPanel(filters, "disability");
	return categoryValue(panel, ...Object.keys(panel.byCategory));
}

/** People affected below the international poverty line. */
export async function getInternationalPovertyTotalByHazardFilters(
	filters: HazardFilters,
): Promise<number | null> {
	const panel = await getDisaggregationPanel(filters, "global_poverty_line");
	return categoryValue(panel, "below");
}

/** People affected below the national poverty line. */
export async function getNationalPovertyTotalByHazardFilters(
	filters: HazardFilters,
): Promise<number | null> {
	const panel = await getDisaggregationPanel(filters, "national_poverty_line");
	return categoryValue(panel, "below");
}

/**
 * Calculates total damage cost for filtered disaster records.
 *
 * Uses a two-tier fallback strategy per sector:
 * 1. **SDR override**: `sector_disaster_records_relation.damage_cost` — if set, use it directly
 * 2. **Detailed calculation**: sum `damages.total_repair_replacement` for that record+sector
 *
 * The SDR table acts as an "override" layer — when `damage_cost` is populated, it takes
 * precedence over the detailed damages breakdown. This allows users to enter a single
 * total cost instead of itemizing every damaged asset.
 *
 * Note: the fallback issues one query per record+sector pair (N+1 pattern), which can
 * be slow for large datasets. `getTotalDamagesByYear` uses a batched fallback instead.
 */
export async function getTotalDamagesByHazardFilters(
	filters: HazardFilters,
): Promise<number> {
	const disasterRecords = (await getFilteredDisasterRecords(filters)) as Array<{
		id: string;
	}>;
	if (!disasterRecords.length) return 0;

	const disasterIds: string[] = disasterRecords.map((d) => d.id);
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// Fetch all SDR rows for these disaster records
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, damage_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);

	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		damage_cost: string | number | null;
	}>;

	// Group SDR rows by disaster_record_id
	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; damage_cost: number | null }>
	>();
	for (const row of sdrRows) {
		const list = sdrByRecord.get(row.disaster_record_id) ?? [];
		list.push({
			sector_id: row.sector_id,
			damage_cost:
				row.damage_cost == null || row.damage_cost === ""
					? null
					: Number(row.damage_cost),
		});
		sdrByRecord.set(row.disaster_record_id, list);
	}

	let totalDamages = 0;

	for (const record of disasterRecords) {
		const sdrList = sdrByRecord.get(String(record.id)) ?? [];

		for (const sdr of sdrList) {
			if (sdr.damage_cost != null) {
				totalDamages += sdr.damage_cost;
			} else {
				// Fallback: sum damages.total_repair_replacement for this disaster_record_id and sector_id
				const damagesRes = await dr.execute(sql`
          SELECT total_repair_replacement
          FROM damages
          WHERE record_id = ${record.id} AND sector_id = ${sdr.sector_id}
        `);

				const damagesRows = damagesRes.rows as Array<{
					total_repair_replacement: string | number | null;
				}>;
				for (const d of damagesRows) {
					if (d.total_repair_replacement != null) {
						totalDamages += Number(d.total_repair_replacement);
					}
				}
			}
		}
	}

	return totalDamages;
}

export async function getFilteredDisasterRecords(filters: HazardFilters) {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// Build WHERE conditions
	const whereConditions: SQL[] = [
		approvalBasis(filters.audience, basisColumns()),
		sql`"country_accounts_id" = ${countryAccountsId}`,
	];

	if (hazardTypeId) whereConditions.push(sql`"hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`"hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`"hip_hazard_id" = ${specificHazardId}`);
	if (geographicLevelId) {
		whereConditions.push(sql`EXISTS (
			WITH RECURSIVE division_tree AS (
				SELECT id
				FROM division
				WHERE id = ${geographicLevelId}::uuid
				UNION ALL
				SELECT d.id
				FROM division d
				INNER JOIN division_tree dt ON d.parent_id = dt.id
			)
			SELECT 1
			FROM disaster_records_division drd
			WHERE drd.disaster_record_id = disaster_records.id
				AND drd.division_id IN (SELECT id FROM division_tree)
		)`);
	}

	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
			(
				CASE 
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM-DD')
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM')
					WHEN "start_date" ~ '^[0-9]{4}$' THEN TO_DATE("start_date", 'YYYY')
					ELSE NULL
				END IS NULL OR 
				CASE 
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM-DD')
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM')
					WHEN "start_date" ~ '^[0-9]{4}$' THEN TO_DATE("start_date", 'YYYY')
					ELSE NULL
				END <= ${to}::date
			) AND (
				CASE 
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM-DD')
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM')
					WHEN "end_date" ~ '^[0-9]{4}$' THEN TO_DATE("end_date", 'YYYY')
					ELSE NULL
				END IS NULL OR 
				CASE 
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM-DD')
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM')
					WHEN "end_date" ~ '^[0-9]{4}$' THEN TO_DATE("end_date", 'YYYY')
					ELSE NULL
				END >= ${from}::date
			)
		`);
	}

	const whereClause = whereConditions.length
		? sql`WHERE ${and(...whereConditions)}`
		: sql``;

	// Fetch matching disaster_records
	const query = sql`
	SELECT id, hip_type_id, hip_cluster_id, hip_hazard_id, start_date, end_date
    FROM disaster_records
    ${whereClause}
  `;

	const result = await dr.execute(query);

	// Return array of disaster_records
	return result.rows;
}

/**
 * Calculates total losses for filtered disaster records.
 *
 * Same two-tier fallback as `getTotalDamagesByHazardFilters`:
 * 1. **SDR override**: `sector_disaster_records_relation.losses_cost`
 * 2. **Detailed calculation**: sum `losses.public_cost_total + losses.private_cost_total`
 *
 * The loss formula combines public and private costs, representing the business rule
 * that total losses = public infrastructure losses + private property losses.
 *
 * Same N+1 query caveat as the damages variant applies here.
 */
export async function getTotalLossesByHazardFilters(
	filters: HazardFilters,
): Promise<number> {
	const disasterRecords = (await getFilteredDisasterRecords(filters)) as Array<{
		id: string;
	}>;
	if (!disasterRecords.length) return 0;

	const disasterIds: string[] = disasterRecords.map((d) => d.id);
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// Fetch all SDR rows for these disaster records
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, losses_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);

	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		losses_cost: string | number | null;
	}>;

	// Group SDR rows by disaster_record_id
	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; losses_cost: number | null }>
	>();
	for (const row of sdrRows) {
		const list = sdrByRecord.get(row.disaster_record_id) ?? [];
		list.push({
			sector_id: row.sector_id,
			losses_cost:
				row.losses_cost == null || row.losses_cost === ""
					? null
					: Number(row.losses_cost),
		});
		sdrByRecord.set(row.disaster_record_id, list);
	}

	let totalLosses = 0;

	for (const record of disasterRecords) {
		const sdrList = sdrByRecord.get(String(record.id)) ?? [];

		for (const sdr of sdrList) {
			if (sdr.losses_cost != null) {
				totalLosses += sdr.losses_cost;
			} else {
				// Fallback: sum losses.public_cost_total + losses.private_cost_total for this disaster_record_id and sector_id
				const lossesRes = await dr.execute(sql`
          SELECT COALESCE(public_cost_total, 0) AS public_cost_total,
                 COALESCE(private_cost_total, 0) AS private_cost_total
          FROM losses
          WHERE record_id = ${record.id} AND sector_id = ${sdr.sector_id}
        `);

				const lossesRows = lossesRes.rows as Array<{
					public_cost_total: string | number;
					private_cost_total: string | number;
				}>;
				for (const l of lossesRows) {
					totalLosses +=
						Number(l.public_cost_total) + Number(l.private_cost_total);
				}
			}
		}
	}

	return totalLosses;
}

export interface DamageByYear {
	year: number;
	totalDamages: number;
}

export interface DamageByYear {
	year: number;
	totalDamages: number;
}

export async function getTotalDamagesByYear(
	filters: HazardFilters,
): Promise<DamageByYear[]> {
	const raw = await getFilteredDisasterRecords(filters);
	const disasterRecords = (raw as unknown as Array<Record<string, any>>).filter(
		(r) => r && (typeof r.id === "string" || typeof r.id === "number"),
	);

	if (!disasterRecords.length) return [];

	const disasterIds: string[] = disasterRecords.map((d) => String(d.id));
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// Fetch all SDR rows for these disasters
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, damage_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);
	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		damage_cost: string | number | null;
	}>;

	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; damage_cost: number | null }>
	>();
	const fallbackPairs = new Set<string>();

	for (const row of sdrRows) {
		const rid = String(row.disaster_record_id);
		const sector = String(row.sector_id);
		const cost =
			row.damage_cost == null || row.damage_cost === ""
				? null
				: Number(row.damage_cost);
		const list = sdrByRecord.get(rid) ?? [];
		list.push({ sector_id: sector, damage_cost: cost });
		sdrByRecord.set(rid, list);
		if (cost == null) fallbackPairs.add(`${rid}|${sector}`);
	}

	// ✅ FIX: Cast record_id and sector_id to UUID explicitly
	const fallbackMap = new Map<string, number>();
	if (fallbackPairs.size > 0) {
		const valuesList = Array.from(fallbackPairs)
			.map((pair) => {
				const [rid, sector] = pair.split("|");
				return `('${rid}'::uuid, '${sector}'::uuid)`;
			})
			.join(",");

		const damagesRes = await dr.execute(sql`
      SELECT record_id, sector_id,
             COALESCE(SUM(COALESCE(total_repair_replacement, 0)), 0)
             AS total_repair_replacement_sum
      FROM damages
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(valuesList)})
      GROUP BY record_id, sector_id
    `);

		for (const r of damagesRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total_repair_replacement_sum: string | number;
		}>) {
			fallbackMap.set(
				`${String(r.record_id)}|${String(r.sector_id)}`,
				Number(r.total_repair_replacement_sum) || 0,
			);
		}
	}

	const totalsByYear = new Map<number, number>();

	for (const rec of disasterRecords) {
		const id = String(rec.id);
		const rawStart = rec.start_date ?? rec.startDate ?? "";
		const m = String(rawStart).match(/^(\d{4})/);
		if (!m) continue;
		const year = Number(m[1]);
		if (!Number.isFinite(year)) continue;

		const sdrList = sdrByRecord.get(id) ?? [];

		let recordSum = 0;
		for (const sdr of sdrList) {
			if (sdr.damage_cost != null) {
				recordSum += sdr.damage_cost;
			} else {
				recordSum += fallbackMap.get(`${id}|${sdr.sector_id}`) ?? 0;
			}
		}

		totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + recordSum);
	}

	return Array.from(totalsByYear.entries())
		.map(([year, totalDamages]) => ({ year, totalDamages }))
		.sort((a, b) => a.year - b.year);
}

export interface LossByYear {
	year: number;
	totalLosses: number;
}

export async function getTotalLossesByYear(
	filters: HazardFilters,
): Promise<LossByYear[]> {
	const raw = await getFilteredDisasterRecords(filters);
	const disasterRecords = (raw as unknown as Array<Record<string, any>>).filter(
		(r) => r && (typeof r.id === "string" || typeof r.id === "number"),
	);

	if (!disasterRecords.length) return [];

	const disasterIds: string[] = disasterRecords.map((d) => String(d.id));
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// Fetch all SDR rows for these disasters
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, losses_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);

	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		losses_cost: string | number | null;
	}>;

	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; losses_cost: number | null }>
	>();
	const fallbackPairs = new Set<string>();

	for (const row of sdrRows) {
		const rid = String(row.disaster_record_id);
		const sector = String(row.sector_id);
		const cost =
			row.losses_cost == null || row.losses_cost === ""
				? null
				: Number(row.losses_cost);
		const list = sdrByRecord.get(rid) ?? [];
		list.push({ sector_id: sector, losses_cost: cost });
		sdrByRecord.set(rid, list);
		if (cost == null) fallbackPairs.add(`${rid}|${sector}`);
	}

	// ✅ Get fallback from losses table
	const fallbackMap = new Map<string, number>();
	if (fallbackPairs.size > 0) {
		const valuesList = Array.from(fallbackPairs)
			.map((pair) => {
				const [rid, sector] = pair.split("|");
				return `('${rid}'::uuid, '${sector}'::uuid)`;
			})
			.join(",");

		const lossesRes = await dr.execute(sql`
      SELECT record_id, sector_id,
             COALESCE(SUM(COALESCE(public_cost_total, 0) + COALESCE(private_cost_total, 0)), 0)
             AS total_loss_sum
      FROM losses
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(valuesList)})
      GROUP BY record_id, sector_id
    `);

		for (const r of lossesRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total_loss_sum: string | number;
		}>) {
			fallbackMap.set(
				`${String(r.record_id)}|${String(r.sector_id)}`,
				Number(r.total_loss_sum) || 0,
			);
		}
	}

	const totalsByYear = new Map<number, number>();

	for (const rec of disasterRecords) {
		const id = String(rec.id);
		const rawStart = rec.start_date ?? rec.startDate ?? "";
		const m = String(rawStart).match(/^(\d{4})/);
		if (!m) continue;
		const year = Number(m[1]);
		if (!Number.isFinite(year)) continue;

		const sdrList = sdrByRecord.get(id) ?? [];

		let recordSum = 0;
		for (const sdr of sdrList) {
			if (sdr.losses_cost != null) {
				recordSum += sdr.losses_cost;
			} else {
				recordSum += fallbackMap.get(`${id}|${sdr.sector_id}`) ?? 0;
			}
		}

		totalsByYear.set(year, (totalsByYear.get(year) ?? 0) + recordSum);
	}

	return Array.from(totalsByYear.entries())
		.map(([year, totalLosses]) => ({ year, totalLosses }))
		.sort((a, b) => a.year - b.year);
}

interface DamageByDivision {
	divisionId: string;
	totalDamages: number;
}

export async function getTotalDamagesByDivision(
	filters: HazardFilters,
): Promise<DamageByDivision[]> {
	// 1. Get all disaster records matching filters
	const raw = await getFilteredDisasterRecords(filters);
	const disasterRecords = (raw as unknown as Array<Record<string, any>>).filter(
		(r) => r && typeof r.id === "string",
	);

	if (!disasterRecords.length) return [];

	// 2. Extract all disaster IDs
	const disasterIds: string[] = disasterRecords.map((d) => d.id);
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// 3. Get all sector_disaster_records_relation rows for these disasters
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, damage_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);
	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		damage_cost: string | number | null;
	}>;

	// Group SDRs by disaster_record_id
	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; damage_cost: number | null }>
	>();
	const fallbackPairs = new Set<string>();

	for (const row of sdrRows) {
		const rid = String(row.disaster_record_id);
		const sector = String(row.sector_id);
		const cost =
			row.damage_cost == null || row.damage_cost === ""
				? null
				: Number(row.damage_cost);
		const list = sdrByRecord.get(rid) ?? [];
		list.push({ sector_id: sector, damage_cost: cost });
		sdrByRecord.set(rid, list);
		if (cost == null) fallbackPairs.add(`${rid}|${sector}`);
	}

	// 4. Fetch fallback damage totals from "damages" table
	const fallbackMap = new Map<string, number>();
	if (fallbackPairs.size > 0) {
		const valuesList = Array.from(fallbackPairs)
			.map((pair) => {
				const [rid, sector] = pair.split("|");
				return `('${rid}'::uuid, '${sector}'::uuid)`;
			})
			.join(",");

		const damagesRes = await dr.execute(sql`
      SELECT record_id, sector_id,
             COALESCE(SUM(COALESCE(total_repair_replacement, 0)), 0)
             AS total_repair_replacement_sum
      FROM damages
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(valuesList)})
      GROUP BY record_id, sector_id
    `);

		for (const r of damagesRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total_repair_replacement_sum: string | number;
		}>) {
			fallbackMap.set(
				`${String(r.record_id)}|${String(r.sector_id)}`,
				Number(r.total_repair_replacement_sum) || 0,
			);
		}
	}

	// 5. Accumulate totals by division
	const divisionTotals = new Map<string, number>();

	const recordDivisionRows = await dr
		.select({
			recordId: disasterRecordsDivisionTable.disasterRecordId,
			divisionId: disasterRecordsDivisionTable.divisionId,
		})
		.from(disasterRecordsDivisionTable)
		.where(
			sql`${disasterRecordsDivisionTable.disasterRecordId} = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])`,
		);

	const divisionsByRecord = new Map<string, string[]>();
	for (const row of recordDivisionRows) {
		const rid = String(row.recordId);
		const list = divisionsByRecord.get(rid) ?? [];
		list.push(String(row.divisionId));
		divisionsByRecord.set(rid, list);
	}

	const uniqueDivisionIds = Array.from(
		new Set(recordDivisionRows.map((row) => String(row.divisionId))),
	);
	const divisionToLevel1 = new Map<string, string>();

	if (uniqueDivisionIds.length > 0) {
		const divisionIdsList = uniqueDivisionIds.map((id) => `'${id}'`).join(",");
		const level1MapRes = await dr.execute(sql`
			WITH RECURSIVE division_hierarchy AS (
				SELECT id, parent_id, id AS level1_id
				FROM division
				WHERE parent_id IS NULL
				UNION ALL
				SELECT d.id, d.parent_id, dh.level1_id
				FROM division d
				INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
			)
			SELECT id::text AS division_id, level1_id::text AS level1_id
			FROM division_hierarchy
			WHERE id = ANY(ARRAY[${sql.raw(divisionIdsList)}]::uuid[])
		`);

		for (const row of level1MapRes.rows as Array<{
			division_id: string;
			level1_id: string;
		}>) {
			divisionToLevel1.set(String(row.division_id), String(row.level1_id));
		}
	}

	for (const record of disasterRecords) {
		const divisions = divisionsByRecord.get(record.id) ?? [];

		if (!divisions.length) continue;

		const sdrList = sdrByRecord.get(record.id) ?? [];

		// Sum total damage for this record
		let recordDamage = 0;
		for (const sdr of sdrList) {
			if (sdr.damage_cost != null) {
				recordDamage += sdr.damage_cost;
			} else {
				recordDamage += fallbackMap.get(`${record.id}|${sdr.sector_id}`) ?? 0;
			}
		}

		const level1Divisions = Array.from(
			new Set(
				divisions
					.map((divId) => divisionToLevel1.get(divId))
					.filter((level1Id): level1Id is string => Boolean(level1Id)),
			),
		);

		if (!level1Divisions.length) continue;

		// Distribute damage across distinct level-1 divisions only.
		const perLevel1Damage = recordDamage / level1Divisions.length;

		for (const divId of level1Divisions) {
			divisionTotals.set(
				divId,
				(divisionTotals.get(divId) ?? 0) + perLevel1Damage,
			);
		}
	}

	// 6. Return final result as array
	return Array.from(divisionTotals.entries())
		.map(([divisionId, totalDamages]) => ({
			divisionId,
			totalDamages,
		}))
		.sort((a, b) => a.divisionId.localeCompare(b.divisionId));
}

interface LossByDivision {
	divisionId: string;
	totalLosses: number;
}

export async function getTotalLossesByDivision(
	filters: HazardFilters,
): Promise<LossByDivision[]> {
	// 1. Get all disaster records matching filters
	const raw = await getFilteredDisasterRecords(filters);
	const disasterRecords = (raw as unknown as Array<Record<string, any>>).filter(
		(r) => r && typeof r.id === "string",
	);

	if (!disasterRecords.length) return [];

	// 2. Extract all disaster IDs
	const disasterIds: string[] = disasterRecords.map((d) => d.id);
	const disasterIdsList = disasterIds.map((id) => `'${id}'`).join(",");

	// 3. Get all sector_disaster_records_relation rows for these disasters
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, losses_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])
  `);
	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		losses_cost: string | number | null;
	}>;

	// Group SDRs by disaster_record_id
	const sdrByRecord = new Map<
		string,
		Array<{ sector_id: string; losses_cost: number | null }>
	>();
	const fallbackPairs = new Set<string>();

	for (const row of sdrRows) {
		const rid = String(row.disaster_record_id);
		const sector = String(row.sector_id);
		const cost =
			row.losses_cost == null || row.losses_cost === ""
				? null
				: Number(row.losses_cost);
		const list = sdrByRecord.get(rid) ?? [];
		list.push({ sector_id: sector, losses_cost: cost });
		sdrByRecord.set(rid, list);
		if (cost == null) fallbackPairs.add(`${rid}|${sector}`);
	}

	// 4. Fetch fallback loss totals from "losses" table
	const fallbackMap = new Map<string, number>();
	if (fallbackPairs.size > 0) {
		const valuesList = Array.from(fallbackPairs)
			.map((pair) => {
				const [rid, sector] = pair.split("|");
				return `('${rid}'::uuid, '${sector}'::uuid)`;
			})
			.join(",");

		const lossesRes = await dr.execute(sql`
      SELECT record_id, sector_id,
             COALESCE(SUM(COALESCE(public_cost_total, 0) + COALESCE(private_cost_total, 0)), 0)
             AS total_loss_sum
      FROM losses
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(valuesList)})
      GROUP BY record_id, sector_id
    `);

		for (const r of lossesRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total_loss_sum: string | number;
		}>) {
			fallbackMap.set(
				`${String(r.record_id)}|${String(r.sector_id)}`,
				Number(r.total_loss_sum) || 0,
			);
		}
	}

	// 5. Accumulate totals by division
	const divisionTotals = new Map<string, number>();

	const recordDivisionRows = await dr
		.select({
			recordId: disasterRecordsDivisionTable.disasterRecordId,
			divisionId: disasterRecordsDivisionTable.divisionId,
		})
		.from(disasterRecordsDivisionTable)
		.where(
			sql`${disasterRecordsDivisionTable.disasterRecordId} = ANY(ARRAY[${sql.raw(disasterIdsList)}]::uuid[])`,
		);

	const divisionsByRecord = new Map<string, string[]>();
	for (const row of recordDivisionRows) {
		const rid = String(row.recordId);
		const list = divisionsByRecord.get(rid) ?? [];
		list.push(String(row.divisionId));
		divisionsByRecord.set(rid, list);
	}

	const uniqueDivisionIds = Array.from(
		new Set(recordDivisionRows.map((row) => String(row.divisionId))),
	);
	const divisionToLevel1 = new Map<string, string>();

	if (uniqueDivisionIds.length > 0) {
		const divisionIdsList = uniqueDivisionIds.map((id) => `'${id}'`).join(",");
		const level1MapRes = await dr.execute(sql`
			WITH RECURSIVE division_hierarchy AS (
				SELECT id, parent_id, id AS level1_id
				FROM division
				WHERE parent_id IS NULL
				UNION ALL
				SELECT d.id, d.parent_id, dh.level1_id
				FROM division d
				INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
			)
			SELECT id::text AS division_id, level1_id::text AS level1_id
			FROM division_hierarchy
			WHERE id = ANY(ARRAY[${sql.raw(divisionIdsList)}]::uuid[])
		`);

		for (const row of level1MapRes.rows as Array<{
			division_id: string;
			level1_id: string;
		}>) {
			divisionToLevel1.set(String(row.division_id), String(row.level1_id));
		}
	}

	for (const record of disasterRecords) {
		const divisions = divisionsByRecord.get(record.id) ?? [];

		if (!divisions.length) continue;

		const sdrList = sdrByRecord.get(record.id) ?? [];

		// Sum total losses for this record
		let recordLosses = 0;
		for (const sdr of sdrList) {
			if (sdr.losses_cost != null) {
				recordLosses += sdr.losses_cost;
			} else {
				recordLosses += fallbackMap.get(`${record.id}|${sdr.sector_id}`) ?? 0;
			}
		}

		const level1Divisions = Array.from(
			new Set(
				divisions
					.map((divId) => divisionToLevel1.get(divId))
					.filter((level1Id): level1Id is string => Boolean(level1Id)),
			),
		);

		if (!level1Divisions.length) continue;

		// Distribute losses across distinct level-1 divisions only.
		const perLevel1Loss = recordLosses / level1Divisions.length;

		for (const divId of level1Divisions) {
			divisionTotals.set(
				divId,
				(divisionTotals.get(divId) ?? 0) + perLevel1Loss,
			);
		}
	}

	// 6. Return final result as array
	return Array.from(divisionTotals.entries())
		.map(([divisionId, totalLosses]) => ({
			divisionId,
			totalLosses,
		}))
		.sort((a, b) => a.divisionId.localeCompare(b.divisionId));
}

interface DeathsByDivision {
	divisionId: string;
	/** null unless a record in the division reported deaths. */
	totalDeaths: number | null;
	measure: MeasureValue;
	/** Records also counted in another division: figures are not additive. */
	sharedRecords: number;
}

export async function getTotalDeathsByDivision(
	filters: HazardFilters,
): Promise<DeathsByDivision[]> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// Build WHERE conditions for disaster_records as SQL objects
	const whereConditions: SQL[] = [];
	whereConditions.push(approvalBasis(filters.audience, basisColumns("dr")));
	whereConditions.push(sql`dr."country_accounts_id" = ${countryAccountsId}`);
	if (hazardTypeId)
		whereConditions.push(sql`dr."hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`dr."hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`dr."hip_hazard_id" = ${specificHazardId}`);
	if (geographicLevelId) {
		whereConditions.push(sql`EXISTS (
			WITH RECURSIVE division_tree AS (
				SELECT id
				FROM division
				WHERE id = ${geographicLevelId}::uuid
				UNION ALL
				SELECT d.id
				FROM division d
				INNER JOIN division_tree dt ON d.parent_id = dt.id
			)
			SELECT 1
			FROM disaster_records_division drd
			WHERE drd.disaster_record_id = dr.id
				AND drd.division_id IN (SELECT id FROM division_tree)
		)`);
	}
	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
		(
		  CASE 
			WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM-DD')
			WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM')
			WHEN dr."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."start_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM-DD')
			WHEN dr."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."start_date", 'YYYY-MM')
			WHEN dr."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."start_date", 'YYYY')
			ELSE NULL
		  END <= ${to}::date
		) AND (
		  CASE 
			WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM-DD')
			WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM')
			WHEN dr."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."end_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM-DD')
			WHEN dr."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(dr."end_date", 'YYYY-MM')
			WHEN dr."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(dr."end_date", 'YYYY')
			ELSE NULL
		  END >= ${from}::date
		)
	  `);
	}

	const recordsWhereClause =
		whereConditions.length > 0 ? sql`WHERE ${and(...whereConditions)}` : sql``;

	const rawQuery = sql`
	  WITH RECURSIVE division_hierarchy AS (
		SELECT id, parent_id, id AS level1_id
		FROM "division"
		WHERE parent_id IS NULL
		UNION ALL
		SELECT d.id, d.parent_id, dh.level1_id
		FROM "division" d
		INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
	  ),
	  filtered_records AS (
		SELECT dr."id" AS record_id
		FROM "disaster_records" dr
		${recordsWhereClause}
	  ),
	  record_value AS (
		-- Full record value; reported when the total is above 0, confirmed
		-- zero on a 0 total with Yes or an explicit No (TR-076, pack C10).
		SELECT
		  fr.record_id,
		  CASE WHEN hcp."deaths_total" > 0 THEN hcp."deaths_total" END AS v,
		  COALESCE(hcp."deaths_total" > 0, false) AS is_reported,
		  COALESCE(
			(hcp."deaths_total" = 0 AND hcp."deaths" IS TRUE)
			OR (hcp."deaths" IS FALSE AND COALESCE(hcp."deaths_total", 0) = 0),
			false
		  ) AS is_zero
		  ,${plausibilityFlagged(sql.raw(`rec."legacy_data"`), ["deaths"])} AS is_flagged
		FROM filtered_records fr
		LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id
	  ),
	  record_level1 AS (
		SELECT DISTINCT
		  drd."disaster_record_id" AS record_id,
		  dh.level1_id::text AS level1_id
		FROM "disaster_records_division" drd
		INNER JOIN filtered_records fr
		  ON fr.record_id = drd."disaster_record_id"
		INNER JOIN division_hierarchy dh
		  ON dh.id = drd."division_id"
		UNION
		SELECT DISTINCT
		  fr.record_id,
		  dh.level1_id::text AS level1_id
		FROM filtered_records fr
		INNER JOIN "disaster_records" dr
		  ON dr."id" = fr.record_id
		INNER JOIN "disaster_event_division" ded
		  ON ded."disaster_event_id" = dr."disaster_event_id"
		INNER JOIN division_hierarchy dh
		  ON dh.id = ded."division_id"
		WHERE NOT EXISTS (
			SELECT 1
			FROM "disaster_records_division" drd
			WHERE drd."disaster_record_id" = fr.record_id
		)
	  ),
	  record_level1_counts AS (
		SELECT record_id, COUNT(*) AS level1_count
		FROM record_level1
		GROUP BY record_id
	  )
	  SELECT
		rl.level1_id AS division_id,
		SUM(rv.v) AS value_sum,
		COUNT(*) FILTER (WHERE rv.is_reported) AS reported,
		COUNT(*) FILTER (WHERE rv.is_zero AND NOT rv.is_reported) AS zero_confirmed,
		COUNT(*) AS records_total,
		COUNT(*) FILTER (WHERE rv.is_flagged) AS flagged_records,
		COUNT(*) FILTER (WHERE rlc.level1_count > 1) AS shared_records
	  FROM record_level1 rl
	  INNER JOIN record_level1_counts rlc
		on rlc.record_id = rl.record_id
	  INNER JOIN record_value rv
		on rv.record_id = rl.record_id
	  GROUP BY rl.level1_id
	`;

	// Execute the query
	const result = await dr.execute(rawQuery);

	return result.rows.map((row: any) => {
		const measure = measureValue(
			{
				sum: row.value_sum,
				reported: row.reported,
				zeroConfirmed: row.zero_confirmed,
				total: row.records_total,
				flagged: row.flagged_records,
			},
			PROVISIONAL_ZERO_COVERAGE,
		);
		return {
			divisionId: row.division_id,
			totalDeaths: measure.value,
			measure,
			sharedRecords: Number(row.shared_records),
		};
	});
}

interface AffectedPeopleByDivision {
	divisionId: string;
	/** null unless a record in the division reported a component. */
	totalAffected: number | null;
	measure: MeasureValue;
	/** Records also counted in another division: figures are not additive. */
	sharedRecords: number;
}

export async function getTotalAffectedPeopleByDivision(
	filters: HazardFilters,
): Promise<AffectedPeopleByDivision[]> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// Build WHERE conditions for disaster_event as SQL objects
	const whereConditions: SQL[] = [];
	whereConditions.push(approvalBasis(filters.audience, basisColumns("de")));
	whereConditions.push(sql`de."country_accounts_id" = ${countryAccountsId}`);
	if (hazardTypeId)
		whereConditions.push(sql`de."hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`de."hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`de."hip_hazard_id" = ${specificHazardId}`);
	if (geographicLevelId) {
		whereConditions.push(sql`(
			EXISTS (
			WITH RECURSIVE division_tree AS (
				SELECT id
				FROM division
				WHERE id = ${geographicLevelId}::uuid
				UNION ALL
				SELECT d.id
				FROM division d
				INNER JOIN division_tree dt ON d.parent_id = dt.id
			)
			SELECT 1
			FROM disaster_event_division ded
			WHERE ded.disaster_event_id = de.id
				AND ded.division_id IN (SELECT id FROM division_tree)
			)
			OR EXISTS (
				WITH RECURSIVE division_tree AS (
					SELECT id
					FROM division
					WHERE id = ${geographicLevelId}::uuid
					UNION ALL
					SELECT d.id
					FROM division d
					INNER JOIN division_tree dt ON d.parent_id = dt.id
				)
				SELECT 1
				FROM disaster_records dr
				INNER JOIN disaster_records_division drd
					ON drd.disaster_record_id = dr.id
				WHERE dr.disaster_event_id = de.id
					AND ${approvalBasis(filters.audience, basisColumns("dr"))}
					AND drd.division_id IN (SELECT id FROM division_tree)
			)
		)`);
	}
	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
		(
		  CASE 
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM-DD')
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM')
			WHEN de."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."start_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM-DD')
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM')
			WHEN de."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."start_date", 'YYYY')
			ELSE NULL
		  END <= ${to}::date
		) AND (
		  CASE 
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM-DD')
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM')
			WHEN de."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."end_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM-DD')
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM')
			WHEN de."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."end_date", 'YYYY')
			ELSE NULL
		  END >= ${from}::date
		)
	  `);
	}

	const eventWhereClause =
		whereConditions.length > 0 ? sql`WHERE ${and(...whereConditions)}` : sql``;

	const rawQuery = sql`
	  WITH RECURSIVE division_hierarchy AS (
		SELECT id, parent_id, id AS level1_id
		FROM "division"
		WHERE parent_id IS NULL
		UNION ALL
		SELECT d.id, d.parent_id, dh.level1_id
		FROM "division" d
		INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
	  ),
	  filtered_events AS (
		SELECT de."id"
		FROM "disaster_event" de
		${eventWhereClause}
	  ),
	  filtered_records AS (
		SELECT dr."id" AS record_id, dr."disaster_event_id" AS event_id
		FROM "disaster_records" dr
		WHERE ${approvalBasis(filters.audience, basisColumns("dr"))}
		  AND dr."disaster_event_id" IN (SELECT fe."id" FROM filtered_events fe)
	  ),
	  record_value AS (
		-- Composite of injured, missing, displaced and directly affected, from
		-- reported components only; the full value counts in every division
		-- the record touches (no even split).
		SELECT
		  fr.record_id,
		  NULLIF(
			CASE WHEN hcp."injured_total" > 0 THEN hcp."injured_total" ELSE 0 END +
			CASE WHEN hcp."missing_total" > 0 THEN hcp."missing_total" ELSE 0 END +
			CASE WHEN hcp."displaced_total" > 0 THEN hcp."displaced_total" ELSE 0 END +
			CASE WHEN hcp."affected_direct_total" > 0 THEN hcp."affected_direct_total" ELSE 0 END,
			0
		  ) AS v,
		  COALESCE(hcp."injured_total" > 0 OR hcp."missing_total" > 0 OR hcp."displaced_total" > 0 OR hcp."affected_direct_total" > 0, false) AS is_reported,
		  COALESCE(
			(hcp."injured_total" = 0 AND hcp."injured" IS TRUE) OR (hcp."injured" IS FALSE AND COALESCE(hcp."injured_total", 0) = 0) OR
			(hcp."missing_total" = 0 AND hcp."missing" IS TRUE) OR (hcp."missing" IS FALSE AND COALESCE(hcp."missing_total", 0) = 0) OR
			(hcp."displaced_total" = 0 AND hcp."displaced" IS TRUE) OR (hcp."displaced" IS FALSE AND COALESCE(hcp."displaced_total", 0) = 0) OR
			(hcp."affected_direct_total" = 0 AND hcp."affected_direct" IS TRUE) OR (hcp."affected_direct" IS FALSE AND COALESCE(hcp."affected_direct_total", 0) = 0),
			false
		  ) AS is_zero
		  ,${plausibilityFlagged(sql.raw(`rec."legacy_data"`), ["injured", "missing", "displaced", "affected_direct"])} AS is_flagged
		FROM filtered_records fr
		LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id
	  ),
	  record_level1 AS (
		SELECT DISTINCT
		  drd."disaster_record_id" AS record_id,
		  dh.level1_id::text AS level1_id
		FROM "disaster_records_division" drd
		INNER JOIN filtered_records fr
		  ON fr.record_id = drd."disaster_record_id"
		INNER JOIN division_hierarchy dh
		  ON dh.id = drd."division_id"
		UNION
		SELECT DISTINCT
		  fr.record_id,
		  dh.level1_id::text AS level1_id
		FROM filtered_records fr
		INNER JOIN "disaster_event_division" ded
		  ON ded."disaster_event_id" = fr.event_id
		INNER JOIN division_hierarchy dh
		  ON dh.id = ded."division_id"
		WHERE NOT EXISTS (
			SELECT 1
			FROM "disaster_records_division" drd
			WHERE drd."disaster_record_id" = fr.record_id
		)
	  ),
	  record_level1_counts AS (
		SELECT record_id, COUNT(*) AS level1_count
		FROM record_level1
		GROUP BY record_id
	  )
	  SELECT
		rl.level1_id AS division_id,
		SUM(rv.v) AS value_sum,
		COUNT(*) FILTER (WHERE rv.is_reported) AS reported,
		COUNT(*) FILTER (WHERE rv.is_zero AND NOT rv.is_reported) AS zero_confirmed,
		COUNT(*) AS records_total,
		COUNT(*) FILTER (WHERE rv.is_flagged) AS flagged_records,
		COUNT(*) FILTER (WHERE rlc.level1_count > 1) AS shared_records
	  FROM record_level1 rl
	  INNER JOIN record_level1_counts rlc
		on rlc.record_id = rl.record_id
	  INNER JOIN record_value rv
		on rv.record_id = rl.record_id
	  GROUP BY rl.level1_id
	`;

	// Execute the query
	const result = await dr.execute(rawQuery);

	return result.rows.map((row: any) => {
		const measure = measureValue(
			{
				sum: row.value_sum,
				reported: row.reported,
				zeroConfirmed: row.zero_confirmed,
				total: row.records_total,
				flagged: row.flagged_records,
			},
			PROVISIONAL_ZERO_COVERAGE,
		);
		return {
			divisionId: row.division_id,
			totalAffected: measure.value,
			measure,
			sharedRecords: Number(row.shared_records),
		};
	});
}

interface DisasterEventCountByDivision {
	divisionId: string;
	eventCount: number;
}

export async function getDisasterEventCountByDivision(
	filters: HazardFilters,
): Promise<DisasterEventCountByDivision[]> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// Build WHERE conditions for disaster_event as SQL objects
	const whereConditions: SQL[] = [];
	whereConditions.push(approvalBasis(filters.audience, basisColumns("de")));
	whereConditions.push(sql`de."country_accounts_id" = ${countryAccountsId}`);
	if (hazardTypeId)
		whereConditions.push(sql`de."hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`de."hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`de."hip_hazard_id" = ${specificHazardId}`);
	if (geographicLevelId) {
		whereConditions.push(sql`EXISTS (
			WITH RECURSIVE division_tree AS (
				SELECT id
				FROM division
				WHERE id = ${geographicLevelId}::uuid
				UNION ALL
				SELECT d.id
				FROM division d
				INNER JOIN division_tree dt ON d.parent_id = dt.id
			)
			SELECT 1
			FROM disaster_event_division ded
			WHERE ded.disaster_event_id = de.id
				AND ded.division_id IN (SELECT id FROM division_tree)
		)`);
	}
	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
		(
		  CASE 
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM-DD')
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM')
			WHEN de."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."start_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM-DD')
			WHEN de."start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."start_date", 'YYYY-MM')
			WHEN de."start_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."start_date", 'YYYY')
			ELSE NULL
		  END <= ${to}::date
		) AND (
		  CASE 
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM-DD')
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM')
			WHEN de."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."end_date", 'YYYY')
			ELSE NULL
		  END IS NULL OR 
		  CASE 
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM-DD')
			WHEN de."end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE(de."end_date", 'YYYY-MM')
			WHEN de."end_date" ~ '^[0-9]{4}$' THEN TO_DATE(de."end_date", 'YYYY')
			ELSE NULL
		  END >= ${from}::date
		)
	  `);
	}

	const eventWhereClause =
		whereConditions.length > 0 ? sql`WHERE ${and(...whereConditions)}` : sql``;

	const rawQuery = sql`
	  WITH RECURSIVE division_hierarchy AS (
		SELECT id, parent_id, id AS level1_id
		FROM "division"
		WHERE parent_id IS NULL
		UNION ALL
		SELECT d.id, d.parent_id, dh.level1_id
		FROM "division" d
		INNER JOIN division_hierarchy dh ON d.parent_id = dh.id
	  ),
	  filtered_events AS (
		SELECT de."id" AS event_id
		FROM "disaster_event" de
		${eventWhereClause}
	  ),
	  event_level1 AS (
		SELECT DISTINCT
		  ded."disaster_event_id" AS event_id,
		  dh.level1_id::text AS level1_id
		FROM "disaster_event_division" ded
		INNER JOIN filtered_events fe
		  ON fe.event_id = ded."disaster_event_id"
		INNER JOIN division_hierarchy dh
		  ON dh.id = ded."division_id"
	  )
	  SELECT 
		el.level1_id AS division_id,
		COUNT(*) AS event_count
	  FROM event_level1 el
	  GROUP BY el.level1_id
	`;

	// Execute the query
	const result = await dr.execute(rawQuery);

	return result.rows.map((row: any) => ({
		divisionId: row.division_id,
		eventCount: Number(row.event_count),
	}));
}

export interface DisasterSummary {
	disasterId: string;
	disasterName: string;
	startDate: string;
	endDate: string;
	provinceAffected: string;
	totalDamages: number;
	totalLosses: number;
	/** null when no record of the event reported a people-affected component. */
	totalAffectedPeople: number | null;
}

export async function getDisasterSummary(
	filters: HazardFilters,
): Promise<DisasterSummary[]> {
	const {
		countryAccountsId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
	} = filters;

	// ---- Step 1: Get all disaster events that match filters ----
	const whereConditions: SQL[] = [];
	whereConditions.push(approvalBasis(filters.audience, basisColumns()));
	whereConditions.push(sql`"country_accounts_id" = ${countryAccountsId}`);
	if (hazardTypeId) whereConditions.push(sql`"hip_type_id" = ${hazardTypeId}`);
	if (hazardClusterId)
		whereConditions.push(sql`"hip_cluster_id" = ${hazardClusterId}`);
	if (specificHazardId)
		whereConditions.push(sql`"hip_hazard_id" = ${specificHazardId}`);
	if (geographicLevelId) {
		whereConditions.push(sql`EXISTS (
			SELECT 1
			FROM disaster_event_division ded
			WHERE ded.disaster_event_id = disaster_event.id
				AND ded.division_id IN ${divisionAndDescendantsSql(geographicLevelId, countryAccountsId)}
		)`);
	}
	if (fromDate || toDate) {
		const from = fromDate || "0001-01-01";
		const to = toDate || "9999-12-31";
		whereConditions.push(sql`
			(
				CASE 
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM-DD')
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM')
					WHEN "start_date" ~ '^[0-9]{4}$' THEN TO_DATE("start_date", 'YYYY')
					ELSE NULL
				END IS NULL OR 
				CASE 
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM-DD')
					WHEN "start_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("start_date", 'YYYY-MM')
					WHEN "start_date" ~ '^[0-9]{4}$' THEN TO_DATE("start_date", 'YYYY')
					ELSE NULL
				END <= ${to}::date
			) AND (
				CASE 
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM-DD')
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM')
					WHEN "end_date" ~ '^[0-9]{4}$' THEN TO_DATE("end_date", 'YYYY')
					ELSE NULL
				END IS NULL OR 
				CASE 
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM-DD')
					WHEN "end_date" ~ '^[0-9]{4}-[0-9]{2}$' THEN TO_DATE("end_date", 'YYYY-MM')
					WHEN "end_date" ~ '^[0-9]{4}$' THEN TO_DATE("end_date", 'YYYY')
					ELSE NULL
				END >= ${from}::date
			)
		`);
	}

	const whereClause =
		whereConditions.length > 0 ? sql`WHERE ${and(...whereConditions)}` : sql``;

	const disasterEventsRes = await dr.execute(sql`
	SELECT id, name_national, start_date, end_date
    FROM disaster_event
    ${whereClause}
  `);

	const disasterEvents = disasterEventsRes.rows as Array<{
		id: string;
		name_national: string | null;
		start_date: string;
		end_date: string;
	}>;

	if (!disasterEvents.length) return [];

	// ---- Step 2: Fetch all related disaster records ----
	const eventIds = disasterEvents.map((e) => e.id);
	const eventIdsList = eventIds.map((id) => `'${id}'`).join(",");

	const recordsRes = await dr.execute(sql`
    SELECT id, disaster_event_id
    FROM disaster_records
    WHERE disaster_event_id = ANY(ARRAY[${sql.raw(eventIdsList)}]::uuid[])
    AND ${approvalBasis(filters.audience, basisColumns())}
  `);
	const disasterRecords = recordsRes.rows as Array<{
		id: string;
		disaster_event_id: string;
	}>;

	if (!disasterRecords.length)
		return disasterEvents.map((e) => ({
			disasterId: e.id,
			disasterName: e.name_national ?? "Unnamed Disaster",
			startDate: e.start_date,
			endDate: e.end_date,
			provinceAffected: "",
			totalDamages: 0,
			totalLosses: 0,
			// No records: the event has no reported people figure (TR-076).
			totalAffectedPeople: null,
		}));

	// ---- Step 3: Get all sector_disaster_records_relation entries ----
	const recordIdsList = disasterRecords.map((r) => `'${r.id}'`).join(",");
	const sdrRes = await dr.execute(sql`
    SELECT disaster_record_id, sector_id, damage_cost, losses_cost
    FROM sector_disaster_records_relation
    WHERE disaster_record_id = ANY(ARRAY[${sql.raw(recordIdsList)}]::uuid[])
  `);
	const sdrRows = sdrRes.rows as Array<{
		disaster_record_id: string;
		sector_id: string;
		damage_cost: string | number | null;
		losses_cost: string | number | null;
	}>;

	const sdrByRecord = new Map<
		string,
		Array<{
			sector_id: string;
			damage_cost: number | null;
			losses_cost: number | null;
		}>
	>();
	const missingDamagePairs = new Set<string>();
	const missingLossPairs = new Set<string>();

	for (const sdr of sdrRows) {
		const rid = String(sdr.disaster_record_id);
		const sid = String(sdr.sector_id);
		const damage =
			sdr.damage_cost != null && sdr.damage_cost !== ""
				? Number(sdr.damage_cost)
				: null;
		const loss =
			sdr.losses_cost != null && sdr.losses_cost !== ""
				? Number(sdr.losses_cost)
				: null;

		const list = sdrByRecord.get(rid) ?? [];
		list.push({ sector_id: sid, damage_cost: damage, losses_cost: loss });
		sdrByRecord.set(rid, list);

		if (damage == null) missingDamagePairs.add(`${rid}|${sid}`);
		if (loss == null) missingLossPairs.add(`${rid}|${sid}`);
	}

	// ---- Step 4: Get fallback damages ----
	const damageFallback = new Map<string, number>();
	if (missingDamagePairs.size > 0) {
		const pairs = Array.from(missingDamagePairs)
			.map((p) => {
				const [rid, sid] = p.split("|");
				return `('${rid}'::uuid, '${sid}'::uuid)`;
			})
			.join(",");
		const fallbackRes = await dr.execute(sql`
      SELECT record_id, sector_id, COALESCE(SUM(total_repair_replacement), 0) AS total
      FROM damages
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(pairs)})
      GROUP BY record_id, sector_id
    `);
		for (const r of fallbackRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total: number;
		}>) {
			damageFallback.set(`${r.record_id}|${r.sector_id}`, Number(r.total) || 0);
		}
	}

	// ---- Step 5: Get fallback losses ----
	const lossFallback = new Map<string, number>();
	if (missingLossPairs.size > 0) {
		const pairs = Array.from(missingLossPairs)
			.map((p) => {
				const [rid, sid] = p.split("|");
				return `('${rid}'::uuid, '${sid}'::uuid)`;
			})
			.join(",");
		const fallbackRes = await dr.execute(sql`
      SELECT record_id, sector_id,
             COALESCE(SUM(COALESCE(public_cost_total, 0) + COALESCE(private_cost_total, 0)), 0) AS total
      FROM losses
      WHERE (record_id, sector_id) IN (VALUES ${sql.raw(pairs)})
      GROUP BY record_id, sector_id
    `);
		for (const r of fallbackRes.rows as Array<{
			record_id: string;
			sector_id: string;
			total: number;
		}>) {
			lossFallback.set(`${r.record_id}|${r.sector_id}`, Number(r.total) || 0);
		}
	}

	// ---- Step 6: Aggregate totals per disaster_event ----
	const totalsByEvent = new Map<string, { damages: number; losses: number }>();
	for (const rec of disasterRecords) {
		const sdrs = sdrByRecord.get(rec.id) ?? [];
		let damageSum = 0;
		let lossSum = 0;
		for (const sdr of sdrs) {
			const d =
				sdr.damage_cost ??
				damageFallback.get(`${rec.id}|${sdr.sector_id}`) ??
				0;
			const l =
				sdr.losses_cost ?? lossFallback.get(`${rec.id}|${sdr.sector_id}`) ?? 0;
			damageSum += d;
			lossSum += l;
		}
		const eventTotals = totalsByEvent.get(rec.disaster_event_id) ?? {
			damages: 0,
			losses: 0,
		};
		eventTotals.damages += damageSum;
		eventTotals.losses += lossSum;
		totalsByEvent.set(rec.disaster_event_id, eventTotals);
	}

	// ---- Step 7: Get affected people ----
	// Composite of injured, missing, displaced and directly affected from the
	// presence totals, reported components only: null when no record of the
	// event reported any component (TR-076, pack C10).
	const affectedRes = await dr.execute(sql`
    SELECT dr."disaster_event_id",
           SUM(
             CASE WHEN hcp."injured_total" > 0 THEN hcp."injured_total" ELSE 0 END +
             CASE WHEN hcp."missing_total" > 0 THEN hcp."missing_total" ELSE 0 END +
             CASE WHEN hcp."displaced_total" > 0 THEN hcp."displaced_total" ELSE 0 END +
             CASE WHEN hcp."affected_direct_total" > 0 THEN hcp."affected_direct_total" ELSE 0 END
           ) FILTER (
             WHERE hcp."injured_total" > 0 OR hcp."missing_total" > 0
               OR hcp."displaced_total" > 0 OR hcp."affected_direct_total" > 0
           ) AS total_affected
    FROM "disaster_records" dr
    LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = dr."id"
		WHERE dr."id" = ANY(ARRAY[${sql.raw(recordIdsList)}]::uuid[])
    GROUP BY dr."disaster_event_id"
  `);
	const affectedByEvent = new Map<string, number | null>();
	for (const r of affectedRes.rows as Array<{
		disaster_event_id: string;
		total_affected: number | string | null;
	}>) {
		affectedByEvent.set(
			r.disaster_event_id,
			r.total_affected === null ? null : Number(r.total_affected),
		);
	}

	// ---- Step 8: Map everything to DisasterSummary ----
	return disasterEvents.map((e) => {
		const totals = totalsByEvent.get(e.id) ?? { damages: 0, losses: 0 };
		const totalAffected = affectedByEvent.get(e.id) ?? null;
		return {
			disasterId: e.id,
			disasterName: e.name_national ?? "Unnamed Disaster",
			startDate: e.start_date,
			endDate: e.end_date,
			provinceAffected: "", // optional: you can compute this later as before
			totalDamages: totals.damages,
			totalLosses: totals.losses,
			totalAffectedPeople: totalAffected,
		};
	});
}
