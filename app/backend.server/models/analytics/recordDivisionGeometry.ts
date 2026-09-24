import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

/**
 * Returns the division a disaster record is linked to, as a GeoJSON Feature,
 * or null when the record is not linked to that division in this tenant.
 */
export async function getRecordDivisionFeature(
	countryAccountsId: string,
	recordId: string,
	divisionId: string,
): Promise<{
	type: "Feature";
	geometry: unknown;
	properties: { division_id: string };
} | null> {
	const res = await dr.execute(sql`
		SELECT ST_AsGeoJSON(d.geom)::jsonb AS geometry
		FROM disaster_records_division drd
		JOIN disaster_records r ON r.id = drd.disaster_record_id
		JOIN division d ON d.id = drd.division_id
		WHERE drd.disaster_record_id = ${recordId}
			AND drd.division_id = ${divisionId}
			AND r.country_accounts_id = ${countryAccountsId}
			AND d.geom IS NOT NULL
		LIMIT 1
	`);
	const raw = res.rows[0]?.geometry;
	if (!raw) return null;
	const geometry = typeof raw === "string" ? JSON.parse(raw) : raw;
	return {
		type: "Feature",
		geometry,
		properties: { division_id: divisionId },
	};
}
