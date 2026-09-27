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
	getDisasterEventCountByYear,
	getDisasterSummary,
} from "~/backend.server/models/analytics/hazard-analysis";

// C10 remainder: the events-per-year chart filed an event with an unreadable
// end date under year 0, and the disaster list showed an event whose records
// reported no people affected as 0.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-evyear@");
const dated = randomUUID();
const undated = randomUUID();
const recDated = randomUUID();
const recUndated = randomUUID();

const filters = () => ({
	countryAccountsId: ids.countryAccountId,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
});

describe("event year chart and disaster summary", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const [id, end] of [
			[dated, "2021-06-30"],
			[undated, "unknown"],
		]) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", start_date, end_date)
				VALUES (${id}, ${ids.countryAccountId}, 'published', '2021-06-01', ${end})
			`);
		}
		for (const [rid, eid] of [
			[recDated, dated],
			[recUndated, undated],
		]) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id)
				VALUES (${rid}, ${ids.countryAccountId}, 'published', ${eid})
			`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, injured, injured_total)
			VALUES (${recDated}, true, 4)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${recDated}, ${recUndated})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_event WHERE id IN (${dated}, ${undated})`,
		);
		await dr.execute(sql`DELETE FROM event WHERE id IN (${dated}, ${undated})`);
		await cleanupTestUser(ids);
	});

	it("never files an event under year 0", async () => {
		const byYear = await getDisasterEventCountByYear(filters() as any);
		expect(byYear.find((y) => y.year === 0)).toBeUndefined();
		expect(byYear.find((y) => y.year === 2021)?.count).toBe(1);
	});

	it("shows null, not 0, for an event whose records reported no people affected", async () => {
		const summary = await getDisasterSummary(filters() as any);
		const byId = Object.fromEntries(summary.map((s) => [s.disasterId, s]));
		expect(byId[dated].totalAffectedPeople).toBe(4);
		expect(byId[undated].totalAffectedPeople).toBeNull();
	});
});
