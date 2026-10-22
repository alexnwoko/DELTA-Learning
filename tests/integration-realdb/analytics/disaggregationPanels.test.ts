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
	getGenderTotalsByHazardFilters,
	getAgeTotalsByHazardFilters,
	getDisabilityTotalByHazardFilters,
} from "~/backend.server/models/analytics/hazard-analysis";

// C10: the disaggregation panels summed cross-tab rows (age and disability
// ignored the sex dimension, so sex-by-age rows were counted twice), included
// custom-disaggregated rows, and showed 0 when no record carried a breakdown.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-dsgpanels@");
const withBreakdown = randomUUID();
const totalOnly = randomUUID();
const evacRelocated = randomUUID();

async function row(
	recordId: string,
	dims: Record<string, string | null>,
	injured: number,
	custom: string | null = null,
) {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO human_dsg (id, record_id, sex, age, custom)
		VALUES (${id}, ${recordId}, ${dims.sex ?? null}, ${dims.age ?? null},
			${custom}::jsonb)
	`);
	await dr.execute(
		sql`INSERT INTO injured (dsg_id, injured) VALUES (${id}, ${injured})`,
	);
}

// One sex-split displaced row with a timing or duration (the Displaced table
// carries them on the value row, not on human_dsg).
async function displacedRow(
	recordId: string,
	sex: string,
	displaced: number,
	timing: string | null,
	duration: string | null,
) {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO human_dsg (id, record_id, sex) VALUES (${id}, ${recordId}, ${sex})
	`);
	await dr.execute(sql`
		INSERT INTO displaced (dsg_id, displaced, timing, duration)
		VALUES (${id}, ${displaced}, ${timing}, ${duration})
	`);
}

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

describe("disaggregation panels", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const id of [withBreakdown, totalOnly, evacRelocated]) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
				VALUES (${id}, ${ids.countryAccountId}, 'published')
			`);
		}
		await row(withBreakdown, {}, 10);
		await row(withBreakdown, { sex: "m" }, 6);
		await row(withBreakdown, { sex: "f" }, 4);
		await row(withBreakdown, { age: "0-14" }, 3);
		await row(withBreakdown, { age: "15-64" }, 7);
		await row(withBreakdown, { sex: "m", age: "0-14" }, 2);
		await row(withBreakdown, { sex: "f" }, 99, '{"ethnicity":"x"}');
		await row(totalOnly, {}, 5);
		// 27 evacuated and the same 27 relocated (the IDENTICAL pattern).
		await displacedRow(evacRelocated, "m", 27, "pre-emptive", null);
		await displacedRow(evacRelocated, "m", 27, "reactive", "permanent");
	});

	afterAll(async () => {
		await dr.execute(sql`
			DELETE FROM injured WHERE dsg_id IN (
				SELECT id FROM human_dsg WHERE record_id IN (${withBreakdown}, ${totalOnly}))
		`);
		await dr.execute(sql`
			DELETE FROM displaced WHERE dsg_id IN (
				SELECT id FROM human_dsg WHERE record_id = ${evacRelocated})
		`);
		await dr.execute(
			sql`DELETE FROM human_dsg WHERE record_id IN (${withBreakdown}, ${totalOnly}, ${evacRelocated})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("sex panel reads sex-only rows, excludes custom rows, reports coverage", async () => {
		const g = await getGenderTotalsByHazardFilters(filters() as any);
		// 6 injured men, plus 27 evacuated men; the 27 relocated are not added.
		expect(g.totalMen).toBe(6 + 27);
		expect(g.totalWomen).toBe(4);
		expect(g.totalNonBinary).toBe(0);
		expect(g.genderCoverage).toEqual({
			recordsWithBreakdown: 2,
			recordsTotal: 3,
		});
	});

	it("age panel does not count sex-by-age rows twice", async () => {
		const a = await getAgeTotalsByHazardFilters(filters() as any);
		expect(a.totalChildren).toBe(3);
		expect(a.totalAdults).toBe(7);
		expect(a.totalSeniors).toBe(0);
	});

	it("is null, not 0, when no record carries the breakdown", async () => {
		expect(
			await getDisabilityTotalByHazardFilters(filters() as any),
		).toBeNull();
	});
});
