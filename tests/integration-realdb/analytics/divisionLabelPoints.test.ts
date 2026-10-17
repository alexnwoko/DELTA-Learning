import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { divisionLabelPoints } from "~/backend.server/models/analytics/divisionLabelPoints";

// Ruling RV-5: a map bubble or bar stands on a point inside its division. For a
// U-shaped division the centroid falls in the gap, outside the area;
// ST_PointOnSurface does not.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-labelpoints@");
const uShape = randomUUID();
const noGeom = randomUUID();
// A "U": two arms joined at the bottom, open at the top between x 1 and 2.
const U_WKT = "POLYGON((0 0, 3 0, 3 3, 2 3, 2 1, 1 1, 1 3, 0 3, 0 0))";

describe("divisionLabelPoints", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, geom)
			VALUES (${uShape}, ${ids.countryAccountId}, '{"en":"U"}'::jsonb, 1,
				ST_SetSRID(ST_GeomFromText(${U_WKT}), 4326))
		`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level)
			VALUES (${noGeom}, ${ids.countryAccountId}, '{"en":"N"}'::jsonb, 1)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("returns a point inside a concave division, where the centroid is outside", async () => {
		const points = await divisionLabelPoints(
			[uShape, noGeom],
			ids.countryAccountId,
		);
		const p = points.get(uShape);
		expect(p).toBeDefined();
		const res = await dr.execute(sql`
			SELECT
				ST_Contains(ST_GeomFromText(${U_WKT}), ST_MakePoint(${p![0]}, ${p![1]})) AS inside,
				ST_Contains(ST_GeomFromText(${U_WKT}), ST_Centroid(ST_GeomFromText(${U_WKT}))) AS centroid_inside
		`);
		const row = res.rows[0] as { inside: boolean; centroid_inside: boolean };
		expect(row.inside).toBe(true);
		expect(row.centroid_inside).toBe(false);
	});

	it("leaves out divisions without geometry and other tenants' divisions", async () => {
		const points = await divisionLabelPoints([uShape, noGeom], randomUUID());
		expect(points.size).toBe(0);
		const own = await divisionLabelPoints([noGeom], ids.countryAccountId);
		expect(own.has(noGeom)).toBe(false);
	});
});
