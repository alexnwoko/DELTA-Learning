import { describe, it, expect } from "vitest";
import {
	choosePopulationDenominator,
	type PopulationCandidate,
} from "~/backend.server/models/ref/denominator";

const TENANT = "11111111-1111-1111-1111-111111111111";

let n = 0;
function cand(over: Partial<PopulationCandidate> = {}): PopulationCandidate {
	n += 1;
	return {
		valueId: `v${n}`,
		indicatorCode: "POP_TOTAL",
		countryAccountsId: TENANT,
		divisionId: null,
		keyScheme: "iso3",
		boundaryVintage: "national",
		periodStart: "2024-01-01",
		periodEnd: "2024-12-31",
		value: 1_000_000,
		valueState: "reported",
		lowerBound: null,
		upperBound: null,
		intervalType: null,
		method: "as_published",
		grade: "REF-B",
		sourceStatus: "international_official",
		sourceId: "s1",
		sourceName: "UN WPP 2024",
		sourceProvider: "UN DESA",
		licence: "CC BY 3.0 IGO",
		redistributionRule: "display_and_redistribute",
		attributionText: null,
		rdlsId: null,
		releaseId: `r${n}`,
		releaseVersion: "2024",
		releaseDate: "2024-07-11",
		releaseDeprecatedBy: null,
		releaseCreatedAt: "2026-10-10T09:00:00.000000",
		...over,
	};
}

const national = { divisionId: null, year: 2024 };

describe("choosePopulationDenominator precedence", () => {
	it("prefers official national over international official over modelled", () => {
		const wpp = cand({ value: 2, sourceStatus: "international_official" });
		const grid = cand({ value: 3, sourceStatus: "modelled", grade: "REF-C" });
		const nso = cand({
			value: 1,
			sourceStatus: "official_national",
			grade: "REF-A",
		});
		const res = choosePopulationDenominator([grid, wpp, nso], TENANT, national);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value).toBe(1);
			expect(res.provenance.sourceStatus).toBe("official_national");
		}
		const noNso = choosePopulationDenominator([grid, wpp], TENANT, national);
		expect(noNso.ok && noNso.value).toBe(2);
	});

	it("within a source status, prefers the better grade", () => {
		const c = cand({ value: 3, sourceStatus: "modelled", grade: "REF-C" });
		const d = cand({ value: 4, sourceStatus: "modelled", grade: "REF-D" });
		const res = choosePopulationDenominator([d, c], TENANT, national);
		expect(res.ok && res.provenance.grade).toBe("REF-C");
	});

	it("within a grade, prefers a value raked to the official total", () => {
		const zonal = cand({
			value: 5,
			sourceStatus: "modelled",
			grade: "REF-C",
			method: "zonal_sum",
			releaseDate: "2025-01-01",
		});
		const raked = cand({
			value: 6,
			sourceStatus: "modelled",
			grade: "REF-C",
			method: "raked_to_official",
			releaseDate: "2024-01-01",
		});
		const res = choosePopulationDenominator([zonal, raked], TENANT, national);
		expect(res.ok && res.provenance.method).toBe("raked_to_official");
	});

	it("within status and grade, prefers the latest release", () => {
		const older = cand({ value: 10, releaseDate: "2022-07-11" });
		const newer = cand({ value: 11, releaseDate: "2024-07-11" });
		const undated = cand({ value: 12, releaseDate: null });
		const res = choosePopulationDenominator(
			[older, undated, newer],
			TENANT,
			national,
		);
		expect(res.ok && res.value).toBe(11);
	});

	it("puts a deprecated release after a current one", () => {
		const dep = cand({
			value: 20,
			releaseDate: "2025-01-01",
			releaseDeprecatedBy: "rX",
		});
		const cur = cand({ value: 21, releaseDate: "2024-01-01" });
		const res = choosePopulationDenominator([dep, cur], TENANT, national);
		expect(res.ok && res.value).toBe(21);
	});

	it("returns full provenance with the value", () => {
		const c = cand({ value: 36_000_000 });
		const res = choosePopulationDenominator([c], TENANT, national);
		expect(res).toMatchObject({
			ok: true,
			year: 2024,
			value: 36_000_000,
			provenance: {
				indicatorCode: "POP_TOTAL",
				divisionId: null,
				boundaryVintage: "national",
				periodStart: "2024-01-01",
				periodEnd: "2024-12-31",
				method: "as_published",
				grade: "REF-B",
				sourceStatus: "international_official",
				source: { name: "UN WPP 2024", licence: "CC BY 3.0 IGO" },
				release: { version: "2024", releaseDate: "2024-07-11" },
			},
		});
	});
});

describe("choosePopulationDenominator refusals", () => {
	it("refuses DENOMINATOR_MISSING when no period covers the year", () => {
		const c = cand({ periodStart: "2023-01-01", periodEnd: "2023-12-31" });
		const res = choosePopulationDenominator([c], TENANT, national);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("DENOMINATOR_MISSING");
	});

	it("never turns a not_reported value into 0: it refuses", () => {
		const c = cand({ value: null, valueState: "not_reported" });
		const res = choosePopulationDenominator([c], TENANT, national);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("DENOMINATOR_MISSING");
		expect((res as any).value).toBeUndefined();
	});

	it("refuses an empty candidate list", () => {
		const res = choosePopulationDenominator([], TENANT, national);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("DENOMINATOR_MISSING");
	});

	it("ignores another tenant's or another division's value", () => {
		const other = cand({
			countryAccountsId: "22222222-2222-2222-2222-222222222222",
		});
		const div = cand({ divisionId: "33333333-3333-3333-3333-333333333333" });
		const res = choosePopulationDenominator([other, div], TENANT, national);
		expect(res.ok).toBe(false);
	});

	it("refuses BOUNDARY_VINTAGE_MISMATCH when only other vintages hold a value", () => {
		const c = cand({ boundaryVintage: "AGO-2014" });
		const res = choosePopulationDenominator([c], TENANT, {
			...national,
			boundaryVintage: "AGO-2026",
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.refusal.code).toBe("BOUNDARY_VINTAGE_MISMATCH");
			expect(res.refusal.availableVintages).toEqual(["AGO-2014"]);
		}
	});

	it("uses the value on the requested vintage even when another ranks higher", () => {
		const nsoOld = cand({
			value: 1,
			boundaryVintage: "AGO-2014",
			sourceStatus: "official_national",
			grade: "REF-A",
		});
		const wppNew = cand({ value: 2, boundaryVintage: "AGO-2026" });
		const res = choosePopulationDenominator([nsoOld, wppNew], TENANT, {
			...national,
			boundaryVintage: "AGO-2026",
		});
		expect(res.ok && res.value).toBe(2);
	});
});

// SME round 1 (DRR-02, GEO-02): FR-BAS-700 and FR-BAS-610.
describe("choosePopulationDenominator release and vintage rules", () => {
	it("never uses a deprecated release, even when it is the only one", () => {
		const old = cand({ releaseDeprecatedBy: "r-new", value: 900_000 });
		const res = choosePopulationDenominator([old], TENANT, national);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("DENOMINATOR_MISSING");
	});

	it("uses the current release when a deprecated one also covers the year", () => {
		const old = cand({ releaseDeprecatedBy: "r-new", value: 900_000 });
		const cur = cand({ value: 1_000_000 });
		const res = choosePopulationDenominator([old, cur], TENANT, national);
		expect(res.ok && res.value).toBe(1_000_000);
	});

	it("refuses a sub-national denominator when the records' vintage is not stated", () => {
		const div = "33333333-3333-3333-3333-333333333333";
		const c = cand({ divisionId: div, boundaryVintage: "AGO-2026" });
		const res = choosePopulationDenominator([c], TENANT, {
			divisionId: div,
			year: 2024,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("BOUNDARY_VINTAGE_MISMATCH");
	});
});
