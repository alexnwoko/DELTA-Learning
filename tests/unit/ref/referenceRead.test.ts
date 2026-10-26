import { describe, it, expect } from "vitest";
import {
	parseValuesQuery,
	permittedRules,
} from "~/backend.server/models/ref/referenceRead";

// BM-6 (FR-BAS-120, FR-BAS-180; PD-05 reference endpoints; SEC-19; decision
// D-BM-08): what each caller may receive, and how the query is read.

const q = (s: string) => parseValuesQuery(new URLSearchParams(s));

describe("permittedRules", () => {
	it("never returns analysis-only values to anyone", () => {
		expect(permittedRules("signed_in")).not.toContain("analysis_only");
		expect(permittedRules("api_key")).not.toContain("analysis_only");
	});

	it("keeps display-only and signed-in-only values off the API-key channel", () => {
		expect([...permittedRules("api_key")].sort()).toEqual([
			"display_and_redistribute",
			"redistribute_share_alike",
		]);
		expect([...permittedRules("signed_in")].sort()).toEqual([
			"display_and_redistribute",
			"display_only",
			"redistribute_share_alike",
			"signed_in_only",
		]);
	});
});

describe("parseValuesQuery", () => {
	it("needs an indicator", () => {
		expect(q("")).toEqual({ ok: false, error: "indicator: required" });
	});

	it("reads every parameter", () => {
		expect(
			q(
				"indicator=POP_TOTAL&divisionKey=AGO&keyScheme=iso3&from=2020-01-01&to=2024-12-31&minGrade=REF-B&includeDeprecated=true",
			),
		).toEqual({
			ok: true,
			query: {
				indicator: "POP_TOTAL",
				divisionKey: "AGO",
				keyScheme: "iso3",
				from: "2020-01-01",
				to: "2024-12-31",
				minGrade: "REF-B",
				includeDeprecated: true,
			},
		});
	});

	it("defaults to the newest releases and no filters", () => {
		expect(q("indicator=POP_TOTAL")).toEqual({
			ok: true,
			query: {
				indicator: "POP_TOTAL",
				divisionKey: null,
				keyScheme: null,
				from: null,
				to: null,
				minGrade: null,
				includeDeprecated: false,
			},
		});
	});

	it("refuses malformed values with a reason", () => {
		expect(q("indicator=POP_TOTAL&from=2024-13-01")).toEqual({
			ok: false,
			error: "from: must be a date (YYYY-MM-DD)",
		});
		expect(q("indicator=POP_TOTAL&minGrade=REF-E")).toEqual({
			ok: false,
			error: "minGrade: must be one of REF-A, REF-B, REF-C, REF-D",
		});
		expect(q("indicator=POP_TOTAL&divisionKey=AO-LUA")).toEqual({
			ok: false,
			error: "keyScheme: required with divisionKey (iso3 or national_id)",
		});
		expect(q("indicator=pop")).toEqual({
			ok: false,
			error: "indicator: not an indicator code",
		});
	});
});
