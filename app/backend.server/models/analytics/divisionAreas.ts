// True area of each division in km2, for density shading under map symbols
// (ruling RV-5, option D: bubbles over choropleth). Same formula as the
// geoportal's boundaries response: ST_Area on geography, so the area is in
// square metres on the ellipsoid, not in degrees. Requested by Analytics
// beside divisionLabelPoints (2026-10-17); Geoportal lane.

import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

/** km2 per division id; divisions without geometry are absent, never 0. */
export async function divisionAreasKm2(
	divisionIds: readonly (string | number)[],
	countryAccountsId: string,
): Promise<Map<string, number>> {
	const areas = new Map<string, number>();
	const ids = divisionIds.map(String);
	if (ids.length === 0) return areas;
	const res = await dr.execute(sql`
		SELECT d."id"::text AS id,
			ST_Area(d."geom"::geography) / 1e6 AS km2
		FROM "division" d
		WHERE d."country_accounts_id" = ${countryAccountsId}
			AND d."geom" IS NOT NULL
			AND d."id"::text = ANY(ARRAY[${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)}]::text[])
	`);
	for (const row of res.rows as { id: string; km2: number | string | null }[]) {
		const km2 = row.km2 === null ? NaN : Number(row.km2);
		if (Number.isFinite(km2) && km2 > 0) areas.set(row.id, km2);
	}
	return areas;
}
