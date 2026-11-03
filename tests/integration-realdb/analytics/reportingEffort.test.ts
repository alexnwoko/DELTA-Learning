import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getReportingEffort } from "~/backend.server/models/analytics/dashboard/reportingEffort.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-effort@");
const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Effort",
	provisional: false,
});
const parents = Array.from({ length: 11 }, () => randomUUID());
const child = randomUUID();

describe("getReportingEffort", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const [i, id] of parents.entries())
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, name, level)
				VALUES (${id}, ${ids.countryAccountId}, ${JSON.stringify({ en: `D${i}` })}::jsonb, 1)`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, parent_id)
			VALUES (${child}, ${ids.countryAccountId}, '{"en":"Child"}'::jsonb, 2, ${parents[0]})`);
		const add = async (
			start: string | null,
			source: string | null,
			divs: string[],
		) => {
			const id = randomUUID();
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, primary_data_source)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${source})`);
			for (const d of divs)
				await dr.execute(sql`
					INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${id}, ${d})`);
		};
		// 2000: 2 records, 1 division, 2 sources (one spelled with spaces).
		await add("2000-01-05", "Red Cross", [parents[0]]);
		await add("2000-02-05", " Agency ", [child]);
		// 2010: 22 records across 11 divisions, 1 source.
		for (const d of parents) {
			await add("2010-03-01", "Agency", [d]);
			await add("2010-04-01", "Agency", [d]);
		}
		// No year, no source, no division.
		await add(null, null, []);
	});

	afterAll(async () => {
		await dr.execute(sql`
			DELETE FROM disaster_records_division WHERE disaster_record_id IN (
				SELECT id FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId})`);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId} AND level = 2`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("gives records, divisions and sources per year, the ratio only from 10 divisions", async () => {
		const p = await getReportingEffort(DEFAULT_QUERY, ctx());
		expect(p.years).toEqual([
			{
				year: 2000,
				records: 2,
				divisions: 1,
				sources: 2,
				recordsPerDivision: null,
			},
			{
				year: 2010,
				records: 22,
				divisions: 11,
				sources: 1,
				recordsPerDivision: 2,
			},
		]);
		expect(p.recordsNoYear).toBe(1);
	});

	it("counts divisions at the chosen admin level", async () => {
		const p = await getReportingEffort({ ...DEFAULT_QUERY, showBy: 2 }, ctx());
		expect(p.years.find((y) => y.year === 2000)!.divisions).toBe(1);
		expect(p.years.find((y) => y.year === 2010)!.divisions).toBe(0);
	});
});
