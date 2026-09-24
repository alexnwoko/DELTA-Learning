import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getRecordDivisionFeature } from "~/backend.server/models/analytics/recordDivisionGeometry";

// The record footprint map read the dropped spatial_footprint column and
// took no tenant scope. The geometry now comes from the division link.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-recgeom@");
const divisionId = randomUUID();
const recordId = randomUUID();

describe("getRecordDivisionFeature", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, geom, bbox)
			VALUES (${divisionId}, ${ids.countryAccountId}, '{"en":"D"}'::jsonb, 1,
				ST_MakeEnvelope(0, 0, 1, 1, 4326), ST_MakeEnvelope(0, 0, 1, 1, 4326))
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
			VALUES (${recordId}, ${ids.countryAccountId}, 'published')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${recordId}, ${divisionId})
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
		await dr.execute(sql`DELETE FROM division WHERE id = ${divisionId}`);
		await cleanupTestUser(ids);
	});

	it("returns the linked division geometry as a Feature", async () => {
		const f = await getRecordDivisionFeature(
			ids.countryAccountId,
			recordId,
			divisionId,
		);
		expect(f?.type).toBe("Feature");
		expect((f?.geometry as { type: string }).type).toBe("Polygon");
	});

	it("returns null for another tenant", async () => {
		expect(
			await getRecordDivisionFeature(randomUUID(), recordId, divisionId),
		).toBeNull();
	});

	it("returns null when the record is not linked to the division", async () => {
		expect(
			await getRecordDivisionFeature(
				ids.countryAccountId,
				recordId,
				randomUUID(),
			),
		).toBeNull();
	});
});
