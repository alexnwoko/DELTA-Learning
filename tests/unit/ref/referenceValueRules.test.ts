import { describe, it, expect } from "vitest";
import { validateReferenceValueCells } from "~/backend.server/models/ref/referenceValueRules";

// The two rows of delta_reference_value.examples.json, as CSV text cells.
const wpp: Record<string, string> = {
	indicator_code: "POP_TOTAL",
	family: "population",
	quantity_type: "extensive",
	unit: "persons",
	division_key: "MOZ",
	key_scheme: "iso3",
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
	key_scheme: "iso3166_2",
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
		).toEqual([
			"method: indices are never summed or interpolated (as_published or admin_join only)",
		]);
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

	it("v0.2: rejects an index aggregated by weighted mean", () => {
		expect(
			errorsOf({
				...wpp,
				quantity_type: "index",
				method: "weighted_mean_population",
			}),
		).toHaveLength(1);
		expect(
			errorsOf({ ...wpp, quantity_type: "index", method: "admin_join" }),
		).toEqual([]);
	});

	it("v0.2: accepts the new methods and rejects the old weighted_mean", () => {
		for (const method of [
			"weighted_mean_population",
			"weighted_mean_area",
			"areal_interpolation",
			"raked_to_official",
		]) {
			expect(errorsOf({ ...wpp, method })).toEqual([]);
		}
		expect(errorsOf({ ...wpp, method: "weighted_mean" })[0]).toContain(
			"method: 'weighted_mean'",
		);
	});

	it("v0.2: requires key_scheme and rejects an unknown one", () => {
		expect(errorsOf({ ...wpp, key_scheme: "" })).toEqual([
			"key_scheme: required",
		]);
		expect(errorsOf({ ...wpp, key_scheme: "gaul" })[0]).toContain(
			"key_scheme: 'gaul'",
		);
	});

	it("v0.2: refuses an unknown boundary vintage instead of grading it", () => {
		expect(errorsOf({ ...wpp, boundary_vintage: "unknown" })).toEqual([
			"boundary_vintage: unknown vintage; the value is refused, not graded",
		]);
	});

	it("v0.2: requires lower_bound <= value <= upper_bound", () => {
		expect(
			errorsOf({ ...wpp, lower_bound: "900000", upper_bound: "1100000" }),
		).toEqual([]);
		expect(errorsOf({ ...wpp, lower_bound: "1000001" })).toEqual([
			"lower_bound: must not exceed value",
		]);
		expect(errorsOf({ ...wpp, upper_bound: "999999" })).toEqual([
			"upper_bound: must not be below value",
		]);
	});

	it("v0.2: money values need currency and price basis", () => {
		const gdp = {
			...wpp,
			indicator_code: "GDP_CURRENT_USD",
			family: "economic",
			unit: "USD",
		};
		expect(errorsOf(gdp)).toEqual([
			"currency: required for a money value",
			"price_basis: required for a money value",
		]);
		expect(
			errorsOf({ ...gdp, currency: "USD", price_basis: "current" }),
		).toEqual([]);
		expect(
			errorsOf({ ...gdp, currency: "usd", price_basis: "nominal" }).length,
		).toBe(2);
	});

	it("v0.2: climate driver values need the index version", () => {
		const oni = {
			...wpp,
			indicator_code: "ENSO_ONI",
			family: "climate_driver",
			quantity_type: "index",
			unit: "degC",
		};
		expect(errorsOf(oni)).toEqual([
			"index_version: required for a climate driver value",
		]);
		expect(errorsOf({ ...oni, index_version: "ONI v5" })).toEqual([]);
	});

	it("v0.2: base_year and unit_mult are integers; key validity is ordered", () => {
		expect(errorsOf({ ...wpp, base_year: "2015.5" })).toEqual([
			"base_year: must be an integer or empty",
		]);
		expect(
			errorsOf({
				...wpp,
				key_valid_from: "2020-01-01",
				key_valid_to: "2019-01-01",
			}),
		).toEqual(["key_valid_to: must not be before key_valid_from"]);
	});
});
