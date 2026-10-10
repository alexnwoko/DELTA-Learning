import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPopulationDenominator } from "~/backend.server/models/ref/denominator";
import {
	cleanupRefSources,
	cleanupRefTenants,
	createDivision,
	createRefTenant,
	createSourceRelease,
	insertValue,
	runTag,
	type RefTenant,
} from "./refFixtures";

// E1: getPopulationDenominator reads one tenant's values only, applies the
// source-status precedence on the real store, and refuses rather than
// returning 0.

const tag = runTag();
let a: RefTenant;
let b: RefTenant;
let divA: string;

describe("getPopulationDenominator on the reference store", () => {
	beforeAll(async () => {
		a = await createRefTenant();
		b = await createRefTenant();
		divA = await createDivision(a.countryAccountsId, {
			nationalId: `DIV-${tag}`,
		});
		const nso = await createSourceRelease({
			name: `NSO ${tag}`,
			sourceStatus: "official_national",
		});
		const wpp = await createSourceRelease({
			name: `WPP ${tag}`,
			sourceStatus: "international_official",
			releaseDate: "2024-07-11",
		});
		const grid = await createSourceRelease({
			name: `Grid ${tag}`,
			sourceStatus: "modelled",
		});
		// Tenant A, national 2024: WPP and a modelled value; NSO in 2025 only.
		await insertValue({
			countryAccountsId: a.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 2_000_000,
		});
		await insertValue({
			countryAccountsId: a.countryAccountsId,
			releaseId: grid.releaseId,
			sourceStatus: "modelled",
			grade: "REF-C",
			value: 2_100_000,
		});
		await insertValue({
			countryAccountsId: a.countryAccountsId,
			releaseId: nso.releaseId,
			sourceStatus: "official_national",
			grade: "REF-A",
			value: 2_050_000,
			periodStart: "2025-01-01",
			periodEnd: "2025-12-31",
		});
		// Tenant A, one division in 2024 on vintage V1; 2026 not reported.
		await insertValue({
			countryAccountsId: a.countryAccountsId,
			releaseId: grid.releaseId,
			sourceStatus: "modelled",
			grade: "REF-C",
			divisionId: divA,
			boundaryVintage: "V1",
			value: 300_000,
			method: "zonal_sum",
		});
		await insertValue({
			countryAccountsId: a.countryAccountsId,
			releaseId: grid.releaseId,
			sourceStatus: "modelled",
			grade: "REF-C",
			value: null,
			valueState: "not_reported",
			periodStart: "2026-01-01",
			periodEnd: "2026-12-31",
		});
		// Tenant B, national 2024 only.
		await insertValue({
			countryAccountsId: b.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 9_000_000,
		});
	});

	afterAll(async () => {
		await cleanupRefTenants([a, b]);
		await cleanupRefSources(tag);
	});

	it("returns each tenant's own national value", async () => {
		const ra = await getPopulationDenominator(a.countryAccountsId, {
			divisionId: null,
			year: 2024,
		});
		const rb = await getPopulationDenominator(b.countryAccountsId, {
			divisionId: null,
			year: 2024,
		});
		expect(ra.ok && ra.value).toBe(2_000_000);
		expect(ra.ok && ra.provenance.countryAccountsId).toBe(a.countryAccountsId);
		expect(rb.ok && rb.value).toBe(9_000_000);
		expect(rb.ok && rb.provenance.countryAccountsId).toBe(b.countryAccountsId);
	});

	it("prefers international official over modelled, then official national when present", async () => {
		const r2024 = await getPopulationDenominator(a.countryAccountsId, {
			divisionId: null,
			year: 2024,
		});
		expect(r2024.ok && r2024.provenance.sourceStatus).toBe(
			"international_official",
		);
		expect(r2024.ok && r2024.provenance.source.name).toBe(`WPP ${tag}`);
		expect(r2024.ok && r2024.provenance.release.releaseDate).toBe("2024-07-11");
		const r2025 = await getPopulationDenominator(a.countryAccountsId, {
			divisionId: null,
			year: 2025,
		});
		expect(r2025.ok && r2025.provenance.sourceStatus).toBe("official_national");
		expect(r2025.ok && r2025.provenance.grade).toBe("REF-A");
	});

	it("does not see another tenant's division", async () => {
		const res = await getPopulationDenominator(b.countryAccountsId, {
			divisionId: divA,
			year: 2024,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("POPULATION_MISSING_FOR_YEAR");
	});

	it("refuses a year with no value, and a year whose only value is not_reported", async () => {
		for (const year of [2023, 2026]) {
			const res = await getPopulationDenominator(a.countryAccountsId, {
				divisionId: null,
				year,
			});
			expect(res.ok).toBe(false);
			if (!res.ok) expect(res.refusal.code).toBe("POPULATION_MISSING_FOR_YEAR");
		}
	});

	it("returns the division value on its vintage and refuses another vintage", async () => {
		const ok = await getPopulationDenominator(a.countryAccountsId, {
			divisionId: divA,
			year: 2024,
			boundaryVintage: "V1",
		});
		expect(ok.ok && ok.value).toBe(300_000);
		expect(ok.ok && ok.provenance.method).toBe("zonal_sum");
		const bad = await getPopulationDenominator(a.countryAccountsId, {
			divisionId: divA,
			year: 2024,
			boundaryVintage: "V2",
		});
		expect(bad.ok).toBe(false);
		if (!bad.ok) {
			expect(bad.refusal.code).toBe("BOUNDARY_VINTAGE_MISMATCH");
			expect(bad.refusal.availableVintages).toEqual(["V1"]);
		}
	});
});
