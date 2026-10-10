import { describe, it, expect } from "vitest";
import {
	ratePer100k,
	sumMeasures,
	type RateNumerator,
} from "~/backend.server/models/ref/rates";
import type {
	DenominatorResult,
	ReferenceProvenance,
} from "~/backend.server/models/ref/denominator";
import type { MeasureValue, ValueState } from "~/utils/valueState";

const provenance = {
	valueId: "v1",
	indicatorCode: "POP_TOTAL",
	countryAccountsId: "t1",
	divisionId: null,
	boundaryVintage: "national",
	periodStart: "2024-01-01",
	periodEnd: "2024-12-31",
	value: 2_000_000,
	valueState: "reported",
	lowerBound: null,
	upperBound: null,
	method: "as_published",
	grade: "REF-B",
	sourceStatus: "international_official",
	source: {
		id: "s1",
		name: "UN WPP 2024",
		provider: "UN DESA",
		licence: "CC BY 3.0 IGO",
		redistributionRule: "display_and_redistribute",
		attributionText: null,
		rdlsId: null,
	},
	release: {
		id: "r1",
		version: "2024",
		releaseDate: "2024-07-11",
		deprecatedBy: null,
	},
} satisfies ReferenceProvenance;

const denom: DenominatorResult = {
	ok: true,
	year: 2024,
	value: 2_000_000,
	provenance,
};

const missingDenom: DenominatorResult = {
	ok: false,
	refusal: {
		code: "POPULATION_MISSING_FOR_YEAR",
		reason: "No population value for 2024 at this geography",
		countryAccountsId: "t1",
		divisionId: null,
		year: 2024,
		boundaryVintage: null,
	},
};

function num(value: number | null, valueState: ValueState): RateNumerator {
	return { value, valueState, provenance: { test: true } };
}

describe("ratePer100k", () => {
	it("computes a reported rate with both provenances and the method", () => {
		const res = ratePer100k(
			num(50, "reported"),
			denom,
			"a1_deaths_missing_per_100k",
		);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value).toBeCloseTo(2.5, 10);
			expect(res.valueState).toBe("reported");
			expect(res.method).toBe("a1_deaths_missing_per_100k");
			expect(res.per).toBe(100000);
			expect(res.numerator.provenance).toEqual({ test: true });
			expect(res.denominator.provenance.source.name).toBe("UN WPP 2024");
			expect(res.denominator.year).toBe(2024);
		}
	});

	it("keeps a not_reported numerator null and not_reported (never 0)", () => {
		const res = ratePer100k(num(null, "not_reported"), denom);
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value).toBeNull();
			expect(res.valueState).toBe("not_reported");
		}
	});

	it("keeps insufficient_reporting null", () => {
		const res = ratePer100k(num(null, "insufficient_reporting"), denom);
		expect(res.ok && res.value).toBeNull();
		expect(res.ok && res.valueState).toBe("insufficient_reporting");
	});

	it("gives 0 for a zero_confirmed numerator", () => {
		const res = ratePer100k(num(0, "zero_confirmed"), denom);
		expect(res.ok && res.value).toBe(0);
		expect(res.ok && res.valueState).toBe("zero_confirmed");
	});

	it("refuses when the denominator is missing, with its reason code", () => {
		const res = ratePer100k(num(50, "reported"), missingDenom);
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.refusal.code).toBe("POPULATION_MISSING_FOR_YEAR");
			expect(res.refusal.denominatorRefusal?.year).toBe(2024);
		}
		expect((res as any).value).toBeUndefined();
	});

	it("refuses a not_reported numerator too when the denominator is missing", () => {
		const res = ratePer100k(num(null, "not_reported"), missingDenom);
		expect(res.ok).toBe(false);
	});

	it("refuses a zero denominator", () => {
		const zero: DenominatorResult = {
			ok: true,
			year: 2024,
			value: 0,
			provenance: { ...provenance, value: 0, valueState: "zero_confirmed" },
		};
		const res = ratePer100k(num(5, "reported"), zero);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.refusal.code).toBe("DENOMINATOR_ZERO");
	});

	it("refuses a numerator whose value contradicts its state", () => {
		const bad = ratePer100k(num(0, "not_reported"), denom);
		expect(!bad.ok && bad.refusal.code).toBe("NUMERATOR_INVALID");
		const bad2 = ratePer100k(num(null, "reported"), denom);
		expect(!bad2.ok && bad2.refusal.code).toBe("NUMERATOR_INVALID");
	});
});

function mv(value: number | null, valueState: ValueState): MeasureValue {
	return {
		value,
		valueState,
		recordsReported: 0,
		recordsZeroConfirmed: 0,
		recordsNotReported: 0,
		recordsTotal: 0,
		recordsFlagged: 0,
	};
}

describe("sumMeasures (A-1 deaths plus missing)", () => {
	it("sums the reported components", () => {
		expect(sumMeasures([mv(5, "reported"), mv(2, "reported")])).toEqual({
			value: 7,
			valueState: "reported",
		});
	});

	it("is reported when one component is reported and the other is not", () => {
		expect(sumMeasures([mv(5, "reported"), mv(null, "not_reported")])).toEqual({
			value: 5,
			valueState: "reported",
		});
	});

	it("is zero_confirmed only when every component is", () => {
		expect(
			sumMeasures([mv(0, "zero_confirmed"), mv(0, "zero_confirmed")]),
		).toEqual({ value: 0, valueState: "zero_confirmed" });
		expect(
			sumMeasures([mv(0, "zero_confirmed"), mv(null, "not_reported")]),
		).toEqual({ value: null, valueState: "not_reported" });
	});

	it("is not_reported with a null value when nothing is reported", () => {
		expect(
			sumMeasures([mv(null, "not_reported"), mv(null, "not_reported")]),
		).toEqual({ value: null, valueState: "not_reported" });
	});
});
