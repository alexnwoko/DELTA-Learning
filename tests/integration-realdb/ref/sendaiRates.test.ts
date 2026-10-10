import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	A1_METHOD,
	AFFECTED_DIRECT_METHOD,
	sendaiRatesForYear,
} from "~/backend.server/models/ref/rates";
import {
	cleanupRefSources,
	cleanupRefTenants,
	createRefTenant,
	createSourceRelease,
	insertValue,
	runTag,
	type RefTenant,
} from "./refFixtures";

// E1: national A-1 and the DELTA affected-direct analytical rate (not
// Sendai B-1) on a fixture. Published records only (official
// basis), attributed to their start year; a missing population is refused;
// not-reported deaths stay null.

const tag = runTag();
let t: RefTenant;

async function record(opts: {
	status: string;
	start: string | null;
	presence?: string;
}) {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
		VALUES (${id}, ${t.countryAccountsId}, ${opts.status}, ${opts.start})
	`);
	if (opts.presence) {
		const cols = opts.presence.split(", ").map((c) => c.split(" = "));
		await dr.execute(sql`
			INSERT INTO human_category_presence (record_id, ${sql.raw(cols.map((c) => c[0]).join(", "))})
			VALUES (${id}, ${sql.raw(cols.map((c) => c[1]).join(", "))})
		`);
	}
	return id;
}

describe("sendaiRatesForYear", () => {
	beforeAll(async () => {
		t = await createRefTenant();
		const wpp = await createSourceRelease({
			name: `WPP ${tag}`,
			sourceStatus: "international_official",
		});
		for (const year of [2024, 2025]) {
			await insertValue({
				countryAccountsId: t.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 2_000_000,
				periodStart: `${year}-01-01`,
				periodEnd: `${year}-12-31`,
			});
		}
		// 2024: two published records, one draft (excluded), one record
		// starting in 2023 and ending in 2024 (not 2024), one undated.
		await record({
			status: "published",
			start: "2024-03-01",
			presence:
				"deaths = true, deaths_total = 30, missing = true, missing_total = 10, affected_direct = true, affected_direct_total = 400",
		});
		await record({
			status: "published",
			start: "2024",
			presence:
				"deaths = true, deaths_total = 10, affected_direct = true, affected_direct_total = 100",
		});
		await record({
			status: "draft",
			start: "2024-05-05",
			presence:
				"deaths = true, deaths_total = 1000, missing = true, missing_total = 1000",
		});
		await record({
			status: "published",
			start: "2023-12-20",
			presence: "deaths = true, deaths_total = 7",
		});
		await record({
			status: "published",
			start: null,
			presence: "deaths = true, deaths_total = 9",
		});
		// 2025: a published record with no human-effects figures.
		await record({ status: "published", start: "2025-06-01" });
		// 2023 has a record but no population.
	});

	afterAll(async () => {
		await cleanupRefTenants([t]);
		await cleanupRefSources(tag);
	});

	it("computes A-1 from published records only, with both provenances", async () => {
		const res = await sendaiRatesForYear(t.countryAccountsId, 2024);
		expect(res.audience).toBe("official");
		expect(res.a1.ok).toBe(true);
		if (!res.a1.ok) return;
		// (30 + 10 deaths, 10 missing) / 2,000,000 x 100,000 = 2.5
		expect(res.a1.value).toBeCloseTo(2.5, 10);
		expect(res.a1.valueState).toBe("reported");
		expect(res.a1.method).toBe(A1_METHOD);
		const components = res.a1.numerator.provenance.components as any;
		expect(components.deaths.value).toBe(40);
		expect(components.deaths.recordsTotal).toBe(2);
		expect(components.missing.value).toBe(10);
		expect(res.a1.denominator.provenance.source.name).toBe(`WPP ${tag}`);
		expect(res.a1.denominator.year).toBe(2024);
		// The undated record is never in a year; it is reported apart.
		expect(res.undated.records).toBe(1);
		expect(res.undated.measures.deaths.value).toBe(9);
	});

	it("computes the affected-direct analytical rate (not B-1)", async () => {
		const res = await sendaiRatesForYear(t.countryAccountsId, 2024);
		expect(res.affected_direct_per_100k.ok).toBe(true);
		if (!res.affected_direct_per_100k.ok) return;
		expect(res.affected_direct_per_100k.method).toBe(AFFECTED_DIRECT_METHOD);
		// 500 / 2,000,000 x 100,000 = 25
		expect(res.affected_direct_per_100k.value).toBeCloseTo(25, 10);
	});

	it("refuses A-1 and the affected-direct rate when the population for the year is missing", async () => {
		const res = await sendaiRatesForYear(t.countryAccountsId, 2023);
		expect(res.denominator.ok).toBe(false);
		expect(res.a1.ok).toBe(false);
		expect(res.affected_direct_per_100k.ok).toBe(false);
		if (!res.a1.ok) {
			expect(res.a1.refusal.code).toBe("POPULATION_MISSING_FOR_YEAR");
		}
		expect((res.a1 as any).value).toBeUndefined();
	});

	it("keeps not-reported deaths null, never 0", async () => {
		const res = await sendaiRatesForYear(t.countryAccountsId, 2025);
		expect(res.a1.ok).toBe(true);
		if (!res.a1.ok) return;
		expect(res.a1.value).toBeNull();
		expect(res.a1.valueState).toBe("not_reported");
		const components = res.a1.numerator.provenance.components as any;
		expect(components.deaths.value).toBeNull();
		expect(components.deaths.recordsNotReported).toBe(1);
		expect(
			res.affected_direct_per_100k.ok && res.affected_direct_per_100k.value,
		).toBeNull();
	});
});
