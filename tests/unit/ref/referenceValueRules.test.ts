import { describe, it, expect } from "vitest";
import { validateReferenceValueCells } from "~/backend.server/models/ref/referenceValueRules";

// The two rows of delta_reference_value.examples.json, as CSV text cells.
const wpp: Record<string, string> = {
	indicator_code: "POP_TOTAL",
	family: "population",
	quantity_type: "extensive",
	unit: "persons",
	division_key: "MOZ",
	boundary_vintage: "national",
	period_start: "2024-01-01",
	period_end: "2024-12-31",
	value: "1000000",
	value_state: "reported",
	lower_bound: "",
	upper_bound: "",
	method: "as_published",
	grade: "REF-B",
	source: "UN WPP 2024",
	release: "2024",
	licence: "CC BY 3.0 IGO",
	redistribution_rule: "display_and_redistribute",
	source_status: "international_official",
	rdls_id: "",
};

const worldpopNotReported: Record<string, string> = {
	...wpp,
	division_key: "AO-LUA",
	boundary_vintage: "AGO-2026-national",
	value: "",
	value_state: "not_reported",
	method: "zonal_sum",
	grade: "REF-C",
	source: "WorldPop Global2",
	release: "R2025A v1",
	licence: "CC BY 4.0",
	source_status: "modelled",
	rdls_id: "delta-enr-pop-02",
};

function errorsOf(cells: Record<string, string>): string[] {
	const res = validateReferenceValueCells(cells);
	return res.ok ? [] : res.errors;
}

describe("validateReferenceValueCells", () => {
	it("accepts the schema examples", () => {
		const a = validateReferenceValueCells(wpp);
		expect(a.ok).toBe(true);
		if (a.ok) {
			expect(a.row.value).toBe(1000000);
			expect(a.row.lower_bound).toBeNull();
			expect(a.row.rdls_id).toBeNull();
		}
		const b = validateReferenceValueCells(worldpopNotReported);
		expect(b.ok).toBe(true);
		if (b.ok) expect(b.row.value).toBeNull();
	});

	it("rejects a value on a not_reported row (null is not zero)", () => {
		expect(errorsOf({ ...worldpopNotReported, value: "0" })).toEqual([
			"value: must be empty when value_state is not_reported (null is not zero)",
		]);
	});

	it("rejects a reported row with no value", () => {
		expect(errorsOf({ ...wpp, value: "" })).toEqual([
			"value: required when value_state is reported",
		]);
	});

	it("rejects zero_confirmed with a non-zero value", () => {
		expect(
			errorsOf({ ...wpp, value_state: "zero_confirmed", value: "3" }),
		).toEqual(["value: must be 0 when value_state is zero_confirmed"]);
	});

	it("rejects REF-A on a source that is not official national", () => {
		expect(errorsOf({ ...wpp, grade: "REF-A" })).toEqual([
			"grade: REF-A is reserved for official_national sources",
		]);
	});

	it("rejects a modelled REF-A or REF-B", () => {
		expect(errorsOf({ ...worldpopNotReported, grade: "REF-B" })).toEqual([
			"grade: modelled values take REF-C or REF-D only",
		]);
		expect(errorsOf({ ...worldpopNotReported, grade: "REF-A" })).toHaveLength(
			2,
		);
	});

	it("rejects a summed index", () => {
		expect(
			errorsOf({ ...wpp, quantity_type: "index", method: "zonal_sum" }),
		).toEqual(["method: indices are never summed (zonal_sum not allowed)"]);
	});

	it("rejects unknown enums, bad dates and missing required fields", () => {
		const errs = errorsOf({
			...wpp,
			method: "guess",
			period_start: "2024-02-30",
			licence: "",
		});
		expect(errs).toContain("licence: required");
		expect(errs).toContain("period_start: must be a date (YYYY-MM-DD)");
		expect(errs.some((e) => e.startsWith("method: 'guess'"))).toBe(true);
	});

	it("rejects a period that ends before it starts and a non-numeric value", () => {
		const errs = errorsOf({ ...wpp, period_end: "2023-12-31", value: "abc" });
		expect(errs).toContain("period_end: must not be before period_start");
		expect(errs).toContain("value: must be a number or empty");
	});
});
