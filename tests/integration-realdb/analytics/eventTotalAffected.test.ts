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

// Disaster events screen (Alex, 2026-10-15): Total affected is people
// directly affected plus people indirectly affected. Injured, missing and
// displaced are shown on their own and are not added in.

const t = createTestIds();
t.userEmail = t.userEmail.replace("@", "-evtotal@");
const eventId = randomUUID();
const records = { both: randomUUID(), directOnly: randomUUID() };

const conditions = () =>
	({ audience: "public", countryAccountsId: t.countryAccountId }) as const;

describe("event total affected", () => {
	beforeAll(async () => {
		await createTestUser(t);
		await dr.execute(sql`INSERT INTO event (id) VALUES (${eventId})`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${eventId}, ${t.countryAccountId}, 'published')
		`);
		for (const id of Object.values(records)) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id)
				VALUES (${id}, ${t.countryAccountId}, 'published', ${eventId})
			`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence
				(record_id, injured, injured_total, affected_direct, affected_direct_total,
				 affected_indirect, affected_indirect_total, displaced, displaced_total)
			VALUES
				(${records.both}, true, 50, true, 30, true, 400, true, 20),
				(${records.directOnly}, NULL, NULL, true, 5, NULL, NULL, NULL, NULL)
		`);
	});

	afterAll(async () => {
		for (const id of Object.values(records)) {
			await dr.execute(
				sql`DELETE FROM human_category_presence WHERE record_id = ${id}`,
			);
			await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${id}`);
		}
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${eventId}`);
		await dr.execute(sql`DELETE FROM event WHERE id = ${eventId}`);
		await cleanupTestUser(t);
	});

	it("adds direct and indirect only: 35 + 400 = 435", async () => {
		const res = await getAffected(dr as any, eventId, conditions() as any);
		const n = res.noDisaggregations;
		expect(n.tables.directlyAffected).toBe(35);
		expect(n.tables.indirectlyAffected).toBe(400);
		expect(n.totalPeopleAffected).toBe(435);
		expect(n.peopleAffected.valueState).toBe("reported");
		// Injured (50) and displaced (20) stay out of the total.
		expect(n.tables.injured).toBe(50);
		expect(n.tables.displaced).toBe(20);
	});
});
