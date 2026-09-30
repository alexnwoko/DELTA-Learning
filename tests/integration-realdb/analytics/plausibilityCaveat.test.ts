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
	getAffectedPeopleByHazardFilters,
	getTotalDeathsByDivision,
	getTotalAffectedPeopleByDivision,
} from "~/backend.server/models/analytics/hazard-analysis";

// C30: a plausibility flag puts a caveat only on the measures its source
// fields feed. The Angola 223 pattern flags damnificados and vivafec, so
// affected (direct) carries a caveat and deaths does not.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-plaus@");
const eventId = randomUUID();
const division = randomUUID();
const flagged = randomUUID();
const clean = randomUUID();

const filters = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public",
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
});

describe("plausibility caveat per measure", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`INSERT INTO event (id) VALUES (${eventId})`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${eventId}, ${ids.countryAccountId}, 'published')
		`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level)
			VALUES (${division}, ${ids.countryAccountId}, '{"en":"P"}'::jsonb, 1)
		`);
		const flags = JSON.stringify({
			migration: {
				plausibility_flags: [
					{
						code: "IDENTICAL_ACROSS_FIELDS",
						fields: ["damnificados", "vivafec"],
						rule_version: "c30-v1",
						note: "6263166 in both",
					},
				],
			},
		});
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id, legacy_data)
			VALUES (${flagged}, ${ids.countryAccountId}, 'published', ${eventId}, ${flags}::jsonb),
			       (${clean}, ${ids.countryAccountId}, 'published', ${eventId}, '{}'::jsonb)
		`);
		for (const r of [flagged, clean]) {
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${r}, ${division})
			`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total, affected_direct, affected_direct_total)
			VALUES (${flagged}, true, 2, true, 6263166), (${clean}, true, 1, true, 40)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${flagged}, ${clean})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(sql`DELETE FROM division WHERE id = ${division}`);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${eventId}`);
		await dr.execute(sql`DELETE FROM event WHERE id = ${eventId}`);
		await cleanupTestUser(ids);
	});

	it("headline: flags affected direct, not deaths; values unchanged", async () => {
		const res = await getAffectedPeopleByHazardFilters(filters() as any);
		expect(res.measures.affected_direct.recordsFlagged).toBe(1);
		expect(res.measures.affected_direct.value).toBe(6263206);
		expect(res.measures.deaths.recordsFlagged).toBe(0);
		expect(res.measures.deaths.value).toBe(3);
	});

	it("division maps: flags the affected composite, not deaths", async () => {
		const deaths = await getTotalDeathsByDivision(filters() as any);
		const affected = await getTotalAffectedPeopleByDivision(filters() as any);
		expect(
			deaths.find((d) => d.divisionId === division)!.measure.recordsFlagged,
		).toBe(0);
		expect(
			affected.find((d) => d.divisionId === division)!.measure.recordsFlagged,
		).toBe(1);
	});
});
