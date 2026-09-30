import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getAffected } from "~/backend.server/models/analytics/affected-people-by-disaster-event-v2";

// C18: the disaster-event affected-people view matched the exact division
// only, so a province missed every record linked to its districts.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-affdesc@");
const eventId = randomUUID();
const recordId = randomUUID();
const province = randomUUID();
const district = randomUUID();

async function deathsFor(divisionId: string): Promise<number> {
	const res: any = await getAffected(dr as any, eventId, {
		divisionId,
		audience: "public",
	});
	return Number(res.noDisaggregations.tables.deaths);
}

describe("getAffected division filter", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`INSERT INTO event (id) VALUES (${eventId})`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${eventId}, ${ids.countryAccountId}, 'published')
		`);
		for (const [id, parent, level] of [
			[province, null, 1],
			[district, province, 2],
		] as const) {
			await dr.execute(sql`
				INSERT INTO division (id, parent_id, country_accounts_id, name, level)
				VALUES (${id}, ${parent}, ${ids.countryAccountId}, '{"en":"D"}'::jsonb, ${level})
			`);
		}
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id)
			VALUES (${recordId}, ${ids.countryAccountId}, 'published', ${eventId})
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${recordId}, ${district})
		`);
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total)
			VALUES (${recordId}, true, 7)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id = ${recordId}`,
		);
		await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
		await dr.execute(sql`DELETE FROM division WHERE id = ${district}`);
		await dr.execute(sql`DELETE FROM division WHERE id = ${province}`);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${eventId}`);
		await dr.execute(sql`DELETE FROM event WHERE id = ${eventId}`);
		await cleanupTestUser(ids);
	});

	it("counts a district's record under its province", async () => {
		expect(await deathsFor(district)).toBe(7);
		expect(await deathsFor(province)).toBe(7);
	});
});
