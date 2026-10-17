import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getDisasterEventCountByDivision } from "~/backend.server/models/analytics/hazard-analysis";

// Migrated disaster events carry no division links, so the event count map
// read 0 everywhere. An event without links is now placed where its member
// records sit (derivation from_records, as in the geoportal); an event with
// links is placed by its links only.

const t = createTestIds();
t.userEmail = t.userEmail.replace("@", "-evcount@");
const prov = { a: randomUUID(), b: randomUUID() };
const ev = { unlinked: randomUUID(), linked: randomUUID() };
const rec = { unlinked: randomUUID(), linked: randomUUID() };

const filters = (geographicLevelId: string | null = null) => ({
	countryAccountsId: t.countryAccountId,
	audience: "public" as const,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId,
	fromDate: null,
	toDate: null,
});

describe("event count by division", () => {
	beforeAll(async () => {
		await createTestUser(t);
		for (const id of Object.values(prov)) {
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, name, level)
				VALUES (${id}, ${t.countryAccountId}, '{"en":"P"}'::jsonb, 1)
			`);
		}
		for (const id of Object.values(ev)) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
				VALUES (${id}, ${t.countryAccountId}, 'published')
			`);
		}
		// The linked event is linked to province A; its record sits in B.
		await dr.execute(sql`
			INSERT INTO disaster_event_division (disaster_event_id, division_id)
			VALUES (${ev.linked}, ${prov.a})
		`);
		for (const [r, e, d] of [
			[rec.unlinked, ev.unlinked, prov.b],
			[rec.linked, ev.linked, prov.b],
		]) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id)
				VALUES (${r}, ${t.countryAccountId}, 'published', ${e})
			`);
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id)
				VALUES (${r}, ${d})
			`);
		}
	});

	afterAll(async () => {
		for (const r of Object.values(rec)) {
			await dr.execute(
				sql`DELETE FROM disaster_records_division WHERE disaster_record_id = ${r}`,
			);
			await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${r}`);
		}
		await dr.execute(
			sql`DELETE FROM disaster_event_division WHERE disaster_event_id = ${ev.linked}`,
		);
		for (const e of Object.values(ev)) {
			await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${e}`);
			await dr.execute(sql`DELETE FROM event WHERE id = ${e}`);
		}
		await dr.execute(
			sql`DELETE FROM division WHERE id IN (${prov.a}, ${prov.b})`,
		);
		await cleanupTestUser(t);
	});

	it("places an unlinked event by its records and a linked one by its links", async () => {
		const rows = await getDisasterEventCountByDivision(filters());
		const byDiv = Object.fromEntries(rows.map((r) => [r.divisionId, r]));
		expect(byDiv[prov.a]).toMatchObject({
			eventCount: 1,
			eventsFromRecords: 0,
		});
		expect(byDiv[prov.b]).toMatchObject({
			eventCount: 1,
			eventsFromRecords: 1,
		});
	});

	it("applies the same rule to the division filter", async () => {
		const rows = await getDisasterEventCountByDivision(filters(prov.b));
		expect(rows.reduce((s, r) => s + r.eventCount, 0)).toBe(1);
	});

	it("never places events for another tenant", async () => {
		const rows = await getDisasterEventCountByDivision({
			...filters(),
			countryAccountsId: randomUUID(),
		});
		expect(rows).toEqual([]);
	});
});
