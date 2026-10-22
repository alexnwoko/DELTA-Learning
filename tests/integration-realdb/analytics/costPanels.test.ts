import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createRefTenant,
	insertValue,
	cleanupRefTenants,
	type RefTenant,
} from "../ref/refFixtures";
import { getCostPanels } from "~/backend.server/models/analytics/dashboard/costPanels.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// A test country in Ethiopian birr, 50 ETB per USD in 2020 (no rate for 2019).
// Flooding records:
//  r1 2020 valorloc 5000, 10 directly affected  -> 100 USD
//  r2 2020 valorus 200 only, 20 directly affected -> 200 USD, 10,000 ETB
//  r3 2020 valorloc = valorus = 300 (a copy)       -> local refused; 300 USD from the source
//  r4 2019 valorloc 100 (no rate)                  -> not costed
//  r5 2020 no money, 1,000 directly affected       -> not costed
let t: RefTenant;
const tag = randomUUID().slice(0, 8);
let sourceId = "";
const ctx = () => ({
	countryAccountsId: t.countryAccountsId,
	audience: "public" as const,
	tenantName: "Ref",
	provisional: false,
});

describe("getCostPanels", () => {
	beforeAll(async () => {
		t = await createRefTenant();
		await dr.execute(
			sql`INSERT INTO instance_system_settings (country_accounts_id, currency_code) VALUES (${t.countryAccountsId}, 'ETB')`,
		);
		const src = await dr.execute(sql`
			INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
			VALUES (${`FX test ${tag}`}, 'CC BY 4.0', 'display_and_redistribute', 'international_official') RETURNING id`);
		sourceId = (src.rows[0] as { id: string }).id;
		const rel = await dr.execute(
			sql`INSERT INTO ref.release (source_id, source_status, version) VALUES (${sourceId}, 'international_official', 'T1') RETURNING id`,
		);
		const releaseId = (rel.rows[0] as { id: string }).id;
		await insertValue({
			countryAccountsId: t.countryAccountsId,
			releaseId,
			sourceStatus: "international_official",
			value: 50,
			indicatorCode: "FX_LCU_PER_USD",
			quantityType: "intensive",
			periodStart: "2020-01-01",
			periodEnd: "2020-12-31",
		});
		const recs: [string, Record<string, string> | null, number | null][] = [
			["2020-03-01", { valorloc: "5000" }, 10],
			["2020-04-01", { valorus: "200" }, 20],
			["2020-05-01", { valorloc: "300", valorus: "300" }, null],
			["2019-05-01", { valorloc: "100" }, null],
			["2020-06-01", null, 1000],
		];
		for (const [start, legacy, ppl] of recs) {
			const id = randomUUID();
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_hazard_id, legacy_data)
				VALUES (${id}, ${t.countryAccountsId}, 'published', ${start}, '94492', ${legacy ? JSON.stringify(legacy) : null}::jsonb)`);
			if (ppl !== null)
				await dr.execute(
					sql`INSERT INTO human_category_presence (record_id, affected_direct, affected_direct_total) VALUES (${id}, true, ${ppl})`,
				);
		}
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM instance_system_settings WHERE country_accounts_id = ${t.countryAccountsId}`,
		);
		await cleanupRefTenants([t]);
		await dr.execute(
			sql`DELETE FROM ref.release WHERE source_id = ${sourceId}`,
		);
		await dr.execute(sql`DELETE FROM ref.source WHERE id = ${sourceId}`);
	});

	it("shows values in the country's currency and in US dollars, with the disclaimer", async () => {
		const p = await getCostPanels(DEFAULT_QUERY, ctx());
		expect(p.currency).toEqual({ code: "ETB", name: "Ethiopian Birr" });
		expect(p.total).toEqual({ local: 30000, usd: 600, records: 3 });
		expect(p.disclaimer).toContain("Ethiopian Birr (ETB)");
		expect(p.disclaimer).toContain("Not a Sendai C-1 value");
		expect(p.disclaimer).toContain(
			"one rate only: the World Bank official exchange rate",
		);
		expect(p.fxRate.indicator).toBe("PA.NUS.FCRF");
	});

	it("measures how much is costed and who the uncosted records affected", async () => {
		const p = await getCostPanels(DEFAULT_QUERY, ctx());
		expect(p.coverage.records).toEqual({ total: 5, costed: 3, notCosted: 2 });
		expect(p.coverage.people.costed.value).toBe(30);
		expect(p.coverage.people.notCosted.value).toBe(1000);
		expect(p.coverage.costPerPerson).toEqual({
			local: 500,
			usd: 10,
			records: 2,
		});
		expect(p.excluded).toEqual({
			beforeCurrencyChange: 0,
			copiedFromUsd: 1,
			noRate: 1,
		});
	});

	it("gives costs by hazard and holds back the projection under 10 records", async () => {
		const p = await getCostPanels(DEFAULT_QUERY, ctx());
		const flood = p.byHazard.find((r) => r.key === "94492")!;
		expect(flood).toMatchObject({
			label: "Flooding",
			costedRecords: 3,
			notCostedRecords: 2,
		});
		expect(flood.total).toEqual({ local: 30000, usd: 600 });
		expect(flood.medianPerPerson.usd).toBeNull();
		expect(flood.projectionNotCosted).toBeNull();
		expect(p.projectionNote).toContain("Not a loss estimate");
	});
});
