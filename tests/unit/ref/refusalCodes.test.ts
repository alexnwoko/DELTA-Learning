import { describe, it, expect } from "vitest";
import {
	choosePopulationDenominator,
	type DenominatorRefusalCode,
} from "~/backend.server/models/ref/denominator";
import {
	RATE_REFUSAL_CODES,
	ratePer100k,
	type RateRefusalCode,
} from "~/backend.server/models/ref/rates";

// FR-BAS-210, FR-BAS-590 (TR-154, PD-05 refusal envelope): every refusal the
// reference store returns is either a code reserved in PD-05 or a listed
// extension that names its requirement. A missing denominator is
// DENOMINATOR_MISSING, the same code in the API and in every panel.

describe("reference-store refusal codes", () => {
	it("registers each code as PD-05 reserved or a DELTA extension", () => {
		expect(
			Object.fromEntries(
				Object.entries(RATE_REFUSAL_CODES).map(([c, e]) => [c, e.pd05]),
			),
		).toEqual({
			DENOMINATOR_MISSING: "reserved",
			BOUNDARY_VINTAGE_MISMATCH: "extension",
			DENOMINATOR_ZERO: "extension",
			NUMERATOR_INVALID: "extension",
		});
	});

	it("names a requirement for every code", () => {
		for (const entry of Object.values(RATE_REFUSAL_CODES)) {
			expect(entry.requirement).toMatch(/^(TR|FR-BAS)-\d+/);
		}
	});

	it("refuses a missing denominator with DENOMINATOR_MISSING", () => {
		const res = choosePopulationDenominator([], "t1", {
			divisionId: null,
			year: 2024,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			const code: DenominatorRefusalCode = res.refusal.code;
			expect(code).toBe("DENOMINATOR_MISSING");
		}
	});

	it("passes DENOMINATOR_MISSING through to the rate unchanged", () => {
		const denominator = choosePopulationDenominator([], "t1", {
			divisionId: null,
			year: 2024,
		});
		const rate = ratePer100k(
			{ value: 5, valueState: "reported", provenance: {} },
			denominator,
		);
		expect(rate.ok).toBe(false);
		if (!rate.ok) {
			const code: RateRefusalCode = rate.refusal.code;
			expect(code).toBe("DENOMINATOR_MISSING");
			expect(RATE_REFUSAL_CODES[code].pd05).toBe("reserved");
		}
	});
});
