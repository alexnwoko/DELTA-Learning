import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { extractYearFromDate } from "~/backend.server/utils/dateFilters";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";

// C09: records with a missing or unreadable start date were counted in the
// current year. They must come back as NULL so no chart invents a year.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-undated@");
const rec = {
	missing: randomUUID(),
	empty: randomUUID(),
	garbage: randomUUID(),
	yearMonth: randomUUID(),
};

describe("extractYearFromDate", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const dates: [string, string | null][] = [
			[rec.missing, null],
			[rec.empty, ""],
			[rec.garbage, "unknown"],
			[rec.yearMonth, "2019-05"],
		];
		for (const [id, d] of dates) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${ids.countryAccountId}, 'draft', ${d})
			`);
		}
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("returns NULL for missing, empty and unreadable dates, never the current year", async () => {
		const rows = await dr
			.select({
				id: disasterRecordsTable.id,
				year: extractYearFromDate(disasterRecordsTable.startDate).as("year"),
			})
			.from(disasterRecordsTable)
			.where(inArray(disasterRecordsTable.id, Object.values(rec)));
		const byId = Object.fromEntries(rows.map((r) => [r.id, r.year]));
		expect(byId[rec.missing]).toBeNull();
		expect(byId[rec.empty]).toBeNull();
		expect(byId[rec.garbage]).toBeNull();
		expect(Number(byId[rec.yearMonth])).toBe(2019);
	});
});
