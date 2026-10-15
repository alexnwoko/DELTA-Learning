import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getAffectedPeopleByHazardFilters } from "~/backend.server/models/analytics/hazard-analysis";

// C10 / Architecture plan 5a: the hazards dashboard headline figures were
// COALESCE(SUM(...), 0), so "not reported" showed as 0, and records without
// a human-effects row were dropped from scope.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-headline@");
const rec = {
	reported: randomUUID(),
	zero: randomUUID(),
	noRow: randomUUID(),
	injuredOnly: randomUUID(),
	explicitNo: randomUUID(),
};

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

describe("getAffectedPeopleByHazardFilters value states", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const id of Object.values(rec)) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
				VALUES (${id}, ${ids.countryAccountId}, 'published')
			`);
		}
		const presence: [string, string][] = [
			[rec.reported, "deaths = true, deaths_total = 5"],
			[rec.zero, "deaths = true, deaths_total = 0"],
			[rec.injuredOnly, "injured = true, injured_total = 3"],
			[rec.explicitNo, "deaths = false"],
		];
		for (const [id, set] of presence) {
			const cols = set.split(", ").map((c) => c.split(" = "));
			await dr.execute(sql`
				INSERT INTO human_category_presence (record_id, ${sql.raw(cols.map((c) => c[0]).join(", "))})
				VALUES (${id}, ${sql.raw(cols.map((c) => c[1]).join(", "))})
			`);
		}
	});

	afterAll(async () => {
		await dr.execute(sql`
			DELETE FROM human_category_presence WHERE record_id IN (${sql.join(Object.values(rec), sql`, `)})
		`);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("reports deaths with the reported, zero and not-reported split", async () => {
		const res = await getAffectedPeopleByHazardFilters(filters() as any);
		expect(res.totalDeaths).toBe(5);
		expect(res.measures.deaths).toEqual({
			value: 5,
			valueState: "reported",
			recordsReported: 1,
			recordsZeroConfirmed: 2,
			recordsNotReported: 2,
			recordsTotal: 5,
			recordsFlagged: 0,
		});
	});

	it("returns null, not 0, for a measure no record reported", async () => {
		const res = await getAffectedPeopleByHazardFilters(filters() as any);
		expect(res.totalMissing).toBeNull();
		expect(res.measures.missing.valueState).toBe("not_reported");
		expect(res.measures.missing.recordsTotal).toBe(5);
	});
});
