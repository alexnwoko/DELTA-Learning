import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/eventPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 Disaster events panels 1 to 7 against seeded events:
// E1 GLIDE event, 2020, HIPs type 1042: records a (40 deaths, North) and
//    d (5 deaths, 700 houses destroyed, North and South)
// E2 serial event, 2021, no HIPs type: record b (a confirmed zero)
// E3 entered event, no start date, no records
// Record c links to no event.

const HOUSING = "6ac0b833-6218-49d0-9882-827c1b748d7a";
const HOUSE_ASSET = "e2f26abf-a73c-4149-9bc7-fbed4eaa148f";
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-eventpanels@");
const ev = { e1: randomUUID(), e2: randomUUID(), e3: randomUUID() };
const rec = {
	a: randomUUID(),
	b: randomUUID(),
	c: randomUUID(),
	d: randomUUID(),
};
const div = { d1: randomUUID(), d2: randomUUID() };

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getEventPanels1to7", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const events: [string, string, string, string | null, string | null][] = [
			[ev.e1, "FL-2020-000001-TST", "2020-03-01", "1042", "glide"],
			[ev.e2, "", "2021", null, "ser"],
			[ev.e3, "", "", null, null],
		];
		for (const [id, glide, start, type, rule] of events) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", glide, start_date, hip_type_id, legacy_data)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${glide}, ${start}, ${type},
					${rule ? JSON.stringify({ migration: { event_grouping: rule } }) : null}::jsonb)`);
		}
		const recs: [string, string, string | null, string | null][] = [
			[rec.a, "2020-03-01", "1042", ev.e1],
			[rec.d, "2020-03-02", "1042", ev.e1],
			[rec.b, "2021-05-01", null, ev.e2],
			[rec.c, "2022", null, null],
		];
		for (const [id, start, type, eventId] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id, disaster_event_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${type}, ${eventId})`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES
			(${rec.a}, true, 40), (${rec.d}, true, 5), (${rec.b}, true, 0)`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level) VALUES
			(${div.d1}, ${ids.countryAccountId}, '{"en":"North"}', 1),
			(${div.d2}, ${ids.countryAccountId}, '{"en":"South"}', 1)`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES
			(${rec.a}, ${div.d1}), (${rec.d}, ${div.d1}), (${rec.d}, ${div.d2})`);
		await dr.execute(sql`
			INSERT INTO damages (record_id, sector_id, asset_id, unit, td_damage_amount)
			VALUES (${rec.d}, ${HOUSING}, ${HOUSE_ASSET}, 'number_count', 700)`);
	});

	afterAll(async () => {
		const all = sql.join(
			Object.values(rec).map((r) => sql`${r}`),
			sql`, `,
		);
		await dr.execute(sql`DELETE FROM damages WHERE record_id IN (${all})`);
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_event WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM event WHERE id IN (${sql.join(
				Object.values(ev).map((e) => sql`${e}`),
				sql`, `,
			)})`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("counts events by grouping rule and records by linkage", async () => {
		const p = await getEventPanels1to7(DEFAULT_QUERY, ctx());
		expect(p.empty).toBeNull();
		expect(p.headline.events).toBe(3);
		expect(p.headline.byRule).toEqual({ glide: 1, serial: 1, entered: 1 });
		expect(p.headline.eventsWithGlide).toBe(1);
		expect([p.headline.recordsLinked, p.headline.recordsInScope]).toEqual([
			3, 4,
		]);
		expect(p.headline.deaths.value).toBe(45);
		expect(p.linkage).toEqual({
			linked: { glide: 2, serial: 1, entered: 0 },
			notLinked: 1,
			recordsInScope: 4,
		});
	});

	it("ranks events, counts their divisions, and bins records per event", async () => {
		const p = await getEventPanels1to7(DEFAULT_QUERY, ctx());
		const top = p.largest.rows[0];
		expect(top.eventId).toBe(ev.e1);
		expect(top.name).toBe("FL-2020-000001-TST");
		expect([top.cell.value, top.records, top.divisions]).toEqual([45, 2, 2]);
		expect(
			p.largest.rows.find((r) => r.eventId === ev.e3)?.cell.value,
		).toBeNull();
		const bins = Object.fromEntries(
			p.recordsPerEvent.bins.map((b) => [b.label, b.events]),
		);
		expect([bins["1"], bins["2 to 5"]]).toEqual([1, 1]);
		expect(p.recordsPerEvent.eventsWithoutRecords).toBe(1);
		expect(p.recordsPerEvent.recordsNotGrouped).toBe(1);
	});

	it("gives events by year and hazard, and the GAR split per event", async () => {
		const p = await getEventPanels1to7(DEFAULT_QUERY, ctx());
		expect(p.byYear.years.map((y) => [y.year, y.events])).toEqual([
			[2020, 1],
			[2021, 1],
		]);
		expect(p.byYear.eventsWithoutYear).toBe(1);
		expect(p.byHazard.rows).toEqual([
			{ hipTypeId: "none", label: "Hazard not coded", events: 2 },
			{
				hipTypeId: "1042",
				label: "Meteorological and Hydrological",
				events: 1,
			},
		]);
		expect(p.eventSize).toMatchObject({
			intensive: 1,
			extensive: 0,
			zeroConfirmed: 1,
			notReported: 1,
		});
	});

	it("filters events by hazard on the event", async () => {
		const p = await getEventPanels1to7(
			{ ...DEFAULT_QUERY, where: { hazard: { typeId: "1042" } } },
			ctx(),
		);
		expect(p.headline.events).toBe(1);
	});

	it("says no events are in scope instead of drawing zeros", async () => {
		const p = await getEventPanels1to7(
			{ ...DEFAULT_QUERY, where: { hazard: { typeId: "1041" } } },
			ctx(),
		);
		expect(p.empty?.reason).toBe(
			"No disaster events in scope for these filters.",
		);
	});
});
