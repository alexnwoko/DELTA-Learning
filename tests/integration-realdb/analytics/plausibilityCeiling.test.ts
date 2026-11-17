import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { createTestIds, createTestUser, cleanupTestUser } from "../test-helpers";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import { getImpactPanels5to16 } from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";
import { ABOVE_CEILING_CODE, PLAUSIBILITY_CEILINGS } from "~/utils/plausibility";

// One record above the missing-persons ceiling, one below: the total keeps
// both values, and the figure is marked "Under review" (Alex, 2026-10-18).
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-ceiling@");
const rec = { big: randomUUID(), small: randomUUID() };
const BIG = PLAUSIBILITY_CEILINGS.missing + 1;
const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("plausibility ceiling", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const [id, start] of [[rec.big, "2011-12-01"], [rec.small, "2012-01-01"]]) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, '1042')`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, missing, missing_total) VALUES
			(${rec.big}, true, ${BIG}), (${rec.small}, true, 7)`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM human_category_presence WHERE record_id IN (${rec.big}, ${rec.small})`);
		await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`);
		await cleanupTestUser(ids);
	});

	it("keeps both values in the total and marks the one record above the ceiling", async () => {
		const p = await getImpactPanels1to4(DEFAULT_QUERY, ctx());
		const cell = p.tiles.find((t) => t.measure === "missing")!.cell;
		expect(cell.value).toBe(BIG + 7);
		expect(cell.recordsReported).toBe(2);
		expect(cell.recordsFlagged).toBe(1);
		expect(cell.recordsAboveCeiling).toBe(1);
		const deaths = p.tiles.find((t) => t.measure === "deaths")!.cell;
		expect(deaths.recordsAboveCeiling).toBeUndefined();
	});

	it("lists ABOVE_CEILING on the record in the largest-records panel", async () => {
		const s = await getImpactPanels5to16({ ...DEFAULT_QUERY, measure: "missing" }, ctx());
		const row = s.largestRecords.rows.find((r) => r.recordId === rec.big)!;
		expect(row.flags).toContain(ABOVE_CEILING_CODE);
		expect(row.cell.recordsAboveCeiling).toBe(1);
		const small = s.largestRecords.rows.find((r) => r.recordId === rec.small)!;
		expect(small.flags).not.toContain(ABOVE_CEILING_CODE);
		expect(small.cell.recordsAboveCeiling).toBeUndefined();
	});
});
