// Value states for analytical figures. A figure is never a bare number: it
// carries its state and the record counts behind it, so "not reported" is
// never shown as a confirmed zero (TRD TR-076; solution pack C10, C11).
// Pure module: safe to import from server and client code.

export const VALUE_STATES = [
	"reported",
	"zero_confirmed",
	"not_reported",
	"not_applicable",
	"suppressed",
	"insufficient_reporting",
] as const;

export type ValueState = (typeof VALUE_STATES)[number];

export interface MeasureValue {
	/** null unless at least one record reported the measure. */
	value: number | null;
	valueState: ValueState;
	recordsReported: number;
	recordsZeroConfirmed: number;
	recordsNotReported: number;
	recordsTotal: number;
	/** Records whose plausibility flags concern this measure (C30); 0 if none. */
	recordsFlagged: number;
}

export interface MeasureCounts {
	/** Sum over records that reported a value; null when none did. */
	sum: number | string | null;
	/** Records that reported a non-zero value. */
	reported: number | string;
	/** Records that confirmed zero (a stored 0 or an explicit No). */
	zeroConfirmed: number | string;
	/** All records in scope, whatever their state. */
	total: number | string;
	/** Records flagged for review on this measure (C30). */
	flagged?: number | string;
}

export interface CoverageRule {
	/** Share of records in scope that must confirm zero (for example 0.25). */
	minCoverage: number;
	/** Minimum number of confirming records. */
	minRecords: number;
}

function toCount(v: number | string | null | undefined): number {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toValue(v: number | string | null | undefined): number | null {
	if (v === null || v === undefined || v === "") {
		return null;
	}
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/**
 * Builds a figure from a measure's sum and record counts.
 *
 * - reported: at least one record reported a non-zero value.
 * - zero_confirmed: no record reported a value and at least one confirmed
 *   zero; with a coverage rule, the confirming share must meet it, otherwise
 *   the state is insufficient_reporting and the value is null.
 * - not_reported: no record reported or confirmed; the value is null.
 */
export function measureValue(
	counts: MeasureCounts,
	coverage?: CoverageRule,
): MeasureValue {
	const recordsReported = toCount(counts.reported);
	const recordsZeroConfirmed = toCount(counts.zeroConfirmed);
	const recordsTotal = Math.max(
		toCount(counts.total),
		recordsReported + recordsZeroConfirmed,
	);
	const recordsNotReported =
		recordsTotal - recordsReported - recordsZeroConfirmed;
	const base = {
		recordsReported,
		recordsZeroConfirmed,
		recordsNotReported,
		recordsTotal,
		recordsFlagged: toCount(counts.flagged),
	};

	const sum = toValue(counts.sum);
	if (recordsReported > 0 && sum !== null) {
		return { value: sum, valueState: "reported", ...base };
	}
	if (recordsZeroConfirmed > 0) {
		const share = recordsTotal > 0 ? recordsZeroConfirmed / recordsTotal : 0;
		if (
			coverage &&
			(share < coverage.minCoverage ||
				recordsZeroConfirmed < coverage.minRecords)
		) {
			return { value: null, valueState: "insufficient_reporting", ...base };
		}
		return { value: 0, valueState: "zero_confirmed", ...base };
	}
	return { value: null, valueState: "not_reported", ...base };
}
