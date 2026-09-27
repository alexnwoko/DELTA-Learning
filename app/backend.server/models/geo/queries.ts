import { sql, type SQL } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	GEO_HUMAN_MEASURES,
	GEO_METHOD_VERSION,
	isGeoMeasure,
	isGeoMonetaryMeasure,
	type GeoMeasure,
} from "~/utils/geoMeasures";
import {
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	type ValueState,
} from "~/utils/valueState";

// Geoportal read side (build spec s5). Every query reads the geo schema only
// and is scoped to one tenant. Figures are {value, valueState} with counts;
// records that cannot be placed are counted in the unattributed block, never
// dropped and never redistributed.

/** Approval basis for every geoportal figure (pack decision 19, D-04). */
export const GEO_APPROVAL_BASIS = ["published"] as const;

export const ATT_GRADES = ["A", "B", "C", "D"] as const;
export type AttGrade = (typeof ATT_GRADES)[number];

export type GeoRefusalCode =
	| "CROSS_VERSION_AGGREGATION_REFUSED"
	| "INTENSIVE_QUANTITY_NOT_SUMMABLE"
	| "PRECISION_BELOW_CEILING"
	| "MONETARY_CONVENTIONS_PENDING"
	| "ATT_D_EXCLUDED_FROM_OFFICIAL"
	| "GRAIN_CARDINALITY_EXCEEDED"
	| "MULTI_SERIES_CHOROPLETH"
	| "MALFORMED_REQUEST";

export interface GeoQuery {
	measure?: string;
	level?: number;
	from?: string | null;
	to?: string | null;
	hipTypeId?: string | null;
	hipClusterId?: string | null;
	hipHazardId?: string | null;
	minAttGrade?: AttGrade;
	mode?: "as-recorded";
}

export interface GeoMeta {
	query: GeoQuery & { schema: "delta.query/1" };
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
	meta: GeoMeta;
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
		/** 200 for a semantic refusal, 422 for a programming violation, 400 malformed. */
		public readonly status: 200 | 400 | 422 = 200,
	) {
		super(message);
	}
}

export function refusalBody(err: GeoRefusalError, meta: GeoMeta): GeoRefusal {
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

export async function readModelRefreshedAt(
	countryAccountsId: string,
): Promise<string | null> {
	const res = await dr.execute(sql`
		SELECT refreshed_at FROM geo.refresh_log WHERE country_accounts_id = ${countryAccountsId}
	`);
	const row = res.rows[0] as { refreshed_at: Date | string } | undefined;
	return row ? new Date(row.refreshed_at).toISOString() : null;
}

export async function baseMeta(
	countryAccountsId: string,
	query: GeoQuery,
): Promise<GeoMeta> {
	return {
		query: { schema: "delta.query/1", mode: "as-recorded", ...query },
		boundaryVersion: "unknown",
		hazardVocabularyVersion: "HIPs 2025",
		methodVersion: GEO_METHOD_VERSION,
		migrationRunIds: [],
		approvalBasis: GEO_APPROVAL_BASIS,
		provisional: false,
		notApplied: [],
		readModelRefreshedAt: await readModelRefreshedAt(countryAccountsId),
	};
}

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** Parses choropleth and dossier parameters; throws a refusal when invalid. */
export function parseGeoQuery(
	params: URLSearchParams,
	opts: { requireMeasure: boolean; requireLevel: boolean },
): GeoQuery {
	const q: GeoQuery = { mode: "as-recorded" };

	const measureParam = params.get("measure");
	if (opts.requireMeasure || measureParam) {
		if (!measureParam) {
			throw malformed("measure is required.");
		}
		if (measureParam.includes(",")) {
			throw new GeoRefusalError(
				"MULTI_SERIES_CHOROPLETH",
				"A choropleth shows one measure. Several were requested.",
				"VIS-Q08",
				"Request one measure per map, or use the table view to compare measures.",
			);
		}
		if (isGeoMonetaryMeasure(measureParam)) {
			throw new GeoRefusalError(
				"MONETARY_CONVENTIONS_PENDING",
				"Monetary figures are not totalled until the Sendai Framework Monitor conventions are confirmed.",
				"Pack decision 16 (D-17); VIS-L06",
				"Show human effects or record counts, or wait for the currency and deflator ruling.",
			);
		}
		if (!isGeoMeasure(measureParam)) {
			throw malformed(`Unknown measure "${measureParam}".`);
		}
		q.measure = measureParam;
	}

	const levelParam = params.get("level");
	if (opts.requireLevel || levelParam) {
		const level = Number(levelParam);
		if (!levelParam || !Number.isInteger(level) || level < 0) {
			throw malformed("level must be a non-negative integer.");
		}
		q.level = level;
	}

	for (const key of ["from", "to"] as const) {
		const v = params.get(key);
		if (v) {
			if (!DATE_RE.test(v)) {
				throw malformed(`${key} must be YYYY, YYYY-MM or YYYY-MM-DD.`);
			}
			q[key] = v;
		}
	}

	q.hipTypeId = params.get("hipTypeId") || null;
	q.hipClusterId = params.get("hipClusterId") || null;
	q.hipHazardId = params.get("hipHazardId") || null;

	const grade = (params.get("minAttGrade") || "C").toUpperCase();
	if (!(ATT_GRADES as readonly string[]).includes(grade)) {
		throw malformed("minAttGrade must be A, B, C or D.");
	}
	if (grade === "D") {
		throw new GeoRefusalError(
			"ATT_D_EXCLUDED_FROM_OFFICIAL",
			"Figures attributed by downward split (ATT-D) are excluded from geoportal figures.",
			"VIS-Q05; pack decision 13",
			"Use minAttGrade A, B or C.",
		);
	}
	q.minAttGrade = grade as AttGrade;

	const mode = params.get("mode");
	if (mode && mode !== "as-recorded") {
		throw new GeoRefusalError(
			"CROSS_VERSION_AGGREGATION_REFUSED",
			"Only the as-recorded mode is available. No boundary version model exists yet.",
			"VIS-T04, VIS-T09; DEC-005",
			"Use mode=as-recorded.",
		);
	}
	return q;
}

function malformed(message: string): GeoRefusalError {
	return new GeoRefusalError(
		"MALFORMED_REQUEST",
		message,
		"API spec s11",
		"Correct the request parameters.",
		400,
	);
}

/** Filters shared by every figure: tenant, approval basis, hazard and grade. */
function scopeFilters(countryAccountsId: string, q: GeoQuery): SQL {
	const parts: SQL[] = [
		sql`a.country_accounts_id = ${countryAccountsId}`,
		sql`a.record_status IN (${sql.join(
			GEO_APPROVAL_BASIS.map((s) => sql`${s}`),
			sql`, `,
		)})`,
	];
	if (q.hipTypeId) parts.push(sql`a.hip_type_id = ${q.hipTypeId}`);
	if (q.hipClusterId) parts.push(sql`a.hip_cluster_id = ${q.hipClusterId}`);
	if (q.hipHazardId) parts.push(sql`a.hip_hazard_id = ${q.hipHazardId}`);
	return sql.join(parts, sql` AND `);
}

/**
 * Date overlap test, applied after scoping so undated records can be reported
 * as unattributed ("undated") when a range is set, not silently dropped.
 */
function dateInRange(q: GeoQuery): SQL {
	const parts: SQL[] = [];
	if (q.from) parts.push(sql`a.end_instant >= geo.date_floor(${q.from})`);
	if (q.to) parts.push(sql`a.start_instant <= geo.date_ceil(${q.to})`);
	return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}

export interface GeoCell {
	divisionId: string;
	value: number | null;
	valueState: ValueState;
	recordsReported: number;
	recordsZeroConfirmed: number;
	recordsNotReported: number;
	recordsTotal: number;
	/** Share of records in the cell that reported the measure, zero included. */
	coverage: number;
	plausibilityFlaggedRecords: number;
	gradeDistribution: Record<AttGrade, number>;
	geoPrecision: Record<string, number>;
}

export interface GeoUnattributed {
	records: number;
	reasons: Record<string, number>;
}

interface PlacedAggregateRow {
	division_id: string;
	sum_reported: string | null;
	reported: string;
	zero_confirmed: string;
	total: string;
	flagged: string;
	grade_a: string;
	grade_b: string;
	grade_c: string;
	grade_d: string;
	precision: Record<string, number> | null;
}

/**
 * Places each in-scope atom at `level` through its division's ancestor, one
 * record once per target division. Returns the aggregate per division, the
 * unattributed block and the run ids, for one measure.
 */
async function aggregateAtLevel(
	countryAccountsId: string,
	q: GeoQuery & { measure: GeoMeasure; level: number },
	restrictToDivision?: string,
) {
	const minGrade = q.minAttGrade ?? "C";
	const hasRange = Boolean(q.from || q.to);
	const restrict = restrictToDivision
		? sql`AND p.division_id = ${restrictToDivision}`
		: sql``;

	const res = await dr.execute(sql`
		WITH scope AS (
			SELECT a.* FROM geo.impact_atom a
			WHERE ${scopeFilters(countryAccountsId, q)} AND a.measure = ${q.measure}
		),
		ranged AS (
			SELECT * FROM scope a
			WHERE ${hasRange ? sql`a.start_instant IS NOT NULL AND ${dateInRange(q)}` : sql`true`}
		),
		graded AS (
			SELECT * FROM ranged a WHERE a.att_grade IS NULL OR a.att_grade <= ${minGrade}
		),
		placed AS (
			SELECT DISTINCT ON (da.ancestor_id, g.disaster_record_id)
				da.ancestor_id AS division_id, g.disaster_record_id, g.value, g.value_state,
				g.att_grade, g.geo_precision, g.plausibility_flags
			FROM graded g
			JOIN geo.division_ancestor da
				ON da.division_id = g.division_id
				AND da.country_accounts_id = ${countryAccountsId}
				AND da.ancestor_level = ${q.level}
			ORDER BY da.ancestor_id, g.disaster_record_id, g.att_grade
		),
		agg AS (
			SELECT p.division_id,
				SUM(p.value) FILTER (WHERE p.value_state = 'reported') AS sum_reported,
				COUNT(*) FILTER (WHERE p.value_state = 'reported') AS reported,
				COUNT(*) FILTER (WHERE p.value_state = 'zero_confirmed') AS zero_confirmed,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE cardinality(p.plausibility_flags) > 0) AS flagged,
				COUNT(*) FILTER (WHERE p.att_grade = 'A') AS grade_a,
				COUNT(*) FILTER (WHERE p.att_grade = 'B') AS grade_b,
				COUNT(*) FILTER (WHERE p.att_grade = 'C') AS grade_c,
				COUNT(*) FILTER (WHERE p.att_grade = 'D') AS grade_d,
				(SELECT jsonb_object_agg(gp, n) FROM (
					SELECT p2.geo_precision AS gp, COUNT(*) AS n FROM placed p2
					WHERE p2.division_id = p.division_id AND p2.geo_precision IS NOT NULL
					GROUP BY p2.geo_precision) x) AS precision
			FROM placed p
			WHERE true ${restrict}
			GROUP BY p.division_id
		),
		unplaced AS (
			SELECT DISTINCT ON (s.disaster_record_id) s.disaster_record_id,
				CASE
					WHEN ${hasRange} AND s.start_instant IS NULL THEN 'undated'
					WHEN s.unattributed_reason IS NOT NULL THEN s.unattributed_reason
					ELSE 'coarser_than_level'
				END AS reason
			FROM scope s
			WHERE (${hasRange} AND s.start_instant IS NULL)
				OR (s.disaster_record_id IN (SELECT disaster_record_id FROM ranged)
					AND s.disaster_record_id IN (SELECT disaster_record_id FROM graded)
					AND s.disaster_record_id NOT IN (SELECT disaster_record_id FROM placed))
			ORDER BY s.disaster_record_id, s.unattributed_reason NULLS LAST
		),
		runs AS (
			SELECT DISTINCT a.migration_run_id FROM graded a WHERE a.migration_run_id IS NOT NULL
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(to_jsonb(agg)), '[]'::jsonb) FROM agg) AS cells,
			(SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
				FROM (SELECT reason, COUNT(*) AS n FROM unplaced GROUP BY reason) u) AS reasons,
			(SELECT COUNT(*) FROM unplaced) AS unattributed,
			(SELECT COALESCE(jsonb_agg(migration_run_id), '[]'::jsonb) FROM runs) AS run_ids,
			(SELECT COUNT(DISTINCT disaster_record_id) FROM ranged a WHERE NOT (a.att_grade IS NULL OR a.att_grade <= ${minGrade})) AS excluded_by_grade,
			(SELECT COUNT(*) FROM (SELECT disaster_record_id FROM placed GROUP BY disaster_record_id HAVING COUNT(*) > 1) m) AS multi_division,
			(SELECT bool_or(provisional) FROM graded) AS provisional
	`);

	const row = res.rows[0] as {
		cells: PlacedAggregateRow[];
		reasons: Record<string, number | string>;
		unattributed: string | number;
		run_ids: string[];
		excluded_by_grade: string | number;
		multi_division: string | number;
		provisional: boolean | null;
	};

	const cells: GeoCell[] = row.cells.map((c) => {
		const mv = measureValue(
			{
				sum: c.sum_reported,
				reported: c.reported,
				zeroConfirmed: c.zero_confirmed,
				total: c.total,
				flagged: c.flagged,
			},
			PROVISIONAL_ZERO_COVERAGE,
		);
		return {
			divisionId: c.division_id,
			value: mv.value,
			valueState: mv.valueState,
			recordsReported: mv.recordsReported,
			recordsZeroConfirmed: mv.recordsZeroConfirmed,
			recordsNotReported: mv.recordsNotReported,
			recordsTotal: mv.recordsTotal,
			coverage:
				mv.recordsTotal > 0
					? (mv.recordsReported + mv.recordsZeroConfirmed) / mv.recordsTotal
					: 0,
			plausibilityFlaggedRecords: mv.recordsFlagged,
			gradeDistribution: {
				A: Number(c.grade_a),
				B: Number(c.grade_b),
				C: Number(c.grade_c),
				D: Number(c.grade_d),
			},
			geoPrecision: Object.fromEntries(
				Object.entries(c.precision ?? {}).map(([k, v]) => [k, Number(v)]),
			),
		};
	});
	cells.sort((a, b) => a.divisionId.localeCompare(b.divisionId));

	return {
		cells,
		unattributed: {
			records: Number(row.unattributed),
			reasons: Object.fromEntries(
				Object.entries(row.reasons).map(([k, v]) => [k, Number(v)]),
			),
		} as GeoUnattributed,
		runIds: row.run_ids.slice().sort(),
		excludedByGrade: Number(row.excluded_by_grade),
		multiDivisionRecords: Number(row.multi_division),
		provisional: Boolean(row.provisional),
	};
}

async function tenantMaxLevel(countryAccountsId: string): Promise<number | null> {
	const res = await dr.execute(sql`
		SELECT max(admin_level) AS max_level FROM geo.division_geom_cache
		WHERE country_accounts_id = ${countryAccountsId}
	`);
	const v = (res.rows[0] as { max_level: number | null } | undefined)?.max_level;
	return v === null || v === undefined ? null : Number(v);
}

/** G2. One measure aggregated by division at one admin level. */
export async function getChoropleth(countryAccountsId: string, q: GeoQuery) {
	const measure = q.measure as GeoMeasure;
	const level = q.level as number;
	const meta = await baseMeta(countryAccountsId, q);

	const maxLevel = await tenantMaxLevel(countryAccountsId);
	if (maxLevel !== null && level > maxLevel) {
		throw new GeoRefusalError(
			"PRECISION_BELOW_CEILING",
			`Level ${level} is finer than the finest admin level this instance holds (${maxLevel}).`,
			"Pack C28, C16",
			`Request level ${maxLevel} or coarser.`,
		);
	}

	const agg = await aggregateAtLevel(countryAccountsId, {
		...q,
		measure,
		level,
	});
	meta.migrationRunIds = agg.runIds;
	meta.provisional = agg.provisional;

	const captions = [
		measure === "records"
			? "Counts of disaster records."
			: "Human effects from record totals. Records that did not report the measure are counted, not treated as zero.",
		"Reporting completeness is not modelled.",
	];
	if (agg.multiDivisionRecords > 0) {
		captions.push(
			`${agg.multiDivisionRecords} records are linked to more than one area and count in each, so area values do not add up to a total.`,
		);
	}

	return {
		meta,
		entity: "record",
		measure,
		quantityType: "extensive" as const,
		level,
		cells: agg.cells,
		unattributed: agg.unattributed,
		excludedByGrade: agg.excludedByGrade,
		multiDivisionRecords: agg.multiDivisionRecords,
		caption: captions.join(" "),
	};
}

/** Tier column for a zoom level. */
export function geomColumnForZoom(z: number): "geom_z4" | "geom_z8" | "geom_z12" {
	if (z <= 5) return "geom_z4";
	if (z <= 9) return "geom_z8";
	return "geom_z12";
}

/** G1. Simplified division geometry as GeoJSON for one level. */
export async function getBoundaries(
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
	const res = await dr.execute(sql`
		SELECT jsonb_build_object(
			'type', 'FeatureCollection',
			'boundaryVersion', 'unknown',
			'features', COALESCE(jsonb_agg(jsonb_build_object(
				'type', 'Feature',
				'id', c.division_id,
				'geometry', ST_AsGeoJSON(c.${column}, 6)::jsonb,
				'properties', jsonb_build_object(
					'divisionId', c.division_id,
					'nationalId', c.national_id,
					'importId', c.import_id,
					'name', COALESCE(c.name ->> ${params.lang}, c.name ->> 'en', ''),
					'level', c.admin_level,
					'parentId', c.parent_id,
					'boundaryVintage', c.boundary_vintage
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
	const res = await dr.execute(sql`
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
export async function getPlaceDossier(
	countryAccountsId: string,
	divisionId: string,
	q: GeoQuery,
	lang: string,
) {
	const divRes = await dr.execute(sql`
		SELECT c.division_id, c.admin_level, c.national_id, c.name,
			p.division_id AS parent_id, p.name AS parent_name
		FROM geo.division_geom_cache c
		LEFT JOIN geo.division_geom_cache p
			ON p.division_id = c.parent_id AND p.country_accounts_id = c.country_accounts_id
		WHERE c.division_id = ${divisionId} AND c.country_accounts_id = ${countryAccountsId}
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
	const meta = await baseMeta(countryAccountsId, q);
	const level = Number(div.admin_level);
	const localName = (n: Record<string, string> | null) =>
		n ? (n[lang] ?? n.en ?? "") : null;

	const recordsQ = { ...q, measure: "records" as const, level };
	const yearsRes = await dr.execute(sql`
		WITH placed AS (
			SELECT DISTINCT a.disaster_record_id, a.start_instant, a.hip_type_id
			FROM geo.impact_atom a
			JOIN geo.division_ancestor da
				ON da.division_id = a.division_id
				AND da.country_accounts_id = ${countryAccountsId}
				AND da.ancestor_id = ${divisionId}
			WHERE ${scopeFilters(countryAccountsId, recordsQ)}
				AND a.measure = 'records'
				AND ${dateInRange(recordsQ)}
				AND (a.att_grade IS NULL OR a.att_grade <= ${recordsQ.minAttGrade ?? "C"})
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('year', y, 'recordCount', n) ORDER BY y), '[]'::jsonb)
				FROM (SELECT extract(year FROM start_instant)::int AS y, COUNT(*) AS n
					FROM placed WHERE start_instant IS NOT NULL GROUP BY 1) t) AS by_year,
			(SELECT COUNT(*) FROM placed WHERE start_instant IS NULL) AS undated,
			(SELECT COALESCE(jsonb_agg(jsonb_build_object('hipTypeId', hip_type_id, 'recordCount', n) ORDER BY n DESC, hip_type_id), '[]'::jsonb)
				FROM (SELECT hip_type_id, COUNT(*) AS n FROM placed GROUP BY hip_type_id) t) AS hazard_mix,
			(SELECT COUNT(*) FROM placed) AS record_count
	`);
	const yr = yearsRes.rows[0] as {
		by_year: { year: number; recordCount: number }[];
		undated: string | number;
		hazard_mix: { hipTypeId: string | null; recordCount: number }[];
		record_count: string | number;
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

	const cumulative: Record<string, Omit<GeoCell, "divisionId">> = {};
	const runIds = new Set<string>();
	let provisional = false;
	for (const measure of GEO_HUMAN_MEASURES) {
		const agg = await aggregateAtLevel(
			countryAccountsId,
			{ ...q, measure, level },
			divisionId,
		);
		agg.runIds.forEach((r) => runIds.add(r));
		provisional ||= agg.provisional;
		const cell = agg.cells[0];
		if (cell) {
			const { divisionId: _ignored, ...rest } = cell;
			cumulative[measure] = rest;
		} else {
			cumulative[measure] = {
				value: null,
				valueState: "not_reported",
				recordsReported: 0,
				recordsZeroConfirmed: 0,
				recordsNotReported: 0,
				recordsTotal: 0,
				coverage: 0,
				plausibilityFlaggedRecords: 0,
				gradeDistribution: { A: 0, B: 0, C: 0, D: 0 },
				geoPrecision: {},
			};
		}
	}
	meta.migrationRunIds = [...runIds].sort();
	meta.provisional = provisional;

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
			note: "Periods with no records are shown as no reporting, never as zero. Completeness is not modelled.",
		},
		hazardMix: yr.hazard_mix,
		byYear: yr.by_year,
		cumulative,
	};
}

/**
 * G6. HIPs tree with self and subtree record counts for the tenant (VIS-H03,
 * VIS-H04). A chapeau code (ending "00", for example MH0600) counts itself
 * as "self", and every hazard sharing its four-character prefix as "subtree",
 * so records coded at the chapeau never vanish from the tree.
 */
export async function getHazardTree(countryAccountsId: string, lang: string) {
	const basis = sql.join(
		GEO_APPROVAL_BASIS.map((s) => sql`${s}`),
		sql`, `,
	);
	const res = await dr.execute(sql`
		WITH recs AS (
			SELECT DISTINCT a.disaster_record_id, a.hip_type_id, a.hip_cluster_id, a.hip_hazard_id
			FROM geo.impact_atom a
			WHERE a.country_accounts_id = ${countryAccountsId}
				AND a.measure = 'records'
				AND a.record_status IN (${basis})
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
		types: { id: string; name: string; recordCountSelf: number; recordCountSubtree: number }[];
		clusters: { id: string; typeId: string; name: string; recordCountSelf: number; recordCountSubtree: number }[];
		hazards: { id: string; clusterId: string; code: string; name: string; isChapeau: boolean; recordCountSelf: number; recordCountSubtree: number }[];
		unclassified: string | number;
	};
	const types = row.types.map((t) => ({
		...t,
		clusters: row.clusters
			.filter((c) => c.typeId === t.id)
			.map((c) => ({
				...c,
				hazards: row.hazards.filter((h) => h.clusterId === c.id),
			})),
	}));
	return {
		meta: await baseMeta(countryAccountsId, {}),
		vocabularyVersion: "HIPs 2025" as const,
		unclassifiedRecordCount: Number(row.unclassified),
		types,
	};
}
