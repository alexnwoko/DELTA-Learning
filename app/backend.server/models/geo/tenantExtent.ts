// Tenant extent (I-3): the bounding box of the tenant's own boundaries, so
// every map can open on the country without calling an outside geocoder
// (NFR-041; replaces the data.undrr.org and Nominatim lookups in the
// Leaflet maps). Reads the coarsest admin level held in the read model.
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
						WHERE ca.id = ${countryAccountsId}) AS name
				FROM u
				WHERE u.g IS NOT NULL
			`);
			const row = res.rows[0] as
				| {
						admin_level: number;
						geojson: { type: string; coordinates: unknown };
						label_point: [number, number] | null;
						name: string | null;
				  }
				| undefined;
			if (!row) {
				return {
					geojson: null,
					labelPoint: null,
					name: null,
					adminLevel: null,
				};
			}
			return {
				geojson: row.geojson,
				labelPoint: row.label_point
					? [Number(row.label_point[0]), Number(row.label_point[1])]
					: null,
				name: row.name,
				adminLevel: Number(row.admin_level),
			};
		},
	);
}
