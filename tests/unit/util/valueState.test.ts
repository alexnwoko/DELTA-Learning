import { describe, it, expect } from "vitest";
import {
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	VALUE_STATES,
} from "~/utils/valueState";

// Approved states (TR-076 plus the aggregate-only state): reported,
// zero_confirmed, not_reported, not_applicable, suppressed,
// insufficient_reporting.

describe("valueState", () => {
	it("lists the approved states", () => {
		expect(VALUE_STATES).toEqual([
			"reported",
			"zero_confirmed",
			"not_reported",
			"not_applicable",
			"suppressed",
			"insufficient_reporting",
		]);
	});

	it("reports a value when any record reported a non-zero amount", () => {
		expect(
			measureValue({ sum: 12, reported: 2, zeroConfirmed: 1, total: 5 }),
		).toEqual({
			value: 12,
			valueState: "reported",
			recordsReported: 2,
			recordsZeroConfirmed: 1,
			recordsNotReported: 2,
			recordsTotal: 5,
			recordsFlagged: 0,
		});
	});

	it("is a confirmed zero only when records confirmed zero and none reported a value", () => {
		expect(
			measureValue({ sum: 0, reported: 0, zeroConfirmed: 3, total: 3 }),
		).toMatchObject({ value: 0, valueState: "zero_confirmed" });
	});

	it("is not reported, with a null value, when no record reported (a NULL sum is never 0)", () => {
		expect(
			measureValue({ sum: null, reported: 0, zeroConfirmed: 0, total: 4 }),
		).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsNotReported: 4,
		});
	});

	it("is not reported when there are no records at all", () => {
		expect(
			measureValue({ sum: null, reported: 0, zeroConfirmed: 0, total: 0 }),
		).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsTotal: 0,
		});
	});

	it("downgrades a confirmed zero to insufficient reporting below a coverage threshold", () => {
		expect(
			measureValue(
				{ sum: 0, reported: 0, zeroConfirmed: 1, total: 94 },
				{ minCoverage: 0.25, minRecords: 1 },
			),
		).toMatchObject({ value: null, valueState: "insufficient_reporting" });
	});

	it("applies the provisional V-5 rule: Angola, Benguela / Lobito, missing", () => {
		// 9 records in scope, none reported, 1 confirmed zero: 11.1% is below
		// 25%, so no zero is shown.
		expect(
			measureValue(
				{ sum: null, reported: 0, zeroConfirmed: 1, total: 9 },
				PROVISIONAL_ZERO_COVERAGE,
			),
		).toMatchObject({ value: null, valueState: "insufficient_reporting" });
		// The bound is inclusive: 2 of 8 (exactly 25%) shows a confirmed zero.
		expect(
			measureValue(
				{ sum: null, reported: 0, zeroConfirmed: 2, total: 8 },
				PROVISIONAL_ZERO_COVERAGE,
			),
		).toMatchObject({ value: 0, valueState: "zero_confirmed" });
		// A reported value is never affected by the rule.
		expect(
			measureValue(
				{ sum: 5, reported: 1, zeroConfirmed: 0, total: 8 },
				PROVISIONAL_ZERO_COVERAGE,
			),
		).toMatchObject({ value: 5, valueState: "reported" });
	});

	it("carries the plausibility-flagged count", () => {
		expect(
			measureValue({
				sum: 9,
				reported: 2,
				zeroConfirmed: 0,
				total: 2,
				flagged: "1",
			}),
		).toMatchObject({ value: 9, recordsFlagged: 1 });
	});

	it("parses database strings and treats a non-numeric sum as null", () => {
		expect(
			measureValue({
				sum: "7",
				reported: "1",
				zeroConfirmed: "0",
				total: "2",
			} as any),
		).toMatchObject({ value: 7, recordsReported: 1, recordsTotal: 2 });
		expect(
			measureValue({
				sum: "abc",
				reported: 0,
				zeroConfirmed: 0,
				total: 1,
			} as any),
		).toMatchObject({ value: null, valueState: "not_reported" });
	});
});
