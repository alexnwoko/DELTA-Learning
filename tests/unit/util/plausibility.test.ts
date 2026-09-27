import { describe, it, expect } from "vitest";
import {
	plausibilitySourceFields,
	PLAUSIBILITY_FIELD_MEASURE,
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

	it("does not map sector fields to people measures", () => {
		expect(PLAUSIBILITY_FIELD_MEASURE.kmvias).toBeUndefined();
		expect(PLAUSIBILITY_FIELD_MEASURE.nhectareas).toBeUndefined();
	});
});
