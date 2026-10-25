import { describe, it, expect } from "vitest";
import {
	choosePopulationDenominator,
	YEAR_BASIS_LABELS,
	type PopulationCandidate,
} from "~/backend.server/models/ref/denominator";
import { ratePer100k } from "~/backend.server/models/ref/rates";

// FR-BAS-240, FR-BAS-600 (TR-154, ER-3, NFR-112, RS-4): a rate uses the
// population of the year of occurrence. Records hold no per-effect date yet,
// so the year is the record start year, and every denominator and rate says
// so with a label.

const TENANT = "11111111-1111-1111-1111-111111111111";

function cand(): PopulationCandidate {
	return {
		valueId: "v1",
		indicatorCode: "POP_TOTAL",
		countryAccountsId: TENANT,
		divisionId: null,
		keyScheme: "iso3",
		boundaryVintage: "national",
		periodStart: "2024-01-01",
		periodEnd: "2024-12-31",
		value: 2_000_000,
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
		releaseId: "r1",
		releaseVersion: "2024",
		releaseDate: "2024-07-11",
		releaseDeprecatedBy: null,
		releaseCreatedAt: "2026-10-10T09:00:00.000000",
	};
}

describe("year basis of denominators and rates", () => {
	it("labels the start year as a fallback when the caller states no basis", () => {
		const res = choosePopulationDenominator([cand()], TENANT, {
			divisionId: null,
			year: 2024,
		});
		expect(res.ok && res.yearBasis).toBe("start_year_fallback");
	});

	it("keeps an effect-date basis the caller states", () => {
		const res = choosePopulationDenominator([cand()], TENANT, {
			divisionId: null,
			year: 2024,
			yearBasis: "effect_date",
		});
		expect(res.ok && res.yearBasis).toBe("effect_date");
	});

	it("states the basis on a refusal too", () => {
		const res = choosePopulationDenominator([], TENANT, {
			divisionId: null,
			year: 2024,
		});
		expect(!res.ok && res.refusal.yearBasis).toBe("start_year_fallback");
	});

	it("carries the basis into the rate", () => {
		const denominator = choosePopulationDenominator([cand()], TENANT, {
			divisionId: null,
			year: 2024,
		});
		const rate = ratePer100k(
			{ value: 10, valueState: "reported", provenance: {} },
			denominator,
		);
		expect(rate.ok && rate.denominator.yearBasis).toBe("start_year_fallback");
	});

	it("names the fallback in the label users see", () => {
		expect(YEAR_BASIS_LABELS.start_year_fallback).toBe(
			"Record start year (fallback: no effect date)",
		);
	});

	it("keeps the basis on a refused rate", () => {
		const denominator = choosePopulationDenominator([], TENANT, {
			divisionId: null,
			year: 2024,
		});
		const rate = ratePer100k(
			{ value: 10, valueState: "reported", provenance: {} },
			denominator,
		);
		expect(!rate.ok && rate.refusal.denominatorRefusal?.yearBasis).toBe(
			"start_year_fallback",
		);
	});
});
