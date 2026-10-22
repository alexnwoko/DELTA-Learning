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
	getImpactMap,
	getImpactPanels5to16,
	showByLevels,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 Disaster impact panels 5 to 16 against seeded records:
// a: 2020-03, type 1042, 40 deaths (12 of them female), division D1
// d: 2020-07, type 1042, 5 deaths, 700 houses destroyed, divisions D1 and D2
// b: 2021-05, type 1037, a confirmed zero for deaths
// c: 2022, no type, nothing reported

const HOUSING = "6ac0b833-6218-49d0-9882-827c1b748d7a";
const HOUSE_ASSET = "e2f26abf-a73c-4149-9bc7-fbed4eaa148f";

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-impactpanels516@");
const rec = {
	a: randomUUID(),
	b: randomUUID(),
	c: randomUUID(),
	d: randomUUID(),
};
const div = { d1: randomUUID(), d2: randomUUID(), d3: randomUUID() };
const dsg = randomUUID();

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getImpactPanels5to16", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const recs: [string, string, string | null][] = [
			[rec.a, "2020-03-01", "1042"],
			[rec.d, "2020-07-01", "1042"],
			[rec.b, "2021-05-01", "1037"],
			[rec.c, "2022", null],
		];
		for (const [id, start, type] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${type})`);
		}
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES
			(${rec.a}, true, 40), (${rec.d}, true, 5), (${rec.b}, true, 0)`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level) VALUES
			(${div.d1}, ${ids.countryAccountId}, '{"en":"North"}', 1),
			(${div.d2}, ${ids.countryAccountId}, '{"en":"South"}', 1)`);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, parent_id) VALUES
			(${div.d3}, ${ids.countryAccountId}, '{"en":"North East"}', 2, ${div.d1})`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES
			(${rec.a}, ${div.d1}), (${rec.a}, ${div.d3}), (${rec.d}, ${div.d1}), (${rec.d}, ${div.d2})`);
		await dr.execute(sql`
			INSERT INTO damages (record_id, sector_id, asset_id, unit, td_damage_amount)
			VALUES (${rec.d}, ${HOUSING}, ${HOUSE_ASSET}, 'number_count', 700)`);
		await dr.execute(sql`
			INSERT INTO human_dsg (id, record_id, sex) VALUES (${dsg}, ${rec.a}, 'f')`);
		await dr.execute(
			sql`INSERT INTO deaths (dsg_id, deaths) VALUES (${dsg}, 12)`,
		);
	});

	afterAll(async () => {
		const all = sql.join(
			Object.values(rec).map((r) => sql`${r}`),
			sql`, `,
		);
		await dr.execute(sql`DELETE FROM deaths WHERE dsg_id = ${dsg}`);
		await dr.execute(sql`DELETE FROM human_dsg WHERE record_id IN (${all})`);
		await dr.execute(sql`DELETE FROM damages WHERE record_id IN (${all})`);
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`,
		);
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

	it("gives Sendai counts and the houses input with their states", async () => {
		const p = await getImpactPanels5to16(DEFAULT_QUERY, ctx());
		const a2 = p.sendai.indicators.find((i) => i.code === "A-2")!;
		expect(a2.cell.value).toBe(45);
		const a3 = p.sendai.indicators.find((i) => i.code === "A-3")!;
		expect(a3.cell.value).toBeNull();
		const b4 = p.sendai.inputs.find((i) => i.inputTo === "B-4")!;
		expect(b4.cell.value).toBe(700);
		const b3 = p.sendai.inputs.find((i) => i.inputTo === "B-3")!;
		expect(b3.cell.valueState).toBe("not_reported");
	});

	it("ranks divisions, counts a record in each of its divisions, and keeps unplaced records", async () => {
		const p = await getImpactPanels5to16(DEFAULT_QUERY, ctx());
		const byName = Object.fromEntries(
			p.rankedDivisions.rows.map((r) => [r.name, r.cell]),
		);
		expect(byName.North.value).toBe(45);
		expect(byName.South.value).toBe(5);
		expect(byName["No division recorded"].valueState).toBe("zero_confirmed");
		expect(p.rankedDivisions.multiDivisionRecords).toBe(1);
		expect(p.rankedDivisions.rest).toBeNull();
	});

	it("shows by districts: records roll up to level 2, and records placed above it are counted apart", async () => {
		const p = await getImpactPanels5to16(
			{ ...DEFAULT_QUERY, showBy: 2 },
			ctx(),
		);
		const byName = Object.fromEntries(
			p.rankedDivisions.rows.map((r) => [r.name, r.cell]),
		);
		expect(byName["North East"].value).toBe(40);
		expect(byName.North).toBeUndefined();
		expect(byName["Not recorded at this level"].value).toBe(5);
	});

	it("offers the tenant's admin levels for Show by", async () => {
		expect(await showByLevels(ids.countryAccountId)).toEqual([1, 2]);
	});

	it("lists the largest record first and splits risk by the GAR rule", async () => {
		const p = await getImpactPanels5to16(DEFAULT_QUERY, ctx());
		expect(p.largestRecords.rows[0].recordId).toBe(rec.a);
		expect(p.largestRecords.rows[0].hazardLabel).toBe(
			"Meteorological and Hydrological",
		);
		expect(p.extensiveIntensive.intensiveRecords).toBe(2);
		expect(p.extensiveIntensive.intensive.value).toBe(45);
		expect(p.extensiveIntensive.extensiveRecords).toBe(1);
		expect(p.extensiveIntensive.extensive.valueState).toBe("zero_confirmed");
		expect(p.extensiveIntensive.note).toContain("1 records report neither");
	});

	it("builds the season grid, houses, completeness and disaggregation", async () => {
		const p = await getImpactPanels5to16(DEFAULT_QUERY, ctx());
		expect(p.season.cells.map((c) => [c.year, c.month])).toEqual([
			[2020, 3],
			[2020, 7],
			[2021, 5],
		]);
		expect(p.season.recordsWithoutMonth).toBe(1);
		const h1042 = p.houses.rows.find((r) => r.key === "1042")!;
		expect(h1042.destroyed.value).toBe(700);
		const deaths = p.completeness.rows.find((r) => r.key === "deaths")!;
		expect([deaths.recordsWith, deaths.recordsTotal]).toEqual([3, 4]);
		expect(p.disaggregation.rows).toEqual([
			expect.objectContaining({ dimension: "sex", category: "Female" }),
		]);
		expect(p.disaggregation.rows[0].cell.value).toBe(12);
		expect(p.disaggregation.coverage).toEqual({
			recordsWithBreakdown: 1,
			recordsTotal: 4,
		});
	});

	it("shows housing damage in the hazard by sector matrix and averages periods", async () => {
		const p = await getImpactPanels5to16(DEFAULT_QUERY, ctx());
		const col = p.hazardSector.sectors.findIndex((s) => s.label === "Housing");
		expect(col).toBeGreaterThanOrEqual(0);
		const row = p.hazardSector.rows.find((r) => r.hipTypeId === "1042")!;
		expect(row.cells[col].value).toBe(1);
		expect(p.periodChange.periodB).toEqual({ from: 2013, to: 2022, years: 10 });
		const north = p.periodChange.rows.find((r) => r.name === "North")!;
		expect(north.averageB.value).toBe(4.5);
		expect(north.averageA.valueState).toBe("not_reported");
	});

	it("feeds the map: deaths shade each division, dwellings stand as two bars, no Sendai code", async () => {
		const m = await getImpactMap(DEFAULT_QUERY, ctx());
		const by = Object.fromEntries(m.areas.map((a) => [a.name, a]));
		expect(Object.keys(by)).toEqual(["North", "South"]);
		expect(by.North.deaths.value).toBe(45);
		expect(by.South.deaths.value).toBe(5);
		expect(by.South.dwellingsDestroyed.value).toBe(700);
		expect(by.South.dwellingsDamaged.valueState).toBe("not_reported");
		expect(by.North.dwellingsDestroyed.value).toBe(700);
		expect(m.recordsWithoutDivision).toBe(2);
		expect(m.multiDivisionRecords).toBe(1);
		expect(m.legend.note).toContain("Not a Sendai indicator value");
		expect(by.North.geojson).toBeNull();
		expect(JSON.stringify(m.legend)).not.toMatch(/A-2|B-3|B-4/);
	});
});
