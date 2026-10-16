// Tenant extent (I-3): the bounding box of the tenant's own boundaries, so
// every map can open on the country without calling an outside geocoder
// (NFR-041; replaces the data.undrr.org and Nominatim lookups in the
// Leaflet maps). Reads the coarsest admin level held in the read model.
import { sql } from "drizzle-orm";

import { dr } from "~/db.server";

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
