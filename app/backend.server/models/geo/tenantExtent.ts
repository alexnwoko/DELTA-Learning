// Tenant extent (I-3): the bounding box of the tenant's own boundaries, so
// every map can open on the country without calling an outside geocoder
// (NFR-041; replaces the data.undrr.org and Nominatim lookups in the
// Leaflet maps). Reads the coarsest admin level held in the read model.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { dr } from "~/db.server";
import { cachedGeo } from "~/backend.server/models/geo/cache";
import { readModelRefreshedAt } from "~/backend.server/models/geo/queries";

export interface TenantExtent {
	/** [minLon, minLat, maxLon, maxLat] in EPSG:4326; null when unknown. */
	bbox: [number, number, number, number] | null;
	/** [lat, lon] centre of the box, the order Leaflet expects; null when unknown. */
	center: [number, number] | null;
	/** Admin level the box was taken from; null when unknown. */
	adminLevel: number | null;
	/** Where the box came from. "none": no boundaries are loaded yet. */
	source: "division_geom_cache" | "none";
}

export async function getTenantExtent(
	countryAccountsId: string,
): Promise<TenantExtent> {
	const res = await dr.execute(sql`
		WITH lvl AS (
			SELECT min(admin_level) AS l FROM geo.division_geom_cache
			WHERE country_accounts_id = ${countryAccountsId} AND geom_z4 IS NOT NULL
		)
		SELECT lvl.l AS admin_level,
			ST_XMin(e) AS min_lon, ST_YMin(e) AS min_lat,
			ST_XMax(e) AS max_lon, ST_YMax(e) AS max_lat
		FROM lvl, LATERAL (
			SELECT ST_Extent(c.geom_z4)::geometry AS e
			FROM geo.division_geom_cache c
			WHERE c.country_accounts_id = ${countryAccountsId}
				AND c.admin_level = lvl.l AND c.geom_z4 IS NOT NULL
		) x
		WHERE lvl.l IS NOT NULL AND e IS NOT NULL
	`);
	const row = res.rows[0] as
		| {
				admin_level: number;
				min_lon: number;
				min_lat: number;
				max_lon: number;
				max_lat: number;
		  }
		| undefined;
	if (!row) {
		return { bbox: null, center: null, adminLevel: null, source: "none" };
	}
	const bbox: [number, number, number, number] = [
		Number(row.min_lon),
		Number(row.min_lat),
		Number(row.max_lon),
		Number(row.max_lat),
	];
	return {
		bbox,
		center: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
		adminLevel: Number(row.admin_level),
		source: "division_geom_cache",
	};
}

export interface TenantOutline {
	/** GeoJSON geometry (Polygon or MultiPolygon, EPSG:4326) of the tenant's outer boundary. */
	geojson: { type: string; coordinates: unknown } | null;
	/** [lon, lat] inside the outline (ST_PointOnSurface), where the name stands. */
	labelPoint: [number, number] | null;
	/** The country's name, for the label. */
	name: string | null;
	/** Admin level the outline was built from; null when unknown. */
	adminLevel: number | null;
	/** The country's ISO 3166-1 alpha-3 code, matching geo.admin0. */
	iso3?: string | null;
}

/**
 * The tenant's outer boundary: the union of its coarsest level's z8
 * geometry (no tenant holds a level-0 outline in the read model), with a
 * label point and the country name. Drawn in data.map.country-outline and
 * data.map.area-label on GeoMap and MapChart alike (Alex, 2026-10-18).
 * Never another tenant's geometry (SEC-22). Cached until the next refresh.
 */
export async function getTenantOutline(
	countryAccountsId: string,
): Promise<TenantOutline> {
	return cachedGeo(
		"tenantOutline",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		{},
		async () => {
			const res = await dr.execute(sql`
				WITH lvl AS (
					SELECT min(admin_level) AS l FROM geo.division_geom_cache
					WHERE country_accounts_id = ${countryAccountsId} AND geom_z8 IS NOT NULL
				),
				u AS (
					SELECT lvl.l AS admin_level, ST_UnaryUnion(ST_Collect(c.geom_z8)) AS g
					FROM lvl
					JOIN geo.division_geom_cache c
						ON c.country_accounts_id = ${countryAccountsId}
						AND c.admin_level = lvl.l AND c.geom_z8 IS NOT NULL
					GROUP BY lvl.l
				)
				SELECT u.admin_level,
					ST_AsGeoJSON(u.g, 5)::jsonb AS geojson,
					(ST_AsGeoJSON(ST_PointOnSurface(u.g), 5)::jsonb) -> 'coordinates' AS label_point,
					(SELECT co.name FROM public.country_accounts ca
						JOIN public.countries co ON co.id = ca.country_id
						WHERE ca.id = ${countryAccountsId}) AS name,
					(SELECT co.iso3 FROM public.country_accounts ca
						JOIN public.countries co ON co.id = ca.country_id
						WHERE ca.id = ${countryAccountsId}) AS iso3
				FROM u
				WHERE u.g IS NOT NULL
			`);
			const row = res.rows[0] as
				| {
						admin_level: number;
						geojson: { type: string; coordinates: unknown };
						label_point: [number, number] | null;
						name: string | null;
						iso3: string | null;
				  }
				| undefined;
			if (!row) {
				return {
					geojson: null,
					labelPoint: null,
					name: null,
					adminLevel: null,
					iso3: null,
				};
			}
			return {
				geojson: row.geojson,
				labelPoint: row.label_point
					? [Number(row.label_point[0]), Number(row.label_point[1])]
					: null,
				name: row.name,
				adminLevel: Number(row.admin_level),
				iso3: row.iso3,
			};
		},
	);
}

export interface NeighbourOutline {
	iso3: string;
	name: string;
	/** GeoJSON geometry (MultiPolygon, EPSG:4326), 4 decimals. */
	geojson: { type: string; coordinates: unknown };
	/** [lon, lat] inside the country, where its name stands. */
	labelPoint: [number, number];
}

/**
 * Countries around the tenant (Alex, 2026-10-18: show the countries around
 * the country of focus): every geo.admin0 country whose outline meets the
 * tenant's extent widened by `bboxMarginDeg`, the tenant's own country left
 * out (its outline comes from getTenantOutline). Reference data, drawn in
 * light grey with the UN disclaimer. Empty until geo.admin0 is loaded.
 */
export async function neighbourOutlines(
	countryAccountsId: string,
	bboxMarginDeg = 2,
): Promise<NeighbourOutline[]> {
	const margin = Math.min(Math.max(Number(bboxMarginDeg) || 0, 0), 30);
	const version = await dr.execute(
		sql`SELECT max(loaded_at)::text AS v FROM geo.admin0`,
	);
	const admin0Version = (version.rows[0] as { v: string | null }).v;
	if (!admin0Version) return [];
	return cachedGeo(
		"neighbourOutlines",
		countryAccountsId,
		await readModelRefreshedAt(countryAccountsId),
		{ margin, admin0Version },
		async () => {
			const res = await dr.execute(sql`
				WITH box AS (
					SELECT ST_SetSRID(ST_Expand(ST_Extent(c.geom_z4)::geometry, ${margin}), 4326) AS b
					FROM geo.division_geom_cache c
					WHERE c.country_accounts_id = ${countryAccountsId} AND c.geom_z4 IS NOT NULL
				),
				own AS (
					SELECT co.iso3 FROM public.country_accounts ca
					JOIN public.countries co ON co.id = ca.country_id
					WHERE ca.id = ${countryAccountsId}
				)
				SELECT a.iso3, a.name,
					ST_AsGeoJSON(a.geom, 4)::jsonb AS geojson,
					(ST_AsGeoJSON(a.label_point, 5)::jsonb) -> 'coordinates' AS label_point
				FROM geo.admin0 a, box
				WHERE box.b IS NOT NULL
					AND a.geom && box.b
					AND ST_Intersects(a.geom, box.b)
					AND a.iso3 IS DISTINCT FROM (SELECT iso3 FROM own)
				ORDER BY a.name
			`);
			return (
				res.rows as {
					iso3: string;
					name: string;
					geojson: { type: string; coordinates: unknown };
					label_point: [number, number];
				}[]
			).map((r) => ({
				iso3: r.iso3,
				name: r.name,
				geojson: r.geojson,
				labelPoint: [Number(r.label_point[0]), Number(r.label_point[1])],
			}));
		},
	);
}

/**
 * Shape of the geometry answers. Raise it whenever a geometry response
 * changes form, so browsers holding the old answer for a year fetch anew.
 */
export const GEOMETRY_FORMAT = 2;

/**
 * Version of a tenant's map geometry (NFR-113 first paint). It changes when
 * the tenant's read model is refreshed or the world admin-0 layer is
 * reloaded, so a geometry URL carrying it can be cached by the browser for
 * a year. The tenant id is part of the hash: a user who can switch tenants
 * never gets one tenant's shapes from another tenant's URL.
 */
export async function mapDataVersion(
	countryAccountsId: string,
): Promise<string | null> {
	const refreshedAt = await readModelRefreshedAt(countryAccountsId);
	if (!refreshedAt) return null;
	const res = await dr.execute(
		sql`SELECT max(loaded_at)::text AS v FROM geo.admin0`,
	);
	const admin0 = (res.rows[0] as { v: string | null } | undefined)?.v ?? "none";
	return createHash("sha256")
		.update(`${GEOMETRY_FORMAT}|${countryAccountsId}|${refreshedAt}|${admin0}`)
		.digest("hex")
		.slice(0, 16);
}

/** Version of the world admin-0 layer: changes only when geo.admin0 is reloaded. */
export async function admin0Version(): Promise<string | null> {
	const res = await dr.execute(
		sql`SELECT max(loaded_at)::text AS v FROM geo.admin0`,
	);
	const v = (res.rows[0] as { v: string | null } | undefined)?.v ?? null;
	return v
		? createHash("sha256").update(`${GEOMETRY_FORMAT}|admin0|${v}`).digest("hex").slice(0, 16)
		: null;
}

export interface WorldBoundaries {
	/** Every country border and coastline as one set of shared lines
	 * (MultiLineString, EPSG:4326, 3 decimals): two neighbours share one line,
	 * so no gaps and no doubled strokes after simplification. */
	lines: { type: string; coordinates: unknown } | null;
	/** One name per country, at its stored label point. `minZoom` ranks the
	 * names by country size, so large countries are named first and small
	 * islands only when the reader zooms in. */
	labels: {
		iso3: string;
		name: string;
		labelPoint: [number, number];
		minZoom: number;
	}[];
}

/**
 * The world admin-0 reference layer for the small-scale map (Alex,
 * 2026-10-18: every country's boundary visible, light grey, inside
 * transparent, with light grey names). Borders are drawn as lines, not
 * filled shapes: the layer has nothing to shade and sits under the
 * tenant's figures. The shared linework is simplified once (0.05 degrees,
 * about 5 km; the map shows it below zoom 5, where the detailed neighbour
 * outlines take over) and kept in the geo cache until geo.admin0 changes.
 * Reference data, the same for every tenant.
 */
export async function worldBoundaries(): Promise<WorldBoundaries> {
	const version = await admin0Version();
	if (!version) return { lines: null, labels: [] };
	return cachedGeo("worldAdmin0", "*", version, { tolerance: 0.05, labels: 2 }, async () => {
		const [lines, labels] = await Promise.all([
			dr.execute(sql`
				SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(
					ST_LineMerge(ST_Union(ST_Boundary(geom))), 0.05), 3)::jsonb AS geojson
				FROM geo.admin0
			`),
			dr.execute(sql`
				SELECT iso3, name,
					(ST_AsGeoJSON(label_point, 3)::jsonb) -> 'coordinates' AS label_point,
					ST_Area(geom::geography) / 1e6 AS area_km2
				FROM geo.admin0
				WHERE label_point IS NOT NULL
				ORDER BY name
			`),
		]);
		return {
			lines:
				(lines.rows[0] as { geojson: WorldBoundaries["lines"] } | undefined)
					?.geojson ?? null,
			labels: (
				labels.rows as {
					iso3: string;
					name: string;
					label_point: [number, number];
					area_km2: number | string;
				}[]
			).map((r) => ({
				iso3: r.iso3,
				name: r.name,
				labelPoint: [Number(r.label_point[0]), Number(r.label_point[1])],
				minZoom: labelMinZoom(Number(r.area_km2)),
			})),
		};
	});
}

/** Zoom from which a country's name shows: larger countries first. */
export function labelMinZoom(areaKm2: number): number {
	if (areaKm2 >= 1_000_000) return 0;
	if (areaKm2 >= 250_000) return 2;
	if (areaKm2 >= 50_000) return 3;
	if (areaKm2 >= 5_000) return 4;
	return 5;
}
