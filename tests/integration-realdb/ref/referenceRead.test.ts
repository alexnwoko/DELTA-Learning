import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dr } from "~/db.server";
import { sql } from "drizzle-orm";
import {
	listReferenceSources,
	listReferenceValues,
	type ValuesQuery,
} from "~/backend.server/models/ref/referenceRead";
import {
	cleanupRefSources,
	cleanupRefTenants,
	createRefTenant,
	insertValue,
	runTag,
	type RefTenant,
} from "./refFixtures";

// BM-6 (FR-BAS-120, FR-BAS-180, FR-BAS-700; SEC-19; D-BM-08): the read model
// behind GET /:lang/api/reference/values and /sources.

const tag = runTag();
let a: RefTenant;
let b: RefTenant;

async function sourceRelease(rule: string, suffix = "") {
	const src = await dr.execute(sql`
		INSERT INTO ref.source (name, licence, redistribution_rule, source_status, attribution_text)
		VALUES (${`${rule}${suffix} ${tag}`}, 'CC BY 4.0', ${rule}, 'international_official', ${`Credit ${rule}`})
		RETURNING id
	`);
	const rel = await dr.execute(sql`
		INSERT INTO ref.release (source_id, source_status, version)
		VALUES (${(src.rows[0] as { id: string }).id}, 'international_official', 'v1')
		RETURNING id
	`);
	return { releaseId: (rel.rows[0] as { id: string }).id };
}

const base: ValuesQuery = {
	indicator: "POP_TOTAL",
	divisionKey: null,
	keyScheme: null,
	from: null,
	to: null,
	minGrade: null,
	includeDeprecated: false,
};

describe("reference read model", () => {
	beforeAll(async () => {
		a = await createRefTenant();
		b = await createRefTenant();
		for (const [rule, year] of [
			["display_and_redistribute", 2024],
			["display_only", 2023],
			["signed_in_only", 2022],
			["analysis_only", 2021],
		] as const) {
			const s = await sourceRelease(rule);
			await insertValue({
				countryAccountsId: a.countryAccountsId,
				releaseId: s.releaseId,
				sourceStatus: "international_official",
				value: 1000 + year,
				periodStart: `${year}-01-01`,
				periodEnd: `${year}-12-31`,
			});
		}
		const other = await sourceRelease("display_and_redistribute", " b");
		await insertValue({
			countryAccountsId: b.countryAccountsId,
			releaseId: other.releaseId,
			sourceStatus: "international_official",
			value: 9,
		});
	});

	afterAll(async () => {
		await cleanupRefTenants([a, b]);
		await cleanupRefSources(tag);
	});

	it("gives a signed-in user everything but analysis-only, and says what it withheld", async () => {
		const res = await listReferenceValues(
			a.countryAccountsId,
			base,
			"signed_in",
		);
		expect(res.values.map((v) => v.periodStart)).toEqual([
			"2022-01-01",
			"2023-01-01",
			"2024-01-01",
		]);
		expect(res.withheld).toEqual({
			count: 1,
			rules: ["analysis_only"],
			code: "REDISTRIBUTION_NOT_PERMITTED",
		});
	});

	it("gives an API key only redistributable values", async () => {
		const res = await listReferenceValues(a.countryAccountsId, base, "api_key");
		expect(res.values.map((v) => v.redistributionRule)).toEqual([
			"display_and_redistribute",
		]);
		expect(res.withheld.count).toBe(3);
		expect(res.withheld.rules).toEqual([
			"analysis_only",
			"display_only",
			"signed_in_only",
		]);
	});

	it("carries value state, grade, provenance and attribution with each value", async () => {
		const res = await listReferenceValues(a.countryAccountsId, base, "api_key");
		expect(res.values[0]).toMatchObject({
			indicator: "POP_TOTAL",
			value: 3024,
			valueState: "reported",
			grade: "REF-B",
			method: "as_published",
			boundaryVintage: "national",
			keyScheme: "iso3",
			divisionId: null,
			periodStart: "2024-01-01",
			periodEnd: "2024-12-31",
			source: {
				licence: "CC BY 4.0",
				attributionText: "Credit display_and_redistribute",
				sourceStatus: "international_official",
			},
			release: { version: "v1", deprecatedBy: null },
		});
	});

	it("never shows another tenant's values", async () => {
		const res = await listReferenceValues(
			b.countryAccountsId,
			base,
			"signed_in",
		);
		expect(res.values.map((v) => v.value)).toEqual([9]);
	});

	it("matches an iso3 key only to the tenant's own country", async () => {
		const own = await listReferenceValues(
			a.countryAccountsId,
			{ ...base, divisionKey: a.iso3, keyScheme: "iso3" },
			"signed_in",
		);
		expect(own.values).toHaveLength(3);
		const wrong = await listReferenceValues(
			a.countryAccountsId,
			{ ...base, divisionKey: "ZZZ", keyScheme: "iso3" },
			"signed_in",
		);
		expect(wrong.values).toEqual([]);
	});

	it("filters by period and grade", async () => {
		const res = await listReferenceValues(
			a.countryAccountsId,
			{ ...base, from: "2023-01-01", to: "2023-12-31" },
			"signed_in",
		);
		expect(res.values.map((v) => v.periodStart)).toEqual(["2023-01-01"]);
		const strict = await listReferenceValues(
			a.countryAccountsId,
			{ ...base, minGrade: "REF-A" },
			"signed_in",
		);
		expect(strict.values).toEqual([]);
	});

	it("reads the newest release by default and deprecated ones on request", async () => {
		const res = await dr.execute(sql`
			SELECT r.id FROM ref.release r JOIN ref.source s ON s.id = r.source_id
			WHERE s.name = ${`display_only ${tag}`}
		`);
		const old = (res.rows[0] as { id: string }).id;
		const newer = await sourceRelease("display_only", " 2");
		await dr.execute(
			sql`UPDATE ref.release SET deprecated_by = ${newer.releaseId} WHERE id = ${old}`,
		);
		const current = await listReferenceValues(
			a.countryAccountsId,
			base,
			"signed_in",
		);
		expect(current.values.map((v) => v.periodStart)).not.toContain(
			"2023-01-01",
		);
		const all = await listReferenceValues(
			a.countryAccountsId,
			{ ...base, includeDeprecated: true },
			"signed_in",
		);
		expect(all.values.map((v) => v.periodStart)).toContain("2023-01-01");
	});

	it("lists sources with their licence and rule, never excluded ones", async () => {
		await dr.execute(sql`
			INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
			VALUES (${`excluded ${tag}`}, 'CC BY-NC', 'excluded', 'modelled')
		`);
		const names = (await listReferenceSources()).map((s) => s.name);
		expect(names).toContain(`analysis_only ${tag}`);
		expect(names).not.toContain(`excluded ${tag}`);
	});
});
