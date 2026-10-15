import { sql } from "drizzle-orm";
import { dr, type Dr } from "~/db.server";
import { GEO_HUMAN_MEASURES, GEO_METHOD_VERSION } from "~/utils/geoMeasures";
import { notRetired } from "~/utils/approvalBasis";
import { plausibilitySourceFields } from "~/utils/plausibility";

// Simplification tolerances in degrees, about half a screen pixel per tier.
export const GEO_TOLERANCE = { z4: 0.04, z8: 0.0025, z12: 0.00015 } as const;

export interface GeoRefreshResult {
	divisionCount: number;
	atomCount: number;
	refreshedAt: string;
}

/**
 * Rebuilds one tenant's geoportal read model (build spec s4) in one
 * transaction: the simplified division geometry, the division ancestry and
 * the impact atoms. Readers see either the old or the new model, never a mix.
 *
 * Attribution (ATT grade, pack decision 13):
 * - B or C: the record's division link; B when the division has a national
 *   id, C when it is matched by import id only.
 * - A: no division link, and the record geometry is covered by exactly one
 *   division at the tenant's finest level, touching no other (derivation
 *   footprint_intersect).
 * - Otherwise the record is unattributed, with the reason, and still counted.
 * Downward split (D) is never produced.
 *
 * Dates: an impossible start date makes the record undated, never aborts the
 * refresh. An unreadable end date falls back to the end of the start date's
 * period and is marked end_from_start. Retired records (DEC-012) are kept and
 * marked, so every approval basis can exclude them.
 *
 * Value state per record and measure follows the analytics rule
 * (hazard-analysis.ts humanEffectMeasuresSelect): a total above 0 is
 * reported; a total of 0 with a Yes flag, or an explicit No with no value, is
 * a confirmed zero; anything else is not reported, with a NULL value.
 */
export async function refreshGeoReadModel(
	countryAccountsId: string,
	db: Dr = dr,
): Promise<GeoRefreshResult> {
	const t = countryAccountsId;
	return db.transaction(async (tx) => {
		// One refresh per tenant at a time: a second caller waits, never fails.
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext('geo.refresh:' || ${t}))`,
		);
		await tx.execute(
			sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${t}`,
		);
		await tx.execute(
			sql`DELETE FROM geo.division_ancestor WHERE country_accounts_id = ${t}`,
		);
		await tx.execute(
			sql`DELETE FROM geo.division_geom_cache WHERE country_accounts_id = ${t}`,
		);

		await tx.execute(sql`
			INSERT INTO geo.division_geom_cache (
				division_id, country_accounts_id, admin_level, parent_id,
				national_id, import_id, name, bbox, geom_z4, geom_z8, geom_z12
			)
			SELECT
				d.id, d.country_accounts_id, d.level::int, d.parent_id,
				NULLIF(d.national_id, ''), NULLIF(d.import_id, ''), d.name,
				CASE WHEN b.g IS NULL THEN NULL
					ELSE ST_MakeEnvelope(ST_XMin(b.g), ST_YMin(b.g), ST_XMax(b.g), ST_YMax(b.g), 4326)
				END,
				geo.simplify_multi(b.g, ${GEO_TOLERANCE.z4}),
				geo.simplify_multi(b.g, ${GEO_TOLERANCE.z8}),
				geo.simplify_multi(b.g, ${GEO_TOLERANCE.z12})
			FROM public.division d
			CROSS JOIN LATERAL (
				SELECT CASE WHEN d.geom IS NULL THEN NULL
					ELSE geo.simplify_multi(d.geom, 0) END AS g
			) b
			WHERE d.country_accounts_id = ${t}
		`);

		await tx.execute(sql`
			WITH RECURSIVE anc AS (
				SELECT d.id AS division_id, d.id AS ancestor_id,
					d.level::int AS ancestor_level, d.parent_id AS next_parent, 1 AS depth
				FROM public.division d
				WHERE d.country_accounts_id = ${t}
				UNION ALL
				SELECT a.division_id, p.id, p.level::int, p.parent_id, a.depth + 1
				FROM anc a
				JOIN public.division p
					ON p.id = a.next_parent AND p.country_accounts_id = ${t}
				WHERE a.depth < 16
			)
			INSERT INTO geo.division_ancestor (division_id, ancestor_id, ancestor_level, country_accounts_id)
			SELECT DISTINCT division_id, ancestor_id, ancestor_level, ${t}::uuid FROM anc
			ON CONFLICT DO NOTHING
		`);

		const measureRows = sql.join(
			GEO_HUMAN_MEASURES.map((m) => {
				const fields = plausibilitySourceFields(m);
				const fieldArray = fields.length
					? sql`ARRAY[${sql.join(
							fields.map((f) => sql`${f}`),
							sql`, `,
						)}]::text[]`
					: sql`ARRAY[]::text[]`;
				return sql`(${m}::text, hcp.${sql.raw(`"${m}"`)}, hcp.${sql.raw(`"${m}_total"`)}::numeric, ${fieldArray})`;
			}),
			sql`, `,
		);

		await tx.execute(sql`
			WITH rec AS (
				SELECT
					r.id, r.disaster_event_id, de.hazardous_event_id,
					NULLIF(r.hip_type_id, '') AS hip_type_id,
					NULLIF(r.hip_cluster_id, '') AS hip_cluster_id,
					NULLIF(r.hip_hazard_id, '') AS hip_hazard_id,
					geo.date_floor(r.start_date) AS start_instant,
					COALESCE(
						geo.date_ceil(NULLIF(r.end_date, '')),
						geo.date_ceil(r.start_date)
					) AS end_instant,
					geo.date_ceil(NULLIF(r.end_date, '')) IS NULL
						AND geo.date_floor(r.start_date) IS NOT NULL AS end_from_start,
					NOT ${notRetired(sql`r.legacy_data`)} AS retired,
					geo.date_precision(r.start_date) AS date_precision,
					r."approvalStatus" AS record_status,
					de."approvalStatus" AS event_status,
					he."approvalStatus" AS hazard_status,
					CASE WHEN jsonb_typeof(r.legacy_data -> 'migration') = 'object'
						THEN r.legacy_data -> 'migration' END AS mig
				FROM public.disaster_records r
				LEFT JOIN public.disaster_event de
					ON de.id = r.disaster_event_id AND de.country_accounts_id = r.country_accounts_id
				LEFT JOIN public.hazardous_event he
					ON he.id = de.hazardous_event_id AND he.country_accounts_id = r.country_accounts_id
				WHERE r.country_accounts_id = ${t}
			),
			linked AS (
				SELECT DISTINCT drd.disaster_record_id AS record_id, d.id AS division_id,
					d.level::int AS admin_level,
					CASE WHEN COALESCE(d.national_id, '') <> '' THEN 'B' ELSE 'C' END AS att_grade,
					'L' || d.level::text AS geo_precision
				FROM public.disaster_records_division drd
				JOIN rec ON rec.id = drd.disaster_record_id
				JOIN public.division d
					ON d.id = drd.division_id AND d.country_accounts_id = ${t}
			),
			finest AS (
				SELECT max(level)::int AS lvl FROM public.division
				WHERE country_accounts_id = ${t} AND geom IS NOT NULL
			),
			geom_rec AS (
				SELECT rg.disaster_record_id AS record_id,
					bool_and(GeometryType(rg.geom) IN ('POINT', 'MULTIPOINT')) AS all_points
				FROM public.disaster_records_geom rg
				JOIN rec ON rec.id = rg.disaster_record_id
				WHERE NOT EXISTS (SELECT 1 FROM linked l WHERE l.record_id = rg.disaster_record_id)
				GROUP BY rg.disaster_record_id
			),
			-- ATT-A needs the record geometry covered by exactly one division at
			-- the finest level; touching one is not enough.
			geom_hits AS (
				SELECT gr.record_id, count(DISTINCT d.id) AS n,
					count(DISTINCT d.id) FILTER (WHERE ST_CoveredBy(rg.geom, d.geom)) AS n_covered,
					(array_agg(DISTINCT d.id) FILTER (WHERE ST_CoveredBy(rg.geom, d.geom)))[1] AS division_id,
					min(d.level)::int AS admin_level, bool_and(gr.all_points) AS all_points
				FROM geom_rec gr
				JOIN public.disaster_records_geom rg ON rg.disaster_record_id = gr.record_id
				JOIN finest f ON true
				JOIN public.division d
					ON d.country_accounts_id = ${t} AND d.level = f.lvl
					AND d.geom && rg.geom AND ST_Intersects(d.geom, rg.geom)
				GROUP BY gr.record_id
			),
			attrib AS (
				SELECT record_id, division_id, admin_level, att_grade, geo_precision,
					'as_recorded'::text AS derivation, NULL::text AS unattributed_reason
				FROM linked
				UNION ALL
				SELECT record_id, division_id, admin_level, 'A',
					CASE WHEN all_points THEN 'P' ELSE 'L' || admin_level::text END,
					'footprint_intersect', NULL
				FROM geom_hits WHERE n_covered = 1 AND n = 1
				UNION ALL
				SELECT rec.id, NULL::uuid, NULL::int, NULL::text, NULL::text, 'as_recorded',
					CASE
						WHEN gr.record_id IS NOT NULL AND (SELECT lvl FROM finest) IS NULL
							THEN 'no_division_geometry'
						WHEN gh.n > 1 OR (gh.n = 1 AND gh.n_covered = 0)
							THEN 'geometry_spans_divisions'
						WHEN gr.record_id IS NOT NULL THEN 'geometry_outside_divisions'
						ELSE 'no_division_row'
					END
				FROM rec
				LEFT JOIN geom_rec gr ON gr.record_id = rec.id
				LEFT JOIN geom_hits gh ON gh.record_id = rec.id
				WHERE NOT EXISTS (SELECT 1 FROM linked l WHERE l.record_id = rec.id)
					AND NOT (gh.n_covered IS NOT NULL AND gh.n_covered = 1 AND gh.n = 1)
			),
			measured AS (
				SELECT rec.id AS record_id, m.measure,
					CASE
						WHEN m.total > 0 THEN 'reported'
						WHEN (m.total = 0 AND m.flag IS TRUE)
							OR (m.flag IS FALSE AND COALESCE(m.total, 0) = 0) THEN 'zero_confirmed'
						ELSE 'not_reported'
					END AS value_state,
					CASE
						WHEN m.total > 0 THEN m.total
						WHEN (m.total = 0 AND m.flag IS TRUE)
							OR (m.flag IS FALSE AND COALESCE(m.total, 0) = 0) THEN 0
					END AS value,
					ARRAY(
						SELECT DISTINCT pf ->> 'code'
						FROM jsonb_array_elements(
							CASE WHEN jsonb_typeof(rec.mig -> 'plausibility_flags') = 'array'
								THEN rec.mig -> 'plausibility_flags' ELSE '[]'::jsonb END
						) AS pf
						WHERE jsonb_typeof(pf -> 'fields') = 'array'
							AND pf -> 'fields' ?| m.fields
							AND pf ->> 'code' IS NOT NULL
					) AS plausibility_flags
				FROM rec
				-- One presence row per record, chosen stably, so a duplicate row can
				-- never produce two atoms for one measure.
				LEFT JOIN LATERAL (
					SELECT h.* FROM public.human_category_presence h
					WHERE h.record_id = rec.id
					ORDER BY h.id
					LIMIT 1
				) hcp ON true
				CROSS JOIN LATERAL (VALUES ${measureRows}) AS m(measure, flag, total, fields)
				UNION ALL
				SELECT rec.id, 'records', 'reported', 1::numeric, ARRAY[]::text[]
				FROM rec
			)
			INSERT INTO geo.impact_atom (
				country_accounts_id, disaster_record_id, disaster_event_id, hazardous_event_id,
				division_id, admin_level, unattributed_reason, att_grade, geo_precision, derivation,
				measure, quantity_type, value, value_state,
				hip_type_id, hip_cluster_id, hip_hazard_id,
				start_instant, end_instant, end_from_start, date_precision,
				record_status, event_status, hazard_status,
				provisional, retired, migration_run_id, plausibility_flags, method_version
			)
			SELECT
				${t}::uuid, rec.id, rec.disaster_event_id, rec.hazardous_event_id,
				a.division_id, a.admin_level, a.unattributed_reason, a.att_grade, a.geo_precision, a.derivation,
				ms.measure, 'extensive', ms.value, ms.value_state,
				rec.hip_type_id, rec.hip_cluster_id, rec.hip_hazard_id,
				rec.start_instant, rec.end_instant, rec.end_from_start, rec.date_precision,
				rec.record_status, rec.event_status, rec.hazard_status,
				rec.mig IS NOT NULL AND rec.record_status <> 'published',
				rec.retired, rec.mig ->> 'run_id', ms.plausibility_flags, ${GEO_METHOD_VERSION}
			FROM rec
			JOIN attrib a ON a.record_id = rec.id
			JOIN measured ms ON ms.record_id = rec.id
		`);

		const counts = await tx.execute(sql`
			SELECT
				(SELECT count(*) FROM geo.division_geom_cache WHERE country_accounts_id = ${t})::int AS division_count,
				(SELECT count(*) FROM geo.impact_atom WHERE country_accounts_id = ${t})::int AS atom_count,
				now() AS refreshed_at
		`);
		const row = counts.rows[0] as {
			division_count: number;
			atom_count: number;
			refreshed_at: Date | string;
		};
		await tx.execute(sql`
			INSERT INTO geo.refresh_log (country_accounts_id, refreshed_at, method_version, division_count, atom_count)
			VALUES (${t}, ${row.refreshed_at}, ${GEO_METHOD_VERSION}, ${row.division_count}, ${row.atom_count})
			ON CONFLICT (country_accounts_id) DO UPDATE SET
				refreshed_at = EXCLUDED.refreshed_at,
				method_version = EXCLUDED.method_version,
				division_count = EXCLUDED.division_count,
				atom_count = EXCLUDED.atom_count
		`);
		return {
			divisionCount: Number(row.division_count),
			atomCount: Number(row.atom_count),
			refreshedAt: new Date(row.refreshed_at).toISOString(),
		};
	});
}
