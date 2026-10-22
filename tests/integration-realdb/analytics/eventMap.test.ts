import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import { getEventMap } from "~/backend.server/models/analytics/dashboard/eventMap.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 events map (M0): E1 has records in North and in North and South; E2's
// only record has no division, so E2 is unplaced. Events are placed by the
// geoportal's read model, refreshed for the tenant first.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-eventmap@");
const ev = { e1: randomUUID(), e2: randomUUID() };
const rec = { a: randomUUID(), b: randomUUID(), d: randomUUID() };
const div = { d1: randomUUID(), d2: randomUUID(), d3: randomUUID() };

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getEventMap", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const id of Object.values(ev)) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${ids.countryAccountId}, 'published', '2020-03-01')`);
		}
		const recs: [string, string][] = [
			[rec.a, ev.e1],
			[rec.d, ev.e1],
			[rec.b, ev.e2],
		];
		for (const [id, eventId] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, disaster_event_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', '2020-03-01', ${eventId})`);
		}
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, national_id) VALUES
			(${div.d1}, ${ids.countryAccountId}, '{"en":"North"}', 1, 'N1'),
			(${div.d2}, ${ids.countryAccountId}, '{"en":"South"}', 1, 'S1'),
			(${div.d3}, ${ids.countryAccountId}, '{"en":"East"}', 1, 'E1')`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES
			(${rec.a}, ${div.d1}), (${rec.d}, ${div.d1}), (${rec.d}, ${div.d2})`);
		await refreshGeoReadModel(ids.countryAccountId);
	});

	afterAll(async () => {
		const t = ids.countryAccountId;
		for (const table of ["event_atom", "impact_atom", "division_ancestor"])
			await dr.execute(
				sql`DELETE FROM ${sql.raw(`geo.${table}`)} WHERE country_accounts_id = ${t}`,
			);
		await dr
			.execute(
				sql`DELETE FROM geo.division_geom_cache WHERE division_id IN (${div.d1}, ${div.d2}, ${div.d3})`,
			)
			.catch(() => {});
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${rec.a}, ${rec.b}, ${rec.d})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_event WHERE country_accounts_id = ${t}`,
		);
		await dr.execute(sql`DELETE FROM event WHERE id IN (${ev.e1}, ${ev.e2})`);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${t}`,
		);
		await cleanupTestUser(ids);
	});

	it("counts each event once per province it touches, lists every province, and names unplaced events", async () => {
		const m = await getEventMap(DEFAULT_QUERY, ctx(), "disaster_event");
		const by = Object.fromEntries(m.areas.map((a) => [a.name, a]));
		expect(Object.keys(by)).toEqual(["East", "North", "South"]);
		expect([by.North.events, by.South.events, by.East.events]).toEqual([
			1, 1, 0,
		]);
		expect(by.North.fromRecords).toBe(1);
		expect(m.unplacedEvents).toBe(1);
		expect(m.legend.note).toContain("do not add up");
	});

	it("gives the hazardous-event map with no events when none are recorded", async () => {
		const m = await getEventMap(DEFAULT_QUERY, ctx(), "hazardous_event");
		expect(m.areas.every((a) => a.events === 0)).toBe(true);
		expect(m.unplacedEvents).toBe(0);
	});
});
