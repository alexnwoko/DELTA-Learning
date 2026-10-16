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
import { getAffectedByDisasterRecord } from "~/backend.server/models/analytics/affected-people-by-disaster-record";

// Contract O-2 (Alex, 2026-10-16): displaced_total holds evacuated plus
// relocated, because the platform keeps one population split by timing and
// duration. The displaced figure leaves out people relocated after the
// event (reactive, permanent), so evacuated and relocated are never added.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-displacedhl@");
const rec = {
	// 109 evacuated before the event, 2,000 relocated after it.
	disjoint: randomUUID(),
	// The same 27 people evacuated and then relocated: one row.
	identical: randomUUID(),
	// Entered with a total only, no timing or duration.
	totalOnly: randomUUID(),
	// 30 relocated after the event, and a sex-split relocated row that
	// belongs to another group and must not be subtracted.
	crossTab: randomUUID(),
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

async function displacedRow(
	recordId: string,
	value: number,
	timing: string | null,
	duration: string | null,
	sex: string | null = null,
) {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO human_dsg (id, record_id, sex) VALUES (${id}, ${recordId}, ${sex})
	`);
	await dr.execute(sql`
		INSERT INTO displaced (dsg_id, displaced, timing, duration)
		VALUES (${id}, ${value}, ${timing}, ${duration})
	`);
}

describe("displaced figure leaves out people relocated after the event", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const totals: [string, number][] = [
			[rec.disjoint, 2109],
			[rec.identical, 27],
			[rec.totalOnly, 50],
			[rec.crossTab, 40],
		];
		for (const [id, total] of totals) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
				VALUES (${id}, ${ids.countryAccountId}, 'published')
			`);
			await dr.execute(sql`
				INSERT INTO human_category_presence (record_id, displaced, displaced_total)
				VALUES (${id}, true, ${total})
			`);
		}
		await displacedRow(rec.disjoint, 2109, null, null);
		await displacedRow(rec.disjoint, 109, "pre-emptive", null);
		await displacedRow(rec.disjoint, 2000, "reactive", "permanent");
		await displacedRow(rec.identical, 27, null, null);
		await displacedRow(rec.identical, 27, "pre-emptive", "permanent");
		await displacedRow(rec.totalOnly, 50, null, null);
		await displacedRow(rec.crossTab, 40, null, null);
		await displacedRow(rec.crossTab, 30, "reactive", "permanent");
		await displacedRow(rec.crossTab, 12, "reactive", "permanent", "m");
	});

	afterAll(async () => {
		const all = sql.join(Object.values(rec), sql`, `);
		await dr.execute(sql`
			DELETE FROM displaced WHERE dsg_id IN (
				SELECT id FROM human_dsg WHERE record_id IN (${all}))
		`);
		await dr.execute(sql`DELETE FROM human_dsg WHERE record_id IN (${all})`);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("per record: total minus the relocated-after-the-event rows only", async () => {
		const value = async (id: string) =>
			(await getAffectedByDisasterRecord(dr as any, id)).displaced;
		expect(await value(rec.disjoint)).toBe(109);
		expect(await value(rec.identical)).toBe(27);
		expect(await value(rec.totalOnly)).toBe(50);
		// 40 - 30; the sex-split row of 12 is not subtracted again.
		expect(await value(rec.crossTab)).toBe(10);
	});

	it("headline: never adds relocated people to displaced", async () => {
		const res = await getAffectedPeopleByHazardFilters(filters() as any);
		expect(res.totalDisplaced).toBe(109 + 27 + 50 + 10);
	});
});
