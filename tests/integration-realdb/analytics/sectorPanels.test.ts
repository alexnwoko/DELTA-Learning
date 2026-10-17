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
	getSectorPanels1to7,
	SECTOR_IDS,
} from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// D1 Sectors view panels 1 to 7 against seeded records:
// a: 2020, type 1042, 700 dwellings destroyed (Housing)
// b: 2020, type 1042, health flag with damage, losses not recorded
// c: 2021, type 1037, industry flag with damage and losses
// d: 2022, no type, no sector effect

const HOUSE_ASSET = "e2f26abf-a73c-4149-9bc7-fbed4eaa148f";
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-sectorpanels@");
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

describe("getSectorPanels1to7", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const recs: [string, string, string | null][] = [
			[rec.a, "2020-03-01", "1042"],
			[rec.b, "2020-07-01", "1042"],
			[rec.c, "2021-05-01", "1037"],
			[rec.d, "2022", null],
		];
		for (const [id, start, type] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${type})`);
		}
		await dr.execute(sql`
			INSERT INTO damages (record_id, sector_id, asset_id, unit, td_damage_amount)
			VALUES (${rec.a}, ${SECTOR_IDS.housing}, ${HOUSE_ASSET}, 'number_count', 700)`);
		await dr.execute(sql`
			INSERT INTO sector_disaster_records_relation (sector_id, disaster_record_id, with_damage, with_losses)
			VALUES (${SECTOR_IDS.health}, ${rec.b}, true, NULL),
				(${SECTOR_IDS.industry}, ${rec.c}, true, true)`);
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
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("gives headline tiles with damage and losses apart, and money as G-06", async () => {
		const p = await getSectorPanels1to7(DEFAULT_QUERY, ctx());
		expect(p.empty).toBeNull();
		expect(p.headline.recordsAnySector.value).toBe(3);
		expect(p.headline.sectorsLinked.linked).toBe(3);
		expect(p.headline.dwellingsDestroyed.value).toBe(700);
		expect(p.headline.dwellingsDamaged.valueState).toBe("not_reported");
		expect(p.headline.losses.value).toBe(1);
		expect(p.headline.money.code).toBe("G-06");
	});

	it("lists every level-2 sector, with unlinked sectors as not reported, never 0", async () => {
		const p = await getSectorPanels1to7(DEFAULT_QUERY, ctx());
		const all = p.reporting.groups.flatMap((g) => g.rows);
		expect(all).toHaveLength(20);
		const by = Object.fromEntries(all.map((r) => [r.sector.label, r.records]));
		expect(by.Health.value).toBe(1);
		expect(by.Agriculture.value).toBeNull();
		expect(by.Agriculture.valueState).toBe("not_reported");
		const health = p.effectTypes.rows.find((r) => r.sector.label === "Health")!;
		expect(health.losses.valueState).toBe("not_reported");
		expect(health.damageMoney.code).toBe("G-06");
	});

	it("builds hazard by sector, sector by year and dwellings", async () => {
		const p = await getSectorPanels1to7(DEFAULT_QUERY, ctx());
		const col = p.hazardBySector.sectors.findIndex(
			(s) => s.label === "Industry",
		);
		const row = p.hazardBySector.rows.find((r) => r.hipTypeId === "1037")!;
		expect(row.cells[col].value).toBe(1);
		const housing = p.byYear.series.find((s) => s.sector.label === "Housing")!;
		expect(housing.years.map((y) => [y.year, y.records.value])).toEqual([
			[2020, 1],
		]);
		const d1042 = p.dwellings.rows.find((r) => r.key === "1042")!;
		expect(d1042.destroyed.value).toBe(700);
	});

	it("says no records are in scope instead of drawing zeros", async () => {
		const p = await getSectorPanels1to7(
			{ ...DEFAULT_QUERY, where: { hazard: { typeId: "1041" } } },
			ctx(),
		);
		expect(p.empty?.reason).toBe("No records in scope for these filters.");
	});

	it("drops Sendai codes under a place filter (TR-060)", async () => {
		const national = await getSectorPanels1to7(DEFAULT_QUERY, ctx());
		expect(national.sendai.rows.map((r) => r.code)).toContain("C-4");
		const c4 = national.sendai.rows.find((r) => r.code === "C-4")!;
		expect([c4.held?.value, c4.status]).toEqual([700, "MONEY"]);
		const sub = await getSectorPanels1to7(
			{ ...DEFAULT_QUERY, where: { geo: { divisionId: randomUUID() } } },
			ctx(),
		);
		expect(sub.sendai.nationalOnly).toBe(false);
		expect(sub.sendai.rows.every((r) => r.code === null)).toBe(true);
	});
});
