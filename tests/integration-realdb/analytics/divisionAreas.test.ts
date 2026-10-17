import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { divisionAreasKm2 } from "~/backend.server/models/analytics/divisionAreas";

// Ruling RV-5 option D: density shading needs the true area of each
// division. A 1 x 1 degree box at the equator is about 12,300 km2; the same
// box at 60 degrees north is about half that. Degrees are never used as area.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-divareas@");
const equator = randomUUID();
const north = randomUUID();
const noGeom = randomUUID();

async function box(id: string, x: number, y: number) {
	await dr.execute(sql`
		INSERT INTO division (id, country_accounts_id, name, level, geom)
		VALUES (${id}, ${ids.countryAccountId}, '{"en":"Box"}'::jsonb, 1,
			ST_MakeEnvelope(${x}, ${y}, ${x + 1}, ${y + 1}, 4326))
	`);
}

describe("divisionAreasKm2", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await box(equator, 0, 0);
		await box(north, 0, 60);
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

	it("returns true areas in km2, smaller towards the poles", async () => {
		const areas = await divisionAreasKm2(
			[equator, north, noGeom],
			ids.countryAccountId,
		);
		const eq = areas.get(equator)!;
		expect(eq).toBeGreaterThan(12_200);
		expect(eq).toBeLessThan(12_450);
		const ratio = areas.get(north)! / eq;
		expect(ratio).toBeGreaterThan(0.45);
		expect(ratio).toBeLessThan(0.55);
	});

	it("leaves out divisions without geometry and other tenants' divisions", async () => {
		const areas = await divisionAreasKm2([noGeom], ids.countryAccountId);
		expect(areas.has(noGeom)).toBe(false);
		const other = await divisionAreasKm2([equator], randomUUID());
		expect(other.size).toBe(0);
		expect((await divisionAreasKm2([], ids.countryAccountId)).size).toBe(0);
	});
});
