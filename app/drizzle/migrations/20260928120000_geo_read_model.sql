-- Geoportal read model (build spec s4, D-15). The geoportal reads only these
-- derived tables, never the transactional tables at request time. They are
-- rebuilt per tenant by app/backend.server/models/geo/refresh.ts.
-- Indexes are written by hand; tests/integration-realdb/geo/geoReadModel.test.ts
-- asserts each one exists.
CREATE SCHEMA IF NOT EXISTS geo;
--> statement-breakpoint

-- Date text in DELTA is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. The floor is the
-- first day of the stated period and the ceiling its last day, so '2015' ends
-- on 2015-12-31, not 2015-01-01. Anything else is NULL (undated).
CREATE OR REPLACE FUNCTION geo.date_floor(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT CASE
		WHEN t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN to_date(t, 'YYYY-MM-DD')
		WHEN t ~ '^[0-9]{4}-[0-9]{2}$' THEN to_date(t, 'YYYY-MM')
		WHEN t ~ '^[0-9]{4}$' THEN to_date(t, 'YYYY')
		ELSE NULL
	END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION geo.date_ceil(t text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT CASE
		WHEN t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN to_date(t, 'YYYY-MM-DD')
		WHEN t ~ '^[0-9]{4}-[0-9]{2}$' THEN (to_date(t, 'YYYY-MM') + interval '1 month' - interval '1 day')::date
		WHEN t ~ '^[0-9]{4}$' THEN (to_date(t, 'YYYY') + interval '1 year' - interval '1 day')::date
		ELSE NULL
	END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION geo.date_precision(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT CASE
		WHEN t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN 'day'
		WHEN t ~ '^[0-9]{4}-[0-9]{2}$' THEN 'month'
		WHEN t ~ '^[0-9]{4}$' THEN 'year'
		ELSE 'none'
	END
$$;
--> statement-breakpoint

-- Polygonal part of a geometry, made valid and simplified; NULL when empty.
CREATE OR REPLACE FUNCTION geo.simplify_multi(g geometry, tol double precision) RETURNS geometry
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
	SELECT CASE WHEN x IS NULL OR ST_IsEmpty(x) THEN NULL ELSE ST_SetSRID(x, 4326) END
	FROM (
		SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
			CASE WHEN tol > 0 THEN ST_SimplifyPreserveTopology(g, tol) ELSE g END
		), 3)) AS x
	) s
$$;
--> statement-breakpoint

-- Division geometry simplified per zoom tier. Tolerances in degrees are about
-- half a screen pixel at z4, z8 and z12 (0.04, 0.0025, 0.00015).
CREATE TABLE IF NOT EXISTS geo.division_geom_cache (
	division_id uuid PRIMARY KEY REFERENCES public.division(id) ON DELETE CASCADE,
	country_accounts_id uuid NOT NULL,
	admin_level integer NOT NULL,
	parent_id uuid,
	national_id text,
	import_id text,
	name jsonb NOT NULL DEFAULT '{}'::jsonb,
	boundary_vintage text NOT NULL DEFAULT 'unknown',
	bbox geometry(Polygon, 4326),
	geom_z4 geometry(MultiPolygon, 4326),
	geom_z8 geometry(MultiPolygon, 4326),
	geom_z12 geometry(MultiPolygon, 4326),
	refreshed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_dgc_tenant_level_idx ON geo.division_geom_cache (country_accounts_id, admin_level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_dgc_bbox_idx ON geo.division_geom_cache USING GIST (bbox);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_dgc_z4_idx ON geo.division_geom_cache USING GIST (geom_z4);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_dgc_z8_idx ON geo.division_geom_cache USING GIST (geom_z8);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_dgc_z12_idx ON geo.division_geom_cache USING GIST (geom_z12);
--> statement-breakpoint

-- Every division with every ancestor, itself included, within one tenant.
CREATE TABLE IF NOT EXISTS geo.division_ancestor (
	division_id uuid NOT NULL REFERENCES public.division(id) ON DELETE CASCADE,
	ancestor_id uuid NOT NULL REFERENCES public.division(id) ON DELETE CASCADE,
	ancestor_level integer NOT NULL,
	country_accounts_id uuid NOT NULL,
	PRIMARY KEY (division_id, ancestor_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_da_ancestor_idx ON geo.division_ancestor (country_accounts_id, ancestor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_da_level_idx ON geo.division_ancestor (country_accounts_id, ancestor_level, division_id);
--> statement-breakpoint

-- One row per record, division and measure. A record with no division gets
-- one row per measure with division_id NULL and the reason, so it is counted
-- in the unattributed block and never dropped.
CREATE TABLE IF NOT EXISTS geo.impact_atom (
	atom_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	country_accounts_id uuid NOT NULL,
	disaster_record_id uuid NOT NULL REFERENCES public.disaster_records(id) ON DELETE CASCADE,
	disaster_event_id uuid,
	hazardous_event_id uuid,
	division_id uuid REFERENCES public.division(id) ON DELETE CASCADE,
	admin_level integer,
	unattributed_reason text,
	att_grade char(1),
	geo_precision text,
	derivation text NOT NULL DEFAULT 'as_recorded',
	boundary_vintage text NOT NULL DEFAULT 'unknown',
	measure text NOT NULL,
	quantity_type text NOT NULL DEFAULT 'extensive',
	value numeric,
	value_state text NOT NULL,
	hip_type_id text,
	hip_cluster_id text,
	hip_hazard_id text,
	start_instant date,
	end_instant date,
	date_precision text NOT NULL DEFAULT 'none',
	record_status text NOT NULL,
	event_status text,
	hazard_status text,
	provisional boolean NOT NULL DEFAULT false,
	migration_run_id text,
	plausibility_flags text[] NOT NULL DEFAULT '{}',
	method_version text NOT NULL,
	CONSTRAINT geo_atom_attribution_chk CHECK (
		(division_id IS NOT NULL AND unattributed_reason IS NULL AND att_grade IN ('A', 'B', 'C', 'D'))
		OR (division_id IS NULL AND unattributed_reason IS NOT NULL AND att_grade IS NULL)
	),
	CONSTRAINT geo_atom_value_state_chk CHECK (
		value_state IN ('reported', 'zero_confirmed', 'not_reported', 'not_applicable', 'suppressed')
	),
	-- Null is not zero: a value exists only when reported, and a confirmed zero is 0.
	CONSTRAINT geo_atom_value_chk CHECK (
		(value_state = 'reported' AND value IS NOT NULL AND value > 0)
		OR (value_state = 'zero_confirmed' AND value = 0)
		OR (value_state NOT IN ('reported', 'zero_confirmed') AND value IS NULL)
	),
	CONSTRAINT geo_atom_derivation_chk CHECK (derivation IN ('as_recorded', 'footprint_intersect', 'downward_split')),
	CONSTRAINT geo_atom_quantity_chk CHECK (quantity_type IN ('extensive', 'intensive', 'extremum'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_atom_tenant_measure_idx ON geo.impact_atom (country_accounts_id, measure, record_status, division_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_atom_tenant_start_idx ON geo.impact_atom (country_accounts_id, start_instant);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_atom_tenant_hip_idx ON geo.impact_atom (country_accounts_id, hip_type_id, hip_cluster_id, hip_hazard_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_atom_record_idx ON geo.impact_atom (disaster_record_id);
--> statement-breakpoint

-- When each tenant's read model was last rebuilt, for meta.readModelRefreshedAt.
CREATE TABLE IF NOT EXISTS geo.refresh_log (
	country_accounts_id uuid PRIMARY KEY,
	refreshed_at timestamptz NOT NULL,
	method_version text NOT NULL,
	division_count integer NOT NULL,
	atom_count integer NOT NULL
);
