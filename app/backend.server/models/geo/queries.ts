import { sql, type SQL } from "drizzle-orm";
import { dr } from "~/db.server";
import { cachedGeo } from "~/backend.server/models/geo/cache";
import {
	basisIncludesProvisional,
	basisStatuses,
	type ApprovalAudience,
} from "~/utils/approvalBasis";
import {
	QUERY_REFUSALS,
	type AttGradeFloor,
	type DeltaQuery,
} from "~/utils/deltaQuery";
import {
	GEO_HUMAN_MEASURES,
	GEO_METHOD_VERSION,
	type GeoMeasure,
} from "~/utils/geoMeasures";
import {
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	type MeasureValue,
	type ValueState,
} from "~/utils/valueState";
import { getPopulationDenominator } from "~/backend.server/models/ref/denominator";
import {
	A1_METHOD,
	AFFECTED_DIRECT_METHOD,
	ratePer100k,
	sumMeasures,
} from "~/backend.server/models/ref/rates";

// Geoportal read side (build spec s5; PD-05). Every query reads the geo
// schema only and is scoped to one tenant. The selection is delta.query/1
// (app/utils/deltaQuery.ts, owned by Analytics); the approval basis comes from
// app/utils/approvalBasis.ts (TR-192). Figures are {value, value_state} with
// record counts; records that cannot be placed are counted in the
// unattributed block, never dropped and never redistributed (TR-072).


/**
 * Measures the place panel carries: the human effects, plus dwellings
 * destroyed and damaged as inputs to Sendai B-4 and B-3 (gap review step 3).
 */
const DOSSIER_MEASURES = [
	...GEO_HUMAN_MEASURES,
	"houses_destroyed",
	"houses_damaged",
] as const;

export const ATT_GRADES = ["A", "B", "C", "D"] as const;
export type AttGrade = (typeof ATT_GRADES)[number];

/** Refusal codes; the ones the query parser shares come from QUERY_REFUSALS. */
export type GeoRefusalCode =
	| "CROSS_VERSION_AGGREGATION_REFUSED"
	| "INTENSIVE_QUANTITY_NOT_SUMMABLE"
	| "PRECISION_BELOW_CEILING"
	| "GRAIN_CARDINALITY_EXCEEDED"
	| "MALFORMED_REQUEST"
	| (typeof QUERY_REFUSALS)[keyof typeof QUERY_REFUSALS];

/** A resolved geo request: the selection, the map level and the basis. */
export interface GeoRequest {
	query: DeltaQuery;
	/** Admin level the map aggregates to; geo view state, not a selection. */
	level?: number;
	audience: ApprovalAudience;
	/** Filters this endpoint could not apply, each named (TR-175). */
	notApplied: string[];
}

export interface GeoMeta {
	query: DeltaQuery & { level?: number };
	boundaryVersion: string;
	hazardVocabularyVersion: "HIPs 2025";
	methodVersion: string;
	migrationRunIds: string[];
	approvalBasis: readonly string[];
	provisional: boolean;
	notApplied: string[];
	readModelRefreshedAt: string | null;
}

export interface GeoRefusal {
	meta: GeoMeta | null;
	error: {
		code: GeoRefusalCode;
		message: string;
		requirement: string;
		resolution: string;
	};
	rows: [];
}

export class GeoRefusalError extends Error {
	constructor(
		public readonly code: GeoRefusalCode,
		message: string,
		public readonly requirement: string,
		public readonly resolution: string,
		/** 200 semantic refusal, 422 programming violation, 400 malformed (PD-05). */
		public readonly status: 200 | 400 | 422 = 200,
	) {
		super(message);
	}
}

export function refusalBody(
	err: GeoRefusalError,
	meta: GeoMeta | null,
): GeoRefusal {
	return {
		meta,
		error: {
			code: err.code,
			message: err.message,
			requirement: err.requirement,
			resolution: err.resolution,
		},
		rows: [],
	};
}

/**
 * Runs one geo read with session settings fit for short interactive reads
 * (I-6, NFR-113): no JIT compilation (it cost about 0.35 s per query and
 * saved nothing at this size) and enough work_mem that sorts and hashes over
 * a large tenant's atoms stay in memory. SET LOCAL ends with the transaction.
 */
async function geoRead(query: SQL) {
	return dr.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL jit = off`);
		await tx.execute(sql`SET LOCAL work_mem = '64MB'`);
		return tx.execute(query);
	});
}

export async function readModelRefreshedAt(
	countryAccountsId: string,
): Promise<string | null> {
	const res = await geoRead(sql`
		SELECT refreshed_at FROM geo.refresh_log
		WHERE country_accounts_id = ${countryAccountsId}
	`);
	const row = res.rows[0] as { refreshed_at: Date | string } | undefined;
	return row ? new Date(row.refreshed_at).toISOString() : null;
}

export async function baseMeta(
	countryAccountsId: string,
	req: GeoRequest,
): Promise<GeoMeta> {
	return {
		query: {
			...req.query,
			...(req.level !== undefined && { level: req.level }),
		},
		boundaryVersion: "unknown",
		hazardVocabularyVersion: "HIPs 2025",
		methodVersion: GEO_METHOD_VERSION,
		migrationRunIds: [],
		approvalBasis: basisStatuses(req.audience),
		provisional: false,
		notApplied: [...req.notApplied],
		readModelRefreshedAt: await readModelRefreshedAt(countryAccountsId),
	};
}

/**
 * Filters every figure shares: tenant, approval basis (TR-192) with retired
 * records excluded (DEC-012), and the hazard. Never the division or the date,
 * which callers apply so the records they remove can still be reported.
 */
function scopeFilters(countryAccountsId: string, req: GeoRequest): SQL {
	const statuses = basisStatuses(req.audience);
	const parts: SQL[] = [
		sql`a.country_accounts_id = ${countryAccountsId}`,
		sql`a.record_status IN (${sql.join(
			statuses.map((s) => sql`${s}`),
			sql`, `,
		)})`,
		sql`NOT a.retired`,
	];
	const h = req.query.where.hazard;
	if (h?.typeId) parts.push(sql`a.hip_type_id = ${h.typeId}`);
	if (h?.clusterId) parts.push(sql`a.hip_cluster_id = ${h.clusterId}`);
	if (h?.hazardId) parts.push(sql`a.hip_hazard_id = ${h.hazardId}`);
	return sql.join(parts, sql` AND `);
}

function hasRange(req: GeoRequest): boolean {
	return Boolean(req.query.where.time?.from || req.query.where.time?.to);
}

/** Overlap of the record's period with the requested range. */
function dateInRange(req: GeoRequest): SQL {
	const t = req.query.where.time;
	const parts: SQL[] = [sql`a.start_instant IS NOT NULL`];
	if (t?.from) parts.push(sql`a.end_instant >= geo.date_floor(${t.from})`);
	if (t?.to) parts.push(sql`a.start_instant <= geo.date_ceil(${t.to})`);
	return sql.join(parts, sql` AND `);
}

/**
 * Atoms placed in the requested division or its descendants, or in a member
 * of the requested region or its descendants (RG-1). The parser refuses both
 * together, so at most one applies.
 */
function inDivision(countryAccountsId: string, req: GeoRequest): SQL {
	const regionId = req.query.where.region?.regionId;
	if (regionId) {
		return sql`a.division_id IN (
			SELECT da.division_id FROM geo.division_ancestor da
			JOIN geo.region_member m
				ON m.division_id = da.ancestor_id AND m.country_accounts_id = da.country_accounts_id
			WHERE da.country_accounts_id = ${countryAccountsId} AND m.region_id = ${regionId}
		)`;
	}
	const divisionId = req.query.where.geo?.divisionId;
	if (!divisionId) return sql`true`;
	return sql`a.division_id IN (
		SELECT division_id FROM geo.division_ancestor
		WHERE country_accounts_id = ${countryAccountsId} AND ancestor_id = ${divisionId}
	)`;
}

function gradeFloor(floor: AttGradeFloor | undefined): SQL {
	return floor ? sql`a.att_grade <= ${floor}` : sql`true`;
}

/** One cell: PD-05 G2 fields, plus the C30 and precision counts. */
export interface GeoCell {
	division_id: string;
	value: number | null;
	value_state: ValueState;
	/** Records that reported the measure, confirmed zeros included (PD-05). */
	records_reported: number;
	records_zero_confirmed: number;
	records_not_reported: number;
	records_not_applicable: number;
	records_total: number;
	/** records_reported / records_total. */
	coverage: number;
	plausibility_flagged_records: number;
	gradeDistribution: Record<AttGrade, number>;
	geo_precision: Record<string, number>;
}

export interface GeoUnattributed {
	records: number;
	reasons: Record<string, number>;
	/** Records drawn on the map at this level (so "n of total" can be said). */
	placedRecords?: number;
}

export interface GradeFloorExclusion {
	/** Records with an attribution, none of which passes the floor. */
	records: number;
	/** Those records by their best grade. */
	by_grade: Partial<Record<AttGrade, number>>;
}

interface CellRow {
	measure: string;
	division_id: string;
	sum_reported: string | null;
	reported: string;
	zero_confirmed: string;
	not_applicable: string;
	total: string;
	flagged: string;
	grade_a: string;
	grade_b: string;
	grade_c: string;
	grade_d: string;
	precision: Record<string, number> | null;
}

function toCell(c: CellRow): GeoCell {
	const notApplicable = Number(c.not_applicable);
	const mv = measureValue(
		{
			sum: c.sum_reported,
			reported: c.reported,
			zeroConfirmed: c.zero_confirmed,
			total: Number(c.total) - notApplicable,
			flagged: c.flagged,
		},
		PROVISIONAL_ZERO_COVERAGE,
	);
	const total = mv.recordsTotal + notApplicable;
	const reported = mv.recordsReported + mv.recordsZeroConfirmed;
	return {
		division_id: c.division_id,
		value: mv.value,
		value_state: mv.valueState,
		records_reported: reported,
		records_zero_confirmed: mv.recordsZeroConfirmed,
		records_not_reported: mv.recordsNotReported,
		records_not_applicable: notApplicable,
		records_total: total,
		coverage: total > 0 ? reported / total : 0,
		plausibility_flagged_records: mv.recordsFlagged,
		gradeDistribution: {
			A: Number(c.grade_a),
			B: Number(c.grade_b),
			C: Number(c.grade_c),
			D: Number(c.grade_d),
		},
		geo_precision: Object.fromEntries(
			Object.entries(c.precision ?? {}).map(([k, v]) => [k, Number(v)]),
		),
	};
}

/**
 * The atoms a request reads: one per record (disaster impact) or one per
 * event (the two event dimensions), in the same shape, so one aggregation
 * serves all three dimensions. An event counts as one, always reported.
 */
function atomSource(req: GeoRequest): SQL {
	if (req.query.dimension === "disaster_impact") return sql`geo.impact_atom`;
	return sql`(
		SELECT country_accounts_id, event_id AS disaster_record_id,
			'events'::text AS measure, 1::numeric AS value, 'reported'::text AS value_state,
			att_grade, NULL::text AS geo_precision, '{}'::text[] AS plausibility_flags,
			event_status AS record_status, retired, division_id, unattributed_reason,
			start_instant, end_instant, hip_type_id, hip_cluster_id, hip_hazard_id,
			migration_run_id, derivation
		FROM geo.event_atom
		WHERE dimension = ${req.query.dimension}
	)`;
}

/**
 * Places in-scope atoms at `level` through each division's ancestor, one
 * record once per target division and measure. The first measure carries the
 * record-level reports: unattributed reasons, the grade-floor exclusion,
 * records counted in several areas, run ids and the provisional flag.
 */
export async function aggregate(
	countryAccountsId: string,
	req: GeoRequest,
	measures: readonly GeoMeasure[],
	level: number,
	restrictToDivision?: string,
	/**
	 * RG-1 region total: every in-area atom goes to this one id, so a record
	 * linked to several member areas counts once. Level is not used.
	 */
	collapseTo?: string,
) {
	const t = countryAccountsId;
	const m0 = measures[0];
	const ranged = hasRange(req);
	const floor = req.query.minAttGrade;
	const restrict = restrictToDivision
		? sql`AND da.ancestor_id = ${restrictToDivision}`
		: sql``;
	const placedRows = collapseTo
		? sql`
			SELECT DISTINCT ON (g.measure, g.disaster_record_id)
				g.measure, ${collapseTo}::uuid AS division_id, g.disaster_record_id,
				g.value, g.value_state, g.att_grade, g.geo_precision,
				g.plausibility_flags, g.record_status, g.migration_run_id, g.derivation
			FROM graded g
			ORDER BY g.measure, g.disaster_record_id, g.att_grade`
		: sql`
			SELECT DISTINCT ON (g.measure, da.ancestor_id, g.disaster_record_id)
				g.measure, da.ancestor_id AS division_id, g.disaster_record_id,
				g.value, g.value_state, g.att_grade, g.geo_precision,
				g.plausibility_flags, g.record_status, g.migration_run_id, g.derivation
			FROM graded g
			JOIN geo.division_ancestor da
				ON da.division_id = g.division_id
				AND da.country_accounts_id = ${t}
				AND da.ancestor_level = ${level}
				${restrict}
			ORDER BY g.measure, da.ancestor_id, g.disaster_record_id, g.att_grade`;

	const res = await geoRead(sql`
		WITH scope AS (
			SELECT a.* FROM ${atomSource(req)} a
			WHERE ${scopeFilters(t, req)}
				AND a.measure IN (${sql.join(
					measures.map((m) => sql`${m}`),
					sql`, `,
				)})
		),
		ranged AS (
			SELECT * FROM scope a WHERE ${ranged ? dateInRange(req) : sql`true`}
		),
		in_area AS (
			SELECT * FROM ranged a
			WHERE a.division_id IS NULL OR ${inDivision(t, req)}
		),
		graded AS (
			SELECT * FROM in_area a
			WHERE a.division_id IS NOT NULL AND ${gradeFloor(floor)}
		),
		placed AS (${placedRows}),
		prec AS (
			SELECT measure, division_id, jsonb_object_agg(geo_precision, n) AS precision
			FROM (
				SELECT measure, division_id, geo_precision, COUNT(*) AS n
				FROM placed WHERE geo_precision IS NOT NULL
				GROUP BY measure, division_id, geo_precision
			) x
			GROUP BY measure, division_id
		),
		agg AS (
			SELECT p.measure, p.division_id,
				SUM(p.value) FILTER (WHERE p.value_state = 'reported') AS sum_reported,
				COUNT(*) FILTER (WHERE p.value_state = 'reported') AS reported,
				COUNT(*) FILTER (WHERE p.value_state = 'zero_confirmed') AS zero_confirmed,
				COUNT(*) FILTER (WHERE p.value_state = 'not_applicable') AS not_applicable,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE cardinality(p.plausibility_flags) > 0) AS flagged,
				COUNT(*) FILTER (WHERE p.att_grade = 'A') AS grade_a,
				COUNT(*) FILTER (WHERE p.att_grade = 'B') AS grade_b,
				COUNT(*) FILTER (WHERE p.att_grade = 'C') AS grade_c,
				COUNT(*) FILTER (WHERE p.att_grade = 'D') AS grade_d
			FROM placed p
			GROUP BY p.measure, p.division_id
		),
		cells AS (
			SELECT agg.*, prec.precision
			FROM agg LEFT JOIN prec USING (measure, division_id)
		),
		placed_records AS (
			SELECT DISTINCT disaster_record_id FROM placed WHERE measure = ${m0}
		),
		passing_records AS (
			SELECT DISTINCT disaster_record_id FROM graded WHERE measure = ${m0}
		),
		unplaced AS (
			SELECT DISTINCT ON (s.disaster_record_id) s.disaster_record_id,
				CASE
					WHEN ${ranged} AND s.start_instant IS NULL THEN 'undated'
					WHEN s.unattributed_reason IS NOT NULL THEN s.unattributed_reason
					ELSE 'coarser_than_level'
				END AS reason
			FROM scope s
			WHERE s.measure = ${m0}
				AND (
					(${ranged} AND s.start_instant IS NULL)
					OR (s.division_id IS NULL
						AND s.disaster_record_id IN (SELECT disaster_record_id FROM ranged))
					OR (s.disaster_record_id IN (SELECT disaster_record_id FROM passing_records)
						AND s.disaster_record_id NOT IN (SELECT disaster_record_id FROM placed_records))
				)
			ORDER BY s.disaster_record_id, s.unattributed_reason NULLS LAST
		),
		floor_excluded AS (
			SELECT a.disaster_record_id, min(a.att_grade) AS best_grade
			FROM in_area a
			WHERE a.measure = ${m0} AND a.division_id IS NOT NULL
				AND a.disaster_record_id NOT IN (SELECT disaster_record_id FROM passing_records)
			GROUP BY a.disaster_record_id
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(to_jsonb(cells)), '[]'::jsonb) FROM cells) AS cells,
			(SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
				FROM (SELECT reason, COUNT(*) AS n FROM unplaced GROUP BY reason) u) AS reasons,
			(SELECT COUNT(*) FROM unplaced) AS unattributed,
			(SELECT COUNT(*) FROM placed_records) AS placed_records,
			(SELECT COUNT(*) FROM floor_excluded) AS floor_excluded,
			(SELECT COALESCE(jsonb_object_agg(best_grade, n), '{}'::jsonb)
				FROM (SELECT best_grade, COUNT(*) AS n FROM floor_excluded GROUP BY best_grade) f) AS floor_by_grade,
			(SELECT COALESCE(jsonb_agg(DISTINCT migration_run_id), '[]'::jsonb)
				FROM placed WHERE migration_run_id IS NOT NULL) AS run_ids,
			(SELECT COUNT(*) FROM (
				SELECT disaster_record_id FROM placed WHERE measure = ${m0}
				GROUP BY disaster_record_id HAVING COUNT(*) > 1) m) AS multi_division,
			(SELECT COALESCE(bool_or(record_status <> 'published'), false) FROM placed) AS provisional,
			(SELECT COALESCE(jsonb_object_agg(derivation, n), '{}'::jsonb)
				FROM (SELECT derivation, COUNT(DISTINCT disaster_record_id) AS n
					FROM placed WHERE measure = ${m0} GROUP BY derivation) dv) AS derivations
	`);

	const row = res.rows[0] as {
		cells: CellRow[];
		reasons: Record<string, number | string>;
		unattributed: string | number;
		placed_records: string | number;
		floor_excluded: string | number;
		floor_by_grade: Record<string, number | string>;
		run_ids: string[];
		multi_division: string | number;
		provisional: boolean;
		derivations: Record<string, number | string>;
	};

	const cells = new Map<string, GeoCell[]>();
	for (const c of row.cells) {
		const list = cells.get(c.measure) ?? [];
		list.push(toCell(c));
		cells.set(c.measure, list);
	}
	for (const list of cells.values()) {
		list.sort((a, b) => a.division_id.localeCompare(b.division_id));
	}

	return {
		cells,
		unattributed: {
			records: Number(row.unattributed),
			reasons: Object.fromEntries(
				Object.entries(row.reasons).map(([k, v]) => [k, Number(v)]),
			),
			placedRecords: Number(row.placed_records),
		} as GeoUnattributed,
		excludedByGradeFloor: floor
			? ({
					records: Number(row.floor_excluded),
					by_grade: Object.fromEntries(
						Object.entries(row.floor_by_grade).map(([k, v]) => [k, Number(v)]),
					),
				} as GradeFloorExclusion)
			: null,
		runIds: row.run_ids.slice().sort(),
		multiDivisionRecords: Number(row.multi_division),
		provisional: Boolean(row.provisional),
		derivations: Object.fromEntries(
			Object.entries(row.derivations).map(([k, v]) => [k, Number(v)]),
		),
	};
}

async function tenantMaxLevel(
	countryAccountsId: string,
): Promise<number | null> {
	const res = await geoRead(sql`
		SELECT max(admin_level) AS max_level FROM geo.division_geom_cache
		WHERE country_accounts_id = ${countryAccountsId}
	`);
	const v = (res.rows[0] as { max_level: number | null } | undefined)
		?.max_level;
	return v === null || v === undefined ? null : Number(v);
}

/** G2. One measure aggregated by division at one admin level. */
async function getChoroplethUncached(
	countryAccountsId: string,
	req: GeoRequest,
) {
	const measure = req.query.measure as GeoMeasure;
	const level = req.level as number;
	const meta = await baseMeta(countryAccountsId, req);

	const maxLevel = await tenantMaxLevel(countryAccountsId);
	if (maxLevel !== null && level > maxLevel) {
		throw new GeoRefusalError(
			"PRECISION_BELOW_CEILING",
			`Level ${level} is finer than the finest admin level this instance holds (${maxLevel}).`,
			"TR-174; pack C28, C16",
			`Request level ${maxLevel} or coarser.`,
		);
	}

	const agg = await aggregate(countryAccountsId, req, [measure], level);
	meta.migrationRunIds = agg.runIds;
	meta.provisional = agg.provisional && basisIncludesProvisional(req.audience);

	const dimension = req.query.dimension;
	const isEvent = dimension !== "disaster_impact";
	const unit = isEvent ? "events" : "disaster impacts";
	const captions = [
		isEvent
			? `Counts of ${dimension === "disaster_event" ? "disaster" : "hazardous"} events.`
			: measure === "records"
				? "Number of disaster impacts reported in each area. One disaster event can have several."
				: measure.startsWith("houses_")
					? "House counts from Housing damage. Disaster impacts that did not report the measure are counted, not treated as zero."
					: "Human effects from disaster impact totals. Disaster impacts that did not report the measure are counted, not treated as zero.",
		"Reporting completeness is not modelled.",
	];
	if (isEvent && (agg.derivations.from_records ?? 0) > 0) {
		captions.push(
			`${agg.derivations.from_records} events have no area of their own and are placed where their disaster impacts are.`,
		);
	}
	if (agg.multiDivisionRecords > 0) {
		captions.push(
			`${agg.multiDivisionRecords} ${unit} are linked to more than one area and count in each, so area values do not add up to a total.`,
		);
	}
	if (meta.provisional) {
		captions.push("Provisional: includes data not yet published.");
	}

	return {
		meta,
		dimension,
		entity: isEvent ? dimension : "record",
		measure,
		quantityType: "extensive" as const,
		level,
		cells: agg.cells.get(measure) ?? [],
		unattributed: agg.unattributed,
		...(agg.excludedByGradeFloor && {
			excluded_by_grade_floor: agg.excludedByGradeFloor,
		}),
		multiDivisionRecords: agg.multiDivisionRecords,
		...(isEvent && { derivation: agg.derivations }),
		caption: captions.join(" "),
	};
}

/** Tier column for a zoom level. */
export function geomColumnForZoom(
	z: number,
): "geom_z4" | "geom_z8" | "geom_z12" {
	if (z <= 5) return "geom_z4";
	if (z <= 9) return "geom_z8";
	return "geom_z12";
}

/** G1. Simplified division geometry as GeoJSON for one level. */
async function getBoundariesUncached(
	countryAccountsId: string,
	params: {
		level: number;
		parentId?: string | null;
		bbox?: [number, number, number, number] | null;
		z?: number | null;
		lang: string;
	},
) {
	const column = sql.raw(geomColumnForZoom(params.z ?? 8));
	const filters: SQL[] = [
		sql`c.country_accounts_id = ${countryAccountsId}`,
		sql`c.admin_level = ${params.level}`,
		sql`c.${column} IS NOT NULL`,
	];
	if (params.parentId) filters.push(sql`c.parent_id = ${params.parentId}`);
	if (params.bbox) {
		const [minx, miny, maxx, maxy] = params.bbox;
		filters.push(
			sql`c.bbox && ST_MakeEnvelope(${minx}, ${miny}, ${maxx}, ${maxy}, 4326)`,
		);
	}
	const res = await geoRead(sql`
		SELECT jsonb_build_object(
			'type', 'FeatureCollection',
			'boundaryVersion', 'unknown',
			'features', COALESCE(jsonb_agg(jsonb_build_object(
				'type', 'Feature',
				'id', c.division_id,
				'geometry', ST_AsGeoJSON(c.${column}, 5)::jsonb,
				'properties', jsonb_build_object(
					'divisionId', c.division_id,
					'nationalId', c.national_id,
					'importId', c.import_id,
					'name', COALESCE(c.name ->> ${params.lang}, c.name ->> 'en', ''),
					'level', c.admin_level,
					'parentId', c.parent_id,
					'boundaryVintage', c.boundary_vintage,
					-- RV-5: a point always inside the division (bubble anchor), and
					-- its true area for densities per 1,000 km2.
					'labelPoint', (ST_AsGeoJSON(ST_PointOnSurface(COALESCE(c.geom_z8, c.geom_z12, c.geom_z4)), 5)::jsonb) -> 'coordinates',
					'areaKm2', round((ST_Area(COALESCE(c.geom_z12, c.geom_z8, c.geom_z4)::geography) / 1e6)::numeric, 3)
				)
			) ORDER BY c.division_id), '[]'::jsonb)
		) AS fc
		FROM geo.division_geom_cache c
		WHERE ${sql.join(filters, sql` AND `)}
	`);
	return (res.rows[0] as { fc: unknown }).fc;
}

/** T1. Mapbox Vector Tile of divisions at one level; empty buffer when none. */
export async function getDivisionTile(
	countryAccountsId: string,
	level: number,
	z: number,
	x: number,
	y: number,
	lang: string,
): Promise<Buffer> {
	const column = sql.raw(geomColumnForZoom(z));
	const res = await geoRead(sql`
		WITH bounds AS (SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS env),
		mvt AS (
			SELECT
				ST_AsMVTGeom(ST_Transform(c.${column}, 3857), bounds.env, 4096, 64, true) AS geom,
				c.division_id::text AS division_id,
				COALESCE(c.name ->> ${lang}, c.name ->> 'en', '') AS name,
				c.admin_level AS level
			FROM geo.division_geom_cache c, bounds
			WHERE c.country_accounts_id = ${countryAccountsId}
				AND c.admin_level = ${level}
				AND c.${column} IS NOT NULL
				AND c.${column} && ST_Transform(bounds.env, 4326)
		)
		SELECT ST_AsMVT(mvt, 'divisions', 4096, 'geom') AS tile
		FROM mvt WHERE geom IS NOT NULL
	`);
	const tile = (res.rows[0] as { tile: Buffer | null } | undefined)?.tile;
	return tile ?? Buffer.alloc(0);
}

/** G3. Recurrence, hazard mix, counts by year and cumulative human effects. */
async function getPlaceDossierUncached(
	countryAccountsId: string,
	divisionId: string,
	req: GeoRequest,
	lang: string,
) {
	const t = countryAccountsId;
	const divRes = await geoRead(sql`
		SELECT c.division_id, c.admin_level, c.national_id, c.name,
			p.division_id AS parent_id, p.name AS parent_name
		FROM geo.division_geom_cache c
		LEFT JOIN geo.division_geom_cache p
			ON p.division_id = c.parent_id AND p.country_accounts_id = c.country_accounts_id
		WHERE c.division_id = ${divisionId} AND c.country_accounts_id = ${t}
	`);
	const div = divRes.rows[0] as
		| {
				division_id: string;
				admin_level: number;
				national_id: string | null;
				name: Record<string, string>;
				parent_id: string | null;
				parent_name: Record<string, string> | null;
		  }
		| undefined;
	if (!div) {
		return null;
	}
	const meta = await baseMeta(t, req);
	const level = Number(div.admin_level);
	const localName = (n: Record<string, string> | null) =>
		n ? (n[lang] ?? n.en ?? "") : null;
	const ranged = hasRange(req);
	const floor = req.query.minAttGrade;

	// Records placed in this division or below it: one row per record.
	const yearsRes = await geoRead(sql`
		WITH placed AS (
			SELECT DISTINCT ON (a.disaster_record_id)
				a.disaster_record_id, a.start_instant, a.hip_type_id, a.att_grade
			FROM geo.impact_atom a
			JOIN geo.division_ancestor da
				ON da.division_id = a.division_id
				AND da.country_accounts_id = ${t}
				AND da.ancestor_id = ${divisionId}
			WHERE ${scopeFilters(t, req)}
				AND a.measure = 'records'
				AND ${ranged ? dateInRange(req) : sql`true`}
				AND ${gradeFloor(floor)}
			ORDER BY a.disaster_record_id, a.att_grade
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('year', y, 'recordCount', n) ORDER BY y), '[]'::jsonb)
				FROM (SELECT extract(year FROM start_instant)::int AS y, COUNT(*) AS n
					FROM placed WHERE start_instant IS NOT NULL GROUP BY 1) t) AS by_year,
			(SELECT COUNT(*) FROM placed WHERE start_instant IS NULL) AS undated,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('hipTypeId', hip_type_id, 'recordCount', n) ORDER BY n DESC, hip_type_id), '[]'::jsonb)
				FROM (SELECT hip_type_id, COUNT(*) AS n FROM placed GROUP BY hip_type_id) t) AS hazard_mix,
			(SELECT COUNT(*) FROM placed) AS record_count,
			(SELECT COALESCE(jsonb_object_agg(att_grade, n), '{}'::jsonb)
				FROM (SELECT att_grade, COUNT(*) AS n FROM placed GROUP BY att_grade) g) AS grades
	`);
	const yr = yearsRes.rows[0] as {
		by_year: { year: number; recordCount: number }[];
		undated: string | number;
		hazard_mix: { hipTypeId: string | null; recordCount: number }[];
		record_count: string | number;
		grades: Record<string, number | string>;
	};

	const years = yr.by_year.map((b) => b.year);
	const periodsWithNoReporting: string[] = [];
	if (years.length > 1) {
		const present = new Set(years);
		let gapStart: number | null = null;
		for (let y = years[0]; y <= years[years.length - 1]; y++) {
			if (!present.has(y)) {
				if (gapStart === null) gapStart = y;
			} else if (gapStart !== null) {
				periodsWithNoReporting.push(
					gapStart === y - 1 ? `${gapStart}` : `${gapStart}-${y - 1}`,
				);
				gapStart = null;
			}
		}
	}

	// All human-effect measures for this division in one pass, restricted to
	// it, so provenance (run ids, provisional) describes this place only.
	const agg = await aggregate(t, req, DOSSIER_MEASURES, level, divisionId);
	const cumulative: Record<string, Omit<GeoCell, "division_id">> = {};
	for (const measure of DOSSIER_MEASURES) {
		const cell = agg.cells.get(measure)?.[0];
		if (cell) {
			const { division_id: _ignored, ...rest } = cell;
			cumulative[measure] = rest;
		} else {
			cumulative[measure] = {
				value: null,
				value_state: "not_reported",
				records_reported: 0,
				records_zero_confirmed: 0,
				records_not_reported: 0,
				records_not_applicable: 0,
				records_total: 0,
				coverage: 0,
				plausibility_flagged_records: 0,
				gradeDistribution: { A: 0, B: 0, C: 0, D: 0 },
				geo_precision: {},
			};
		}
	}
	meta.migrationRunIds = agg.runIds;
	meta.provisional = agg.provisional && basisIncludesProvisional(req.audience);

	const grades = Object.fromEntries(
		ATT_GRADES.map((g) => [g, Number(yr.grades[g] ?? 0)]),
	) as Record<AttGrade, number>;

	return {
		meta,
		division: {
			id: div.division_id,
			name: localName(div.name),
			nationalId: div.national_id,
			level,
			parent: div.parent_id
				? { id: div.parent_id, name: localName(div.parent_name) }
				: null,
		},
		recurrence: {
			recordCount: Number(yr.record_count),
			hazardTypeCount: yr.hazard_mix.filter((h) => h.hipTypeId).length,
			firstYear: years[0] ?? null,
			lastYear: years[years.length - 1] ?? null,
			undatedRecordCount: Number(yr.undated),
			periodsWithNoReporting,
			gradeDistribution: grades,
			note: "Periods with nothing reported are shown as no reporting, never as zero. Completeness is not modelled.",
		},
		hazardMix: yr.hazard_mix,
		byYear: yr.by_year,
		cumulative,
		events: await eventsInArea(t, req, divisionId),
	};
}

export interface NationalRate {
	/** Per 100,000 people, or null with its state. */
	value: number | null;
	valueState: string;
	/** Why no rate was formed, when it was refused. */
	refusal: { code: string; reason: string } | null;
}

export interface NationalRates {
	year: number;
	/** Sendai A-1: deaths and missing per 100,000. */
	a1: NationalRate;
	/** DELTA rate of directly affected per 100,000. Not Sendai B-1. */
	affectedDirect: NationalRate;
	denominator: {
		value: number;
		source: string;
		release: string;
		year: number;
	} | null;
}

/**
 * National rates per 100,000 for the whole-country panel (gap review step 3).
 * Rates are annual (Sendai counts effects in the year they occur), so they
 * are formed only when the page's period is one year; otherwise null, and
 * the panel says so. The numerators are the panel's own totals on the
 * page's approval basis; the denominator is the Analytics population helper
 * (R2 source order, R3 reference year, never 0 for a missing value).
 */
async function nationalRates(
	countryAccountsId: string,
	req: GeoRequest,
	cumulative: Record<string, { value: number | null; value_state: string }>,
): Promise<NationalRates | null> {
	const from = req.query.where.time?.from?.slice(0, 4);
	const to = req.query.where.time?.to?.slice(0, 4);
	if (!from || from !== to) return null;
	const year = Number(from);
	const denominator = await getPopulationDenominator(countryAccountsId, {
		divisionId: null,
		year,
	});
	const mv = (m: string): MeasureValue =>
		({
			value: cumulative[m]?.value ?? null,
			valueState: cumulative[m]?.value_state ?? "not_reported",
		}) as MeasureValue;
	const one = (parts: MeasureValue[], method: string): NationalRate => {
		const r = ratePer100k(
			{ ...sumMeasures(parts), provenance: { year, method } },
			denominator,
			method,
		);
		return r.ok
			? {
					value: r.value === null ? null : Math.round(r.value * 100) / 100,
					valueState: r.valueState,
					refusal: null,
				}
			: {
					value: null,
					valueState: "not_reported",
					refusal: { code: r.refusal.code, reason: r.refusal.reason },
				};
	};
	return {
		year,
		a1: one([mv("deaths"), mv("missing")], A1_METHOD),
		affectedDirect: one([mv("affected_direct")], AFFECTED_DIRECT_METHOD),
		denominator: denominator.ok
			? {
					value: denominator.value,
					source: denominator.provenance.source.name,
					release: denominator.provenance.release.version,
					year: denominator.year,
				}
			: null,
	};
}

export interface EventsInArea {
	/** Disaster records in scope here (each once). */
	records: number;
	/** Of those, records that belong to a disaster event. */
	linkedRecords: number;
	/** Distinct disaster events those records belong to. */
	events: number;
	/** Events here with a GLIDE number, and with a national event code. */
	glideEvents: number;
	nationalCodeEvents: number;
	/** The events with the most records here, largest first. */
	top: {
		id: string;
		name: string | null;
		glide: string | null;
		nationalId: string | null;
		records: number;
	}[];
}

/**
 * Records per event and event identity for one area, or the whole country
 * when divisionId is null (gap review step 4; DE-2, DE-3). Read from the
 * record atoms with the page's filters, so it agrees with the record counts
 * beside it. Records without a disaster event are counted, never hidden:
 * most migrated records have none.
 */
async function eventsInArea(
	countryAccountsId: string,
	req: GeoRequest,
	divisionId: string | null,
	topN = 5,
): Promise<EventsInArea> {
	const t = countryAccountsId;
	const ranged = hasRange(req);
	const res = await geoRead(sql`
		WITH recs AS (
			SELECT DISTINCT a.disaster_record_id, a.disaster_event_id
			FROM geo.impact_atom a
			${
				divisionId
					? sql`JOIN geo.division_ancestor da
						ON da.division_id = a.division_id
						AND da.country_accounts_id = ${t}
						AND da.ancestor_id = ${divisionId}`
					: sql``
			}
			WHERE ${scopeFilters(t, req)}
				AND a.measure = 'records'
				AND ${ranged ? dateInRange(req) : sql`true`}
				AND ${gradeFloor(req.query.minAttGrade)}
		),
		ev AS (
			SELECT disaster_event_id AS id, COUNT(*) AS n
			FROM recs WHERE disaster_event_id IS NOT NULL
			GROUP BY disaster_event_id
		)
		SELECT
			(SELECT COUNT(DISTINCT disaster_record_id) FROM recs) AS records,
			(SELECT COALESCE(SUM(n), 0) FROM ev) AS linked_records,
			(SELECT COUNT(*) FROM ev) AS events,
			(SELECT COUNT(*) FROM ev JOIN disaster_event e ON e.id = ev.id
				WHERE COALESCE(e.glide, '') <> '') AS glide_events,
			(SELECT COUNT(*) FROM ev JOIN disaster_event e ON e.id = ev.id
				WHERE COALESCE(e.national_disaster_id, '') <> '') AS national_events,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object(
					'id', x.id, 'name', x.name, 'glide', x.glide,
					'nationalId', x.national_id, 'records', x.n
				) ORDER BY x.n DESC, x.id), '[]'::jsonb)
				FROM (
					SELECT ev.id, ev.n,
						NULLIF(COALESCE(NULLIF(e.name_national, ''), e.name_global_or_regional), '') AS name,
						NULLIF(e.glide, '') AS glide,
						NULLIF(e.national_disaster_id, '') AS national_id
					FROM ev JOIN disaster_event e ON e.id = ev.id
					WHERE e.country_accounts_id = ${t}
					ORDER BY ev.n DESC, ev.id
					LIMIT ${topN}
				) x) AS top
	`);
	const r = res.rows[0] as {
		records: string | number;
		linked_records: string | number;
		events: string | number;
		glide_events: string | number;
		national_events: string | number;
		top: EventsInArea["top"];
	};
	return {
		records: Number(r.records),
		linkedRecords: Number(r.linked_records),
		events: Number(r.events),
		glideEvents: Number(r.glide_events),
		nationalCodeEvents: Number(r.national_events),
		top: r.top.map((e) => ({ ...e, records: Number(e.records) })),
	};
}

/**
 * G6. HIPs tree with self and subtree record counts for the tenant (VIS-H03,
 * VIS-H04). A chapeau code (ending "00", for example MH0600) counts itself
 * as "self", and every hazard sharing its four-character prefix as "subtree",
 * so records coded at the chapeau never vanish from the tree. Counts follow
 * the approval basis; no date, division or grade filter applies.
 */
async function getHazardTreeUncached(
	countryAccountsId: string,
	req: GeoRequest,
	lang: string,
) {
	const meta = await baseMeta(countryAccountsId, req);
	const w = req.query.where;
	for (const [name, set] of [
		["division", Boolean(w.geo)],
		["from/to", Boolean(w.time)],
		["minAttGrade", Boolean(req.query.minAttGrade)],
	] as const) {
		if (set)
			meta.notApplied.push(
				`${name}: the hazard tree counts all disaster impacts`,
			);
	}
	const res = await geoRead(sql`
		WITH recs AS (
			SELECT DISTINCT a.disaster_record_id, a.hip_type_id, a.hip_cluster_id, a.hip_hazard_id
			FROM geo.impact_atom a
			WHERE ${scopeFilters(countryAccountsId, { ...req, query: { ...req.query, where: {} } })}
				AND a.measure = 'records'
		),
		by_type AS (
			SELECT hip_type_id AS id, COUNT(*) AS subtree,
				COUNT(*) FILTER (WHERE hip_cluster_id IS NULL AND hip_hazard_id IS NULL) AS self
			FROM recs WHERE hip_type_id IS NOT NULL GROUP BY hip_type_id
		),
		by_cluster AS (
			SELECT hip_cluster_id AS id, COUNT(*) AS subtree,
				COUNT(*) FILTER (WHERE hip_hazard_id IS NULL) AS self
			FROM recs WHERE hip_cluster_id IS NOT NULL GROUP BY hip_cluster_id
		),
		by_hazard AS (
			SELECT hip_hazard_id AS id, COUNT(*) AS self
			FROM recs WHERE hip_hazard_id IS NOT NULL GROUP BY hip_hazard_id
		),
		hz AS (
			SELECT h.id, h.cluster_id, h.code, h.name,
				COALESCE(h.code LIKE '%00', false) AS is_chapeau,
				COALESCE(bh.self, 0) AS self
			FROM public.hip_hazard h
			LEFT JOIN by_hazard bh ON bh.id = h.id
		),
		hz_subtree AS (
			SELECT h.id,
				CASE WHEN h.is_chapeau THEN (
					SELECT COALESCE(SUM(h2.self), 0) FROM hz h2
					WHERE h2.cluster_id = h.cluster_id AND left(h2.code, 4) = left(h.code, 4)
				) ELSE h.self END AS subtree
			FROM hz h
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'id', t.id, 'name', COALESCE(t.name ->> ${lang}, t.name ->> 'en', ''),
				'recordCountSelf', COALESCE(bt.self, 0),
				'recordCountSubtree', COALESCE(bt.subtree, 0)
			) ORDER BY t.id), '[]'::jsonb)
			FROM public.hip_class t LEFT JOIN by_type bt ON bt.id = t.id) AS types,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'id', c.id, 'typeId', c.type_id, 'name', COALESCE(c.name ->> ${lang}, c.name ->> 'en', ''),
				'recordCountSelf', COALESCE(bc.self, 0),
				'recordCountSubtree', COALESCE(bc.subtree, 0)
			) ORDER BY c.id), '[]'::jsonb)
			FROM public.hip_cluster c LEFT JOIN by_cluster bc ON bc.id = c.id) AS clusters,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'id', h.id, 'clusterId', h.cluster_id, 'code', h.code,
				'name', COALESCE(h.name ->> ${lang}, h.name ->> 'en', ''),
				'isChapeau', h.is_chapeau,
				'recordCountSelf', h.self,
				'recordCountSubtree', hs.subtree
			) ORDER BY h.code, h.id), '[]'::jsonb)
			FROM hz h JOIN hz_subtree hs ON hs.id = h.id) AS hazards,
			(SELECT COUNT(*) FROM recs WHERE hip_type_id IS NULL) AS unclassified
	`);
	const row = res.rows[0] as {
		types: {
			id: string;
			name: string;
			recordCountSelf: number;
			recordCountSubtree: number;
		}[];
		clusters: {
			id: string;
			typeId: string;
			name: string;
			recordCountSelf: number;
			recordCountSubtree: number;
		}[];
		hazards: {
			id: string;
			clusterId: string;
			code: string;
			name: string;
			isChapeau: boolean;
			recordCountSelf: number;
			recordCountSubtree: number;
		}[];
		unclassified: string | number;
	};
	const types = row.types.map((ty) => ({
		...ty,
		clusters: row.clusters
			.filter((c) => c.typeId === ty.id)
			.map((c) => ({
				...c,
				hazards: row.hazards.filter((h) => h.clusterId === c.id),
			})),
	}));
	return {
		meta,
		vocabularyVersion: "HIPs 2025" as const,
		unclassifiedRecordCount: Number(row.unclassified),
		types,
	};
}

/** Events placed in one division at the requested level. */
export interface DivisionEventCount {
	/** Events counted once in this division (an event in several counts in each). */
	events: number;
	/** Of those, events placed where their member records are (no own link). */
	fromRecords: number;
}

/**
 * Event counts per division from geo.event_atom, the one derivation of
 * "event in a division" shared by the geoportal and the analytics maps
 * (Analytics, 2026-10-17). Same scope as the choropleth: approval basis,
 * hazard, date range, division or region, grade floor. An event that cannot
 * be placed at the level is counted in unplaced with its reason, never
 * dropped. Division counts do not add up to a total.
 */
async function eventCountsByDivisionUncached(
	countryAccountsId: string,
	req: GeoRequest & { level: number },
): Promise<{
	byDivision: Map<string, DivisionEventCount>;
	unplacedEvents: number;
	reasons: Record<string, number>;
}> {
	if (req.query.dimension === "disaster_impact") {
		throw new Error("eventCountsByDivision: use an event dimension");
	}
	const t = countryAccountsId;
	const ranged = hasRange(req);
	const res = await geoRead(sql`
		WITH scope AS (
			SELECT a.* FROM ${atomSource(req)} a WHERE ${scopeFilters(t, req)}
		),
		ranged AS (
			SELECT * FROM scope a WHERE ${ranged ? dateInRange(req) : sql`true`}
		),
		in_area AS (
			SELECT * FROM ranged a
			WHERE a.division_id IS NULL OR ${inDivision(t, req)}
		),
		placed AS (
			SELECT DISTINCT ON (da.ancestor_id, g.disaster_record_id)
				da.ancestor_id AS division_id, g.disaster_record_id AS event_id, g.derivation
			FROM in_area g
			JOIN geo.division_ancestor da
				ON da.division_id = g.division_id
				AND da.country_accounts_id = ${t}
				AND da.ancestor_level = ${req.level}
			WHERE g.division_id IS NOT NULL AND ${gradeFloor(req.query.minAttGrade)}
			ORDER BY da.ancestor_id, g.disaster_record_id, g.att_grade
		),
		unplaced AS (
			SELECT DISTINCT ON (s.disaster_record_id) s.disaster_record_id,
				CASE
					WHEN ${ranged} AND s.start_instant IS NULL THEN 'undated'
					WHEN s.unattributed_reason IS NOT NULL THEN s.unattributed_reason
					ELSE 'coarser_than_level'
				END AS reason
			FROM scope s
			WHERE s.disaster_record_id NOT IN (SELECT event_id FROM placed)
				AND (
					(${ranged} AND s.start_instant IS NULL)
					OR s.disaster_record_id IN (SELECT disaster_record_id FROM in_area)
				)
			ORDER BY s.disaster_record_id, s.unattributed_reason NULLS LAST
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'division_id', division_id, 'events', n, 'from_records', fr)), '[]'::jsonb)
				FROM (SELECT division_id, COUNT(*) AS n,
					COUNT(*) FILTER (WHERE derivation = 'from_records') AS fr
					FROM placed GROUP BY division_id) d) AS divisions,
			(SELECT COUNT(*) FROM unplaced) AS unplaced,
			(SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
				FROM (SELECT reason, COUNT(*) AS n FROM unplaced GROUP BY reason) u) AS reasons
	`);
	const row = res.rows[0] as {
		divisions: { division_id: string; events: number; from_records: number }[];
		unplaced: string | number;
		reasons: Record<string, number | string>;
	};
	return {
		byDivision: new Map(
			row.divisions.map((d) => [
				d.division_id,
				{ events: Number(d.events), fromRecords: Number(d.from_records) },
			]),
		),
		unplacedEvents: Number(row.unplaced),
		reasons: Object.fromEntries(
			Object.entries(row.reasons).map(([k, v]) => [k, Number(v)]),
		),
	};
}

// Cached entry points (I-6, Alex: option A). Each answer is kept until the
// tenant's next read-model refresh; the key includes the whole request.

/** G2. One measure aggregated by division at one admin level. */
export async function getChoropleth(
	countryAccountsId: string,
	req: GeoRequest,
) {
	return cachedGeo(
		"choropleth",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		req,
		() => getChoroplethUncached(countryAccountsId, req),
	);
}

/** G3. Place dossier for one division. */
export async function getPlaceDossier(
	countryAccountsId: string,
	divisionId: string,
	req: GeoRequest,
	lang: string,
) {
	return cachedGeo(
		"dossier",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		{ divisionId, req, lang },
		() => getPlaceDossierUncached(countryAccountsId, divisionId, req, lang),
	);
}

/** G6. HIPs tree with record counts. */
export async function getHazardTree(
	countryAccountsId: string,
	req: GeoRequest,
	lang: string,
) {
	return cachedGeo(
		"hazardTree",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		{ req, lang },
		() => getHazardTreeUncached(countryAccountsId, req, lang),
	);
}

/** Event counts per division (shared with the analytics maps). */
export async function eventCountsByDivision(
	countryAccountsId: string,
	req: GeoRequest & { level: number },
) {
	return cachedGeo(
		"eventCounts",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		req,
		() => eventCountsByDivisionUncached(countryAccountsId, req),
	);
}

/**
 * G3 for the whole tenant (Alex, 2026-10-18: "Place" summarises the country
 * by default). Same shape as the place dossier. Every record in scope counts
 * once, including records with no area recorded, so the country figure is
 * never the sum of its areas. Hazard, date, basis and grade filters apply;
 * the place filters (division, region) do not, as this is the whole country.
 */
async function getCountryDossierUncached(
	countryAccountsId: string,
	req: GeoRequest,
	lang: string,
) {
	const t = countryAccountsId;
	const ranged = hasRange(req);
	const floor = req.query.minAttGrade;
	const meta = await baseMeta(t, req);
	const nameRes = await geoRead(sql`
		SELECT co.name FROM public.country_accounts ca
		JOIN public.countries co ON co.id = ca.country_id
		WHERE ca.id = ${t}
	`);
	const countryName =
		(nameRes.rows[0] as { name: string } | undefined)?.name ?? null;

	const res = await geoRead(sql`
		WITH scope AS (
			SELECT DISTINCT ON (a.measure, a.disaster_record_id)
				a.measure, a.disaster_record_id, a.value, a.value_state, a.att_grade,
				a.geo_precision, a.plausibility_flags, a.record_status,
				a.migration_run_id, a.start_instant, a.hip_type_id
			FROM geo.impact_atom a
			WHERE ${scopeFilters(t, req)}
				AND a.measure IN (${sql.join(
					["records", ...DOSSIER_MEASURES].map((m) => sql`${m}`),
					sql`, `,
				)})
				AND ${ranged ? dateInRange(req) : sql`true`}
				AND ${floor ? sql`(a.att_grade IS NULL OR a.att_grade <= ${floor})` : sql`true`}
			ORDER BY a.measure, a.disaster_record_id, a.att_grade NULLS LAST
		),
		recs AS (SELECT * FROM scope WHERE measure = 'records'),
		agg AS (
			SELECT p.measure, ${t}::text AS division_id,
				SUM(p.value) FILTER (WHERE p.value_state = 'reported') AS sum_reported,
				COUNT(*) FILTER (WHERE p.value_state = 'reported') AS reported,
				COUNT(*) FILTER (WHERE p.value_state = 'zero_confirmed') AS zero_confirmed,
				COUNT(*) FILTER (WHERE p.value_state = 'not_applicable') AS not_applicable,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE cardinality(p.plausibility_flags) > 0) AS flagged,
				COUNT(*) FILTER (WHERE p.att_grade = 'A') AS grade_a,
				COUNT(*) FILTER (WHERE p.att_grade = 'B') AS grade_b,
				COUNT(*) FILTER (WHERE p.att_grade = 'C') AS grade_c,
				COUNT(*) FILTER (WHERE p.att_grade = 'D') AS grade_d,
				NULL::jsonb AS precision
			FROM scope p WHERE p.measure <> 'records'
			GROUP BY p.measure
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg) AS cells,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('year', y, 'recordCount', n) ORDER BY y), '[]'::jsonb)
				FROM (SELECT extract(year FROM start_instant)::int AS y, COUNT(*) AS n
					FROM recs WHERE start_instant IS NOT NULL GROUP BY 1) t) AS by_year,
			(SELECT COUNT(*) FROM recs WHERE start_instant IS NULL) AS undated,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('hipTypeId', hip_type_id, 'recordCount', n) ORDER BY n DESC, hip_type_id), '[]'::jsonb)
				FROM (SELECT hip_type_id, COUNT(*) AS n FROM recs GROUP BY hip_type_id) t) AS hazard_mix,
			(SELECT COUNT(*) FROM recs) AS record_count,
			(SELECT COALESCE(jsonb_object_agg(COALESCE(att_grade, 'none'), n), '{}'::jsonb)
				FROM (SELECT att_grade, COUNT(*) AS n FROM recs GROUP BY att_grade) g) AS grades,
			(SELECT COALESCE(jsonb_agg(DISTINCT migration_run_id), '[]'::jsonb)
				FROM scope WHERE migration_run_id IS NOT NULL) AS run_ids,
			(SELECT COALESCE(bool_or(record_status <> 'published'), false) FROM scope) AS provisional
	`);
	const row = res.rows[0] as {
		cells: CellRow[];
		by_year: { year: number; recordCount: number }[];
		undated: string | number;
		hazard_mix: { hipTypeId: string | null; recordCount: number }[];
		record_count: string | number;
		grades: Record<string, number | string>;
		run_ids: string[];
		provisional: boolean;
	};

	const years = row.by_year.map((b) => b.year);
	const periodsWithNoReporting: string[] = [];
	if (years.length > 1) {
		const present = new Set(years);
		let gapStart: number | null = null;
		for (let y = years[0]; y <= years[years.length - 1]; y++) {
			if (!present.has(y)) {
				if (gapStart === null) gapStart = y;
			} else if (gapStart !== null) {
				periodsWithNoReporting.push(
					gapStart === y - 1 ? `${gapStart}` : `${gapStart}-${y - 1}`,
				);
				gapStart = null;
			}
		}
	}
	const byMeasure = new Map(row.cells.map((c) => [c.measure, toCell(c)]));
	const cumulative: Record<string, Omit<GeoCell, "division_id">> = {};
	for (const measure of DOSSIER_MEASURES) {
		const cell = byMeasure.get(measure);
		if (cell) {
			const { division_id: _ignored, ...rest } = cell;
			cumulative[measure] = rest;
		} else {
			cumulative[measure] = {
				value: null,
				value_state: "not_reported",
				records_reported: 0,
				records_zero_confirmed: 0,
				records_not_reported: 0,
				records_not_applicable: 0,
				records_total: 0,
				coverage: 0,
				plausibility_flagged_records: 0,
				gradeDistribution: { A: 0, B: 0, C: 0, D: 0 },
				geo_precision: {},
			};
		}
	}
	meta.migrationRunIds = row.run_ids.slice().sort();
	meta.provisional = row.provisional && basisIncludesProvisional(req.audience);
	const grades = Object.fromEntries(
		ATT_GRADES.map((g) => [g, Number(row.grades[g] ?? 0)]),
	) as Record<AttGrade, number>;
	void lang;
	return {
		meta,
		division: {
			id: "country",
			name: countryName,
			nationalId: null,
			level: 0,
			parent: null,
		},
		recurrence: {
			recordCount: Number(row.record_count),
			hazardTypeCount: row.hazard_mix.filter((h) => h.hipTypeId).length,
			firstYear: years[0] ?? null,
			lastYear: years[years.length - 1] ?? null,
			undatedRecordCount: Number(row.undated),
			periodsWithNoReporting,
			gradeDistribution: grades,
			note: "The whole country: every record counts once, including records with no area recorded, so it is not the sum of its areas. Periods with nothing reported are shown as no reporting, never as zero.",
		},
		hazardMix: row.hazard_mix,
		byYear: row.by_year,
		cumulative,
		events: await eventsInArea(countryAccountsId, req, null),
		rates: await nationalRates(countryAccountsId, req, cumulative),
	};
}

/** G3 for the whole tenant, cached until the next refresh. */
export async function getCountryDossier(
	countryAccountsId: string,
	req: GeoRequest,
	lang: string,
) {
	return cachedGeo(
		"countryDossier",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		{ req, lang },
		() => getCountryDossierUncached(countryAccountsId, req, lang),
	);
}

/** Level-1 and level-2 areas for the place pickers (no geometry), names localised. */
export async function listPlaceOptions(
	countryAccountsId: string,
	lang: string,
): Promise<
	{ id: string; name: string; level: number; parentId: string | null }[]
> {
	const res = await geoRead(sql`
		SELECT division_id, admin_level, parent_id,
			COALESCE(name ->> ${lang}, name ->> 'en', '') AS name
		FROM geo.division_geom_cache
		WHERE country_accounts_id = ${countryAccountsId} AND admin_level IN (1, 2)
		ORDER BY admin_level, 4
	`);
	return (
		res.rows as {
			division_id: string;
			admin_level: number;
			parent_id: string | null;
			name: string;
		}[]
	).map((r) => ({
		id: r.division_id,
		name: r.name,
		level: Number(r.admin_level),
		parentId: r.parent_id,
	}));
}

/** G1, cached until the tenant's next refresh (I-6: 76 ms per page view on Mozambique). */
export async function getBoundaries(
	countryAccountsId: string,
	params: Parameters<typeof getBoundariesUncached>[1],
) {
	return cachedGeo(
		"boundaries",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		params,
		() => getBoundariesUncached(countryAccountsId, params),
	);
}
