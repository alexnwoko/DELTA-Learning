-- World admin-0 reference layer (Alex, 2026-10-18, rulings 1 and 2 on the
-- map payload research). One row per country: a generalised polygon for the
-- default map background and neighbouring-country outlines, never tenant
-- data. Loaded by scripts/seed-admin0.ts from a public-domain source
-- (Natural Earth 1:50m until UN Geospatial answers); every map that shows it
-- carries the UN disclaimer. Disputed lines are corrected only with the UNDRR
-- cartography focal point (ruling 3).
CREATE TABLE IF NOT EXISTS geo.admin0 (
	iso3 text PRIMARY KEY,
	name text NOT NULL,
	geom geometry(MultiPolygon, 4326) NOT NULL,
	label_point geometry(Point, 4326) NOT NULL,
	source text NOT NULL,
	source_version text NOT NULL,
	loaded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_admin0_geom_idx ON geo.admin0 USING gist (geom);
