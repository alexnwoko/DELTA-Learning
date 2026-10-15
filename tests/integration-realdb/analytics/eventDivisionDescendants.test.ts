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
	getDisasterEventCount,
	getDisasterSummary,
} from "~/backend.server/models/analytics/hazard-analysis";

// C18 remainder: the event-based figures filtered on the selected division
// only, so an event linked to a municipality was missing when its province
// was selected. The event-level filters now include descendants, within the
// tenant only. Also C10: an event with no records reports no people figure.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-evdiv@");
const province = randomUUID();
const municipality = randomUUID();
const eventId = randomUUID();

const filters = (geographicLevelId: string | null, tenant = "") => ({
	countryAccountsId: tenant || ids.countryAccountId,
	audience: "public" as const,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId,
	fromDate: null,
	toDate: null,
});

describe("event figures under a division", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO division (id, parent_id, country_accounts_id, name, level)
			VALUES
				(${province}, NULL, ${ids.countryAccountId}, '{"en":"Benguela"}'::jsonb, 1),
				(${municipality}, ${province}, ${ids.countryAccountId}, '{"en":"Lobito"}'::jsonb, 2)
		`);
		await dr.execute(sql`INSERT INTO event (id) VALUES (${eventId})`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${eventId}, ${ids.countryAccountId}, 'published')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_event_division (disaster_event_id, division_id)
			VALUES (${eventId}, ${municipality})
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM disaster_event_division WHERE disaster_event_id = ${eventId}`,
		);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${eventId}`);
		await dr.execute(sql`DELETE FROM event WHERE id = ${eventId}`);
		await dr.execute(
			sql`DELETE FROM division WHERE id IN (${municipality}, ${province})`,
		);
		await cleanupTestUser(ids);
	});

	it("counts an event linked to a child division under its parent", async () => {
		expect(await getDisasterEventCount(filters(province))).toBe(1);
		expect(await getDisasterEventCount(filters(municipality))).toBe(1);
	});

	it("does not reach across tenants", async () => {
		expect(await getDisasterEventCount(filters(province, randomUUID()))).toBe(
			0,
		);
	});

	it("lists the event under its parent, with no people figure", async () => {
		const rows = await getDisasterSummary(filters(province));
		expect(rows.map((r) => r.disasterId)).toEqual([eventId]);
		expect(rows[0].totalAffectedPeople).toBeNull();
	});
});
