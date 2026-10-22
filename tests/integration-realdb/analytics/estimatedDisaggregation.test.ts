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
import {
	ESTIMATE_REFERENCE,
	getEstimatedDisaggregation,
} from "~/backend.server/models/analytics/dashboard/estimatedDisaggregation.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// A test country whose 2020 structure is 1,000 people: per sex, 100 aged 0-4,
// 300 aged 30-34, 100 aged 70-74. Records: one 2020 record with 1,000
// directly affected (used); one Biological; one under review (flagged); one
// from 1940; one from 2021 (no structure that year).
let t: RefTenant;
let sourceId: string | null = null;
const ctx = () => ({ countryAccountsId: t.countryAccountsId, audience: "public" as const, tenantName: "Ref", provisional: false });

describe("getEstimatedDisaggregation", () => {
	beforeAll(async () => {
		t = await createRefTenant();
		const existing = await dr.execute(sql`SELECT id FROM ref.source WHERE name = ${ESTIMATE_REFERENCE.source}`);
		let releaseId: string;
		if (existing.rows.length) {
			const rel = await dr.execute(sql`SELECT id FROM ref.release WHERE source_id = ${(existing.rows[0] as { id: string }).id} AND version = ${ESTIMATE_REFERENCE.release}`);
			releaseId = (rel.rows[0] as { id: string }).id;
		} else {
			const src = await dr.execute(sql`
				INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
				VALUES (${ESTIMATE_REFERENCE.source}, ${ESTIMATE_REFERENCE.licence}, 'display_and_redistribute', 'international_official') RETURNING id`);
			sourceId = (src.rows[0] as { id: string }).id;
			const rel = await dr.execute(sql`
				INSERT INTO ref.release (source_id, source_status, version) VALUES (${sourceId}, 'international_official', ${ESTIMATE_REFERENCE.release}) RETURNING id`);
			releaseId = (rel.rows[0] as { id: string }).id;
		}
		for (const [code, v] of [["00_04", 100], ["30_34", 300], ["70_74", 100]] as const) {
			for (const sex of ["F", "M"]) {
				await insertValue({ countryAccountsId: t.countryAccountsId, releaseId, sourceStatus: "international_official", value: v, indicatorCode: `POP_${sex}_${code}`, periodStart: "2020-01-01", periodEnd: "2020-12-31" });
			}
		}
		const recs: [string, string, string | null, number, boolean][] = [
			["2020-05-01", "used", "1042", 1000, false],
			["2020-06-01", "bio", "1037", 500, false],
			["2020-07-01", "flag", "1042", 400, true],
			["1940-01-01", "old", "1042", 50, false],
			["2021-01-01", "noref", "1042", 10, false],
		];
		for (const [start, , type, aff, flagged] of recs) {
			const id = randomUUID();
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id, legacy_data)
				VALUES (${id}, ${t.countryAccountsId}, 'published', ${start}, ${type},
					${flagged ? JSON.stringify({ migration: { plausibility_flags: [{ code: "IMPLAUSIBLE_MAGNITUDE", fields: ["damnificados"] }] } }) : null}::jsonb)`);
			await dr.execute(sql`INSERT INTO human_category_presence (record_id, affected_direct, affected_direct_total) VALUES (${id}, true, ${aff})`);
		}
	});

	afterAll(async () => {
		await cleanupRefTenants([t]);
		if (sourceId) {
			await dr.execute(sql`DELETE FROM ref.release WHERE source_id = ${sourceId}`);
			await dr.execute(sql`DELETE FROM ref.source WHERE id = ${sourceId}`);
		}
	});

	it("splits people directly affected by the country's sex and age structure for the record's year", async () => {
		const p = await getEstimatedDisaggregation(DEFAULT_QUERY, ctx());
		expect(p.refused).toBeNull();
		expect(p.measure).toBe("affected_direct");
		expect(p.baseTotal).toBe(1000);
		expect(p.recordsUsed).toBe(1);
		const b = Object.fromEntries(p.bands.map((x) => [x.band, [x.female.value, x.male.value]]));
		expect(b).toEqual({ "0-14": [100, 100], "15-64": [300, 300], "65+": [100, 100] });
		expect(p.female).toEqual({ value: 500, state: "estimated" });
		expect(p.groups.find((g) => g.group === "30-34")!.female.value).toBe(300);
	});

	it("counts what it leaves out, and labels the result as an estimate not for targeting", async () => {
		const p = await getEstimatedDisaggregation(DEFAULT_QUERY, ctx());
		expect(p.excluded).toEqual({ biological: 1, underReview: 1, noYear: 0, before1950: 1, noReference: 1 });
		expect(p.notForTargeting).toBe(true);
		expect(p.footnote).toContain("Estimated");
		expect(p.footnote).toContain("not for targeting");
		expect(p.reference).toEqual(ESTIMATE_REFERENCE);
	});

	it("refuses deaths: every cell suppressed, with the reason", async () => {
		const p = await getEstimatedDisaggregation({ ...DEFAULT_QUERY, measure: "deaths" }, ctx());
		expect(p.refused?.measure).toBe("deaths");
		expect(p.baseTotal).toBeNull();
		expect(p.bands.every((x) => x.female.state === "suppressed" && x.female.value === null)).toBe(true);
	});

	it("falls back to people indirectly affected when a country records only that (Sri Lanka's case)", async () => {
		const t2 = await createRefTenant();
		const rel = await dr.execute(sql`
			SELECT rl.id FROM ref.release rl JOIN ref.source s ON s.id = rl.source_id
			WHERE s.name = ${ESTIMATE_REFERENCE.source} AND rl.version = ${ESTIMATE_REFERENCE.release}`);
		const releaseId = (rel.rows[0] as { id: string }).id;
		try {
			for (const [code, v] of [["00_04", 200], ["30_34", 300]] as const) {
				for (const sex of ["F", "M"]) {
					await insertValue({ countryAccountsId: t2.countryAccountsId, releaseId, sourceStatus: "international_official", value: v, indicatorCode: `POP_${sex}_${code}`, periodStart: "2020-01-01", periodEnd: "2020-12-31" });
				}
			}
			const id = randomUUID();
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id)
				VALUES (${id}, ${t2.countryAccountsId}, 'published', '2020-05-01', '1042')`);
			await dr.execute(sql`INSERT INTO human_category_presence (record_id, affected_indirect, affected_indirect_total) VALUES (${id}, true, 1000)`);
			const p = await getEstimatedDisaggregation(DEFAULT_QUERY, { ...ctx(), countryAccountsId: t2.countryAccountsId });
			expect(p.measure).toBe("affected_indirect");
			expect(p.baseTotal).toBe(1000);
			expect(p.bands.find((b) => b.band === "0-14")!.female.value).toBe(200);
			expect(p.footnote).toContain("indirectly");
		} finally {
			await cleanupRefTenants([t2]);
		}
	});
});
