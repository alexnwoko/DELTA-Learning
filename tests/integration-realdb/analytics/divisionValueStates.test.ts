import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import {
	getTotalDeathsByDivision,
	getTotalAffectedPeopleByDivision,
} from "~/backend.server/models/analytics/hazard-analysis";

// C10 / Architecture plan 5a: the division maps split a record's value evenly
// across its divisions with integer division (5 deaths over two provinces
// became 2 + 2) and showed a division with nothing reported as 0.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-divstates@");
const eventId = randomUUID();
const prov = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const rec = { shared: randomUUID(), silent: randomUUID() };

const filters = () => ({
	countryAccountsId: ids.countryAccountId,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
});

describe("division maps with value states", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`INSERT INTO event (id) VALUES (${eventId})`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${eventId}, ${ids.countryAccountId}, 'published')
		`);
		for (const id of Object.values(prov)) {
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, name, level)
				VALUES (${id}, ${ids.countryAccountId}, '{"en":"P"}'::jsonb, 1)
			`);
		}
		for (const id of Object.values(rec)) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${eventId})
			`);
		}
		for (const [r, d] of [
			[rec.shared, prov.a],
			[rec.shared, prov.b],
			[rec.silent, prov.c],
		]) {
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${r}, ${d})
			`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total, injured, injured_total)
			VALUES (${rec.shared}, true, 5, true, 3)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${rec.shared}, ${rec.silent})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${eventId}`);
		await dr.execute(sql`DELETE FROM event WHERE id = ${eventId}`);
		await cleanupTestUser(ids);
	});

	it("counts a shared record's full deaths in each division and flags it", async () => {
		const rows = await getTotalDeathsByDivision(filters() as any);
		const byId = Object.fromEntries(rows.map((r) => [r.divisionId, r]));
		expect(byId[prov.a].totalDeaths).toBe(5);
		expect(byId[prov.b].totalDeaths).toBe(5);
		expect(byId[prov.a].sharedRecords).toBe(1);
		expect(byId[prov.c].totalDeaths).toBeNull();
		expect(byId[prov.c].measure.valueState).toBe("not_reported");
	});

	it("builds the affected composite from reported components without splitting", async () => {
		const rows = await getTotalAffectedPeopleByDivision(filters() as any);
		const byId = Object.fromEntries(rows.map((r) => [r.divisionId, r]));
		expect(byId[prov.a].totalAffected).toBe(3);
		expect(byId[prov.b].totalAffected).toBe(3);
		expect(byId[prov.c].totalAffected).toBeNull();
	});
});
