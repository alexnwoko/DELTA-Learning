import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import schema from "~/backend.server/models/ref/contract/delta_reference_value.schema.json";
import examples from "~/backend.server/models/ref/contract/delta_reference_value.examples.json";
import { validateReferenceValueCells } from "~/backend.server/models/ref/referenceValueRules";

// BM-11 (FR-BAS-760; NFR-110, NFR-126; RS-6): the contract examples pass the
// JSON schema, and the loader rules refuse one negative case per cross-field
// rule exactly as the schema does, so the two cannot drift apart.

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

type Row = Record<string, unknown>;

/** A JSON row as the CSV cells the loader reads. */
function cells(row: Row): Record<string, string> {
	return Object.fromEntries(
		Object.entries(row).map(([k, v]) => [
			k,
			v === null || v === undefined
				? ""
				: Array.isArray(v)
					? v.join(";")
					: String(v),
		]),
	);
}

function schemaAccepts(row: Row): boolean {
	return validate(row) === true;
}

function rulesAccept(row: Row): boolean {
	return validateReferenceValueCells(cells(row)).ok;
}

const base: Row = {
	indicator_code: "POP_TOTAL",
	family: "population",
	quantity_type: "extensive",
	unit: "persons",
	division_key: "AGO",
	key_scheme: "iso3",
	boundary_vintage: "national",
	period_start: "2024-01-01",
	period_end: "2024-12-31",
	value: 1000,
	value_state: "reported",
	method: "as_published",
	grade: "REF-B",
	source: "UN WPP 2024",
	release: "2024",
	licence: "CC BY 3.0 IGO",
	redistribution_rule: "display_and_redistribute",
	source_status: "international_official",
};

// One case per allOf rule of the schema, in the schema's order.
const NEGATIVE: [string, Row][] = [
	["null is not zero", { value: 5, value_state: "not_reported" }],
	["zero_confirmed means 0", { value: 3, value_state: "zero_confirmed" }],
	["REF-A is official national only", { grade: "REF-A" }],
	["modelled values take REF-C or REF-D", { source_status: "modelled" }],
	["indices are never summed", { quantity_type: "index", method: "zonal_sum" }],
	[
		"money states currency, price basis, unit multiplier",
		{ is_monetary: true },
	],
	[
		"constant prices state a base year",
		{ currency: "AOA", price_basis: "constant" },
	],
	["coarse grid is REF-D", { quality_flags: ["coarse_grid"] }],
	["interpolation is REF-C or REF-D", { method: "raked_to_official" }],
	["a bound states its interval type", { lower_bound: 900 }],
	[
		"climate drivers state the index version",
		{
			family: "climate_driver",
			quantity_type: "index",
			key_scheme: "global",
			division_key: "GLOBAL",
			boundary_vintage: "not_applicable",
		},
	],
];

describe("reference value contract", () => {
	it("holds one negative case per cross-field rule", () => {
		expect(NEGATIVE).toHaveLength(
			(schema as { allOf: unknown[] }).allOf.length,
		);
	});

	it("accepts the base row in the schema and in the loader rules", () => {
		expect(schemaAccepts(base)).toBe(true);
		expect(rulesAccept(base)).toBe(true);
	});

	it.each(examples as Row[])(
		"accepts example $indicator_code ($value_state) in both",
		(row) => {
			expect(schemaAccepts(row)).toBe(true);
			expect(rulesAccept(row)).toBe(true);
		},
	);

	it.each(NEGATIVE)("refuses in both: %s", (_name, change) => {
		const row = { ...base, ...change };
		expect(schemaAccepts(row)).toBe(false);
		expect(rulesAccept(row)).toBe(false);
	});
});
