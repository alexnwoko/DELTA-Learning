import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 Disaster impact panels 1 to 4: every figure keeps its value state.
// 2020: 10 + 5 deaths reported (HIPs type 1042); 2021: a confirmed zero
// (type 1037); 2022: nothing reported (no HIPs type).

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-impactpanels@");
const rec = {
	a: randomUUID(),
	b: randomUUID(),
	c: randomUUID(),
	d: randomUUID(),
};

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getImpactPanels1to4", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const rows: [string, string, string | null][] = [
			[rec.a, "2020-03-01", "1042"],
			[rec.d, "2020-07-01", "1042"],
			[rec.b, "2021-05-01", "1037"],
			[rec.c, "2022", null],
		];
		for (const [id, start, type] of rows) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${type})
			`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES
			(${rec.a}, true, 10), (${rec.d}, true, 5), (${rec.b}, true, 0)
		`);
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

	it("gives the deaths tile and a yearly sparkline with each year's state", async () => {
		const p = await getImpactPanels1to4(DEFAULT_QUERY, ctx());
		const deaths = p.tiles.find((t) => t.measure === "deaths")!;
		expect(deaths.cell.value).toBe(15);
		expect(deaths.sparkline.map((s) => s.year)).toEqual([2020, 2021, 2022]);
		const [y20, y21, y22] = deaths.sparkline.map((s) => s.cell);
		expect(y20.value).toBe(15);
		expect(y20.valueState).toBe("reported");
		expect(y21.valueState).toBe("zero_confirmed");
		expect(y22.value).toBeNull();
		expect(y22.valueState).not.toBe("reported");
	});

	it("ranks hazard types by value, with the untyped group last and not as 0", async () => {
		const p = await getImpactPanels1to4(DEFAULT_QUERY, ctx());
		expect(p.hazardRanking.map((r) => r.hipTypeId)).toEqual([
			"1042",
			"1037",
			"none",
		]);
		expect(p.hazardRanking[0].cell.value).toBe(15);
		expect(p.hazardRanking[2].label).toBe("No HIPs type");
		expect(p.hazardRanking[2].cell.value).toBeNull();
	});

	it("annotates the peak year and counts records in the coverage waffle", async () => {
		const p = await getImpactPanels1to4(DEFAULT_QUERY, ctx());
		expect(p.timeline.annotations).toEqual([
			{ year: 2020, label: "Highest year in scope" },
		]);
		expect(p.coverage.recordsTotal).toBe(4);
		expect(
			p.coverage.recordsReported +
				p.coverage.recordsZeroConfirmed +
				p.coverage.recordsNotReported,
		).toBe(4);
	});

	it("names a filter it cannot apply instead of dropping it", async () => {
		const p = await getImpactPanels1to4(
			{ ...DEFAULT_QUERY, where: { region: { regionId: randomUUID() } } },
			ctx(),
		);
		expect(p.meta.tiles.notApplied).toContain("region");
	});

	it("names the effect chips as not applied instead of ignoring them", async () => {
		const p = await getImpactPanels1to4(
			{ ...DEFAULT_QUERY, where: { humanEffects: ["deaths"] } },
			ctx(),
		);
		expect(p.meta.tiles.notApplied).toContain("humanEffects");
	});
});
