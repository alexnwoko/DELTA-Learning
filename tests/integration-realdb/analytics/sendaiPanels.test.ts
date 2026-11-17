import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getSendaiSection } from "~/backend.server/models/analytics/dashboard/sendaiPanels.server";
import { SECTOR_IDS } from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";
import { clearDashboardCache } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";

// Sendai section against seeded records:
// a: 2020, type 1042, 40 deaths, 2 missing, 700 dwellings destroyed, 3 hospitals in the source
// b: 2021, type 1037, 5 injured, health flag with damage, an untyped money value

const HOUSE_ASSET = "e2f26abf-a73c-4149-9bc7-fbed4eaa148f";
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-sendai@");
const rec = { a: randomUUID(), b: randomUUID() };

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getSendaiSection", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id, legacy_data) VALUES
			(${rec.a}, ${ids.countryAccountId}, 'published', '2020-03-01', '1042', '{"nhospitales":"3"}'::jsonb),
			(${rec.b}, ${ids.countryAccountId}, 'published', '2021-05-01', '1037', '{"valorus":"1000"}'::jsonb)`);
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, deaths, deaths_total, missing, missing_total, injured, injured_total) VALUES
			(${rec.a}, true, 40, true, 2, NULL, NULL),
			(${rec.b}, NULL, NULL, NULL, NULL, true, 5)`);
		await dr.execute(sql`
			INSERT INTO damages (record_id, sector_id, asset_id, unit, td_damage_amount)
			VALUES (${rec.a}, ${SECTOR_IDS.housing}, ${HOUSE_ASSET}, 'number_count', 700)`);
		await dr.execute(sql`
			INSERT INTO sector_disaster_records_relation (sector_id, disaster_record_id, with_damage)
			VALUES (${SECTOR_IDS.health}, ${rec.b}, true)`);
	});

	afterAll(async () => {
		const all = sql.join(
			Object.values(rec).map((r) => sql`${r}`),
			sql`, `,
		);
		await dr.execute(sql`DELETE FROM damages WHERE record_id IN (${all})`);
		await dr.execute(
			sql`DELETE FROM sector_disaster_records_relation WHERE disaster_record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("fills S0 with codes and the coverage line on the national view", async () => {
		const s = await getSendaiSection(DEFAULT_QUERY, ctx());
		expect(s.nationalOnly).toBe(true);
		const by = Object.fromEntries(
			s.s0.indicators.map((i) => [i.code, i.cell.value]),
		);
		expect(by).toEqual({ "A-2": 40, "A-3": 2, "B-2": 5 });
		expect(s.s0.inputs.find((i) => i.inputTo === "B-4")?.cell.value).toBe(700);
		expect(s.s0.inputs.find((i) => i.inputTo === "B-3")?.cell.valueState).toBe(
			"not_reported",
		);
		expect(s.coverage).toEqual({ recordsWith: 2, recordsTotal: 2 });
	});

	it("gives the year, hazard and dwelling slots", async () => {
		const s = await getSendaiSection(DEFAULT_QUERY, ctx());
		expect(s.a1.years.map((y) => [y.year, y.deaths.value])).toEqual([
			[2020, 40],
			[2021, null],
		]);
		expect(s.a1.reference).toMatchObject({ from: 2020, to: 2021, years: 2 });
		expect(s.a1.reference?.deaths.value).toBe(20);
		expect(s.a2.rows[0]).toMatchObject({
			hipTypeId: "1042",
			label: "Meteorological and Hydrological",
		});
		expect(s.b1.injured.map((y) => y.cell.value)).toEqual([null, 5]);
		expect(s.b2.rows.map((r) => [r.year, r.destroyed.value])).toEqual([
			[2020, 700],
			[2021, null],
		]);
		expect(s.b2.rows[1].destroyed.valueState).toBe("not_reported");
	});

	it("keeps money, facilities and disruption as gaps with their counts", async () => {
		const s = await getSendaiSection(DEFAULT_QUERY, ctx());
		expect(s.c1.gap.code).toBe("G-06");
		expect(s.c1.untypedMoneyRecords).toBe(1);
		expect(s.d1.gap.code).toBe("G-22");
		expect(
			s.d1.sourceFields.find((f) => f.field === "nhospitales")?.records,
		).toBe(1);
		expect(s.d2.gap.code).toBe("G-08");
		const col = s.c2.sectors.findIndex((x) => x.label === "Health");
		expect(s.c2.rows.find((r) => r.decade === 2020)?.cells[col].value).toBe(1);
	});

	it("drops every code under a place filter (TR-060)", async () => {
		const s = await getSendaiSection(
			{ ...DEFAULT_QUERY, where: { geo: { divisionId: randomUUID() } } },
			ctx(),
		);
		expect(s.nationalOnly).toBe(false);
		expect(s.s0.indicators.every((i) => i.code === null)).toBe(true);
		expect(s.s0.inputs.every((i) => i.inputTo === null)).toBe(true);
		expect(s.s0.refused.every((r) => r.code === null)).toBe(true);
		expect(s.meta.s0.method).toContain("Not a Sendai indicator value");
	});

	it("computes A-1 per year where a population figure is held, and says why where it is not", async () => {
		const name = `A-1 test population ${randomUUID().slice(0, 8)}`;
		const src = await dr.execute(sql`
			INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
			VALUES (${name}, 'CC BY 3.0 IGO', 'display_and_redistribute', 'international_official') RETURNING id`);
		const sourceId = (src.rows[0] as { id: string }).id;
		const rel = await dr.execute(sql`
			INSERT INTO ref.release (source_id, source_status, version) VALUES (${sourceId}, 'international_official', 'T1') RETURNING id`);
		const releaseId = (rel.rows[0] as { id: string }).id;
		await dr.execute(sql`
			INSERT INTO ref.value (country_accounts_id, division_id, key_scheme, boundary_vintage, indicator_code,
				quantity_type, release_id, source_status, period_start, period_end, value, value_state, method, grade)
			VALUES (${ids.countryAccountId}, NULL, 'iso3', 'national', 'POP_TOTAL', 'extensive', ${releaseId},
				'international_official', '2020-01-01', '2020-12-31', 1000000, 'reported', 'as_published', 'REF-B')`);
		clearDashboardCache(ids.countryAccountId);
		try {
			const p = await getSendaiSection(DEFAULT_QUERY, ctx());
			const y2020 = p.a1.years.find((y) => y.year === 2020)!;
			expect(y2020.rate).toMatchObject({ value: 4.2, valueState: "reported", refusal: null, per: 100000 });
			expect(y2020.rate!.denominator).toMatchObject({ year: 2020, value: 1000000, source: name, release: "T1" });
			const y2021 = p.a1.years.find((y) => y.year === 2021)!;
			expect(y2021.rate!.value).toBeNull();
			expect(y2021.rate!.refusal).toBeTruthy();
			const refused = p.s0.refused.map((r) => r.code);
			expect(refused).not.toContain("A-1");
			expect(refused).toContain("B-1");
			// Each refusal reason is distinct (one note per reason on screen).
			const reasons = p.s0.refused.map((r) => r.reason);
			expect(new Set(reasons).size).toBe(reasons.length);
		} finally {
			await dr.execute(sql`DELETE FROM ref.value WHERE release_id = ${releaseId}`);
			await dr.execute(sql`DELETE FROM ref.release WHERE id = ${releaseId}`);
			await dr.execute(sql`DELETE FROM ref.source WHERE id = ${sourceId}`);
			clearDashboardCache(ids.countryAccountId);
		}
	});

	it("lists each refusal reason once, so no note repeats on screen", async () => {
		const p = await getSendaiSection(DEFAULT_QUERY, ctx());
		const reasons = p.s0.refused.map((r) => r.reason);
		expect(new Set(reasons).size).toBe(reasons.length);
	});
});
