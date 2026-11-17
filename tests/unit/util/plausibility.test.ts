import { describe, it, expect } from "vitest";
import {
	plausibilitySourceFields,
	plausibilityMeasuresForField,
	PLAUSIBILITY_FIELD_MEASURES,
} from "~/utils/plausibility";

describe("plausibility field map", () => {
	it("maps each DesInventar human-effect field to one DELTA measure (DEC-008)", () => {
		expect(plausibilitySourceFields("deaths")).toEqual(["muertos"]);
		expect(plausibilitySourceFields("affected_direct")).toEqual([
			"damnificados",
		]);
		expect(plausibilitySourceFields("affected_indirect")).toEqual([
			"afectados",
		]);
		expect(plausibilitySourceFields("displaced").sort()).toEqual([
			"evacuados",
			"reubicados",
		]);
		expect(plausibilitySourceFields("houses_damaged")).toEqual(["vivafec"]);
	});

	it("caveats evacuated and relocated on their own as well (TR-204)", () => {
		expect(plausibilitySourceFields("evacuated")).toEqual(["evacuados"]);
		expect(plausibilitySourceFields("relocated")).toEqual(["reubicados"]);
		expect(plausibilityMeasuresForField("evacuados")).toEqual([
			"displaced",
			"evacuated",
		]);
		expect(plausibilityMeasuresForField("kmvias")).toEqual([]);
	});

	it("does not map sector fields to people measures", () => {
		expect(PLAUSIBILITY_FIELD_MEASURES.kmvias).toBeUndefined();
		expect(PLAUSIBILITY_FIELD_MEASURES.nhectareas).toBeUndefined();
	});
});
