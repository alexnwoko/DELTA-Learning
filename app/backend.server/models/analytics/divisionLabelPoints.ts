// A point inside each division, where a map bubble or bar stands (RV-5 as amended).
// ST_PointOnSurface always falls inside the area, even for concave or
// multi-part divisions, which a centroid does not. Same rule as the
// geoportal's boundaries response.

import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

/** [longitude, latitude] per division id; divisions without geometry are absent. */
export async function divisionLabelPoints(
	divisionIds: readonly (string | number)[],
	countryAccountsId: string,
): Promise<Map<string, [number, number]>> {
	const points = new Map<string, [number, number]>();
	const ids = divisionIds.map(String);
	if (ids.length === 0) return points;
	const res = await dr.execute(sql`
		SELECT d."id"::text AS id,
			ST_X(ST_PointOnSurface(d."geom")) AS lng,
			ST_Y(ST_PointOnSurface(d."geom")) AS lat
		FROM "division" d
		WHERE d."country_accounts_id" = ${countryAccountsId}
			AND d."geom" IS NOT NULL
			AND d."id"::text = ANY(ARRAY[${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)}]::text[])
	`);
	for (const row of res.rows as { id: string; lng: number; lat: number }[]) {
		if (row.lng !== null && row.lat !== null) {
			points.set(row.id, [Number(row.lng), Number(row.lat)]);
		}
	}
	return points;
}
