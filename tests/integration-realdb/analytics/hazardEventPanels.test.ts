import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getHazardEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/hazardEventPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 Hazardous events panels 1 to 7 against seeded native events:
// H1 ongoing, 2024-07, HIPs type 1042 with cluster 1078, divisions North and South
// H2 passed, 2023, HIPs type 1037, no division, linked to a disaster event

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-hazevpanels@");
const he = { h1: randomUUID(), h2: randomUUID() };
const de = randomUUID();
const div = { d1: randomUUID(), d2: randomUUID(), d3: randomUUID() };

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getHazardEventPanels1to7", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const id of [he.h1, he.h2, de])
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
		await dr.execute(sql`
			INSERT INTO hazardous_event (id, country_accounts_id, "approvalStatus", hip_type_id, hip_cluster_id, hazardous_event_status, start_date)
			VALUES
			(${he.h1}, ${ids.countryAccountId}, 'published', '1042', '1078', 'ongoing', '2024-07-03'),
			(${he.h2}, ${ids.countryAccountId}, 'published', '1037', NULL, 'passed', '2023')`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", hazardous_event_id)
			VALUES (${de}, ${ids.countryAccountId}, 'published', ${he.h2})`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level) VALUES
			(${div.d1}, ${ids.countryAccountId}, '{"en":"North"}', 1),
			(${div.d2}, ${ids.countryAccountId}, '{"en":"South"}', 1),
			(${div.d3}, ${ids.countryAccountId}, '{"en":"East"}', 1)`);
		await dr.execute(sql`
			INSERT INTO hazardous_event_division (hazardous_event_id, division_id) VALUES
			(${he.h1}, ${div.d1}), (${he.h1}, ${div.d2})`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM hazardous_event_division WHERE hazardous_event_id IN (${he.h1}, ${he.h2})`,
		);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${de}`);
		await dr.execute(
			sql`DELETE FROM hazardous_event WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM event WHERE id IN (${he.h1}, ${he.h2}, ${de})`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("gives the headline, the ongoing list and the year and season panels", async () => {
		const p = await getHazardEventPanels1to7(DEFAULT_QUERY, ctx());
		expect(p.empty).toBeNull();
		expect(p.headline).toEqual({
			events: 2,
			ongoingOrForecasted: 1,
			linkedToDisasterEvent: 1,
			withFootprint: 0,
			codedAtHazardLevel: 0,
		});
		expect(
			p.ongoing.rows.map((r) => [r.eventId, r.status, r.divisions]),
		).toEqual([[he.h1, "ongoing", 2]]);
		expect(p.byYear.years).toEqual([
			{ year: 2023, events: 1 },
			{ year: 2024, events: 1 },
		]);
		expect(p.season).toEqual({
			cells: [{ year: 2024, month: 7, events: 1 }],
			eventsWithoutMonth: 1,
		});
	});

	it("gives hazards, classification depth and divisions", async () => {
		const p = await getHazardEventPanels1to7(DEFAULT_QUERY, ctx());
		const depth = Object.fromEntries(p.depth.rows.map((r) => [r.hipTypeId, r]));
		expect(depth["1042"]).toMatchObject({
			typeOnly: 0,
			cluster: 1,
			specificHazard: 0,
		});
		expect(depth["1037"]).toMatchObject({ typeOnly: 1, cluster: 0 });
		expect(p.byHazard.rows.map((r) => r.label)).toContain("Biological");
		expect(p.divisions.rows.map((r) => [r.name, r.events]).sort()).toEqual([
			["North", 1],
			["South", 1],
		]);
		expect(p.divisions.divisionsWithoutEvents).toBe(1);
		expect(p.divisions.multiDivisionEvents).toBe(1);
	});

	it("says G-01 when no hazardous event is in scope", async () => {
		const p = await getHazardEventPanels1to7(
			{ ...DEFAULT_QUERY, where: { hazard: { typeId: "1041" } } },
			ctx(),
		);
		expect(p.empty?.code).toBe("G-01");
		expect(p.headline.events).toBe(0);
	});
});
