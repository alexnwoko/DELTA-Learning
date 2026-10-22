// Payload type for the estimated sex and age split of people affected (Alex,
// 2026-10-19; DELTA_Estimated_Disaggregation_and_Hazard_Seasonality.md).
// No disaster record carries a sex or age split, so the country's population
// structure (UN DESA WPP 2024, held in ref.value) is applied to the reported
// number of people affected. The result is an estimate: it has its own cell
// type, never a PanelCell, so it cannot be summed with or shown as reported
// data, and it travels with its footnote.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";
import type { DisaggregationModelId } from "~/utils/disaggregationModels";

/** The measures an estimate is made for; every other measure is refused. */
export const ESTIMABLE_MEASURES = [
	"affected_direct",
	"affected_indirect",
] as const;
export type EstimableMeasure = (typeof ESTIMABLE_MEASURES)[number];

/** An estimated figure. Never "reported". */
export interface EstimatedCell {
	value: number | null;
	/** "suppressed" when the estimate would mislead or has no basis. */
	state: "estimated" | "suppressed";
}

export interface EstimatedDisaggregation {
	/** The reported people the structure is applied to. */
	measure: EstimableMeasure;
	/** Set when the query asks for a measure that is refused, with the reason. */
	refused: { measure: string; reason: string } | null;
	/** Reported total the estimate splits (records in scope, after exclusions). */
	baseTotal: number | null;
	recordsUsed: number;
	/** Broad bands: 0-14, 15-64, 65+, by sex. */
	bands: {
		band: "0-14" | "15-64" | "65+";
		female: EstimatedCell;
		male: EstimatedCell;
	}[];
	/**
	 * The estimate in each named model (DELTA, SFM, UN, life-stage), by sex.
	 * A band marked split takes an even share of a five-year group it only
	 * partly covers (18 in 15-19).
	 */
	byModel: {
		id: DisaggregationModelId;
		name: string;
		source: string;
		bands: {
			key: string;
			label: string;
			split: boolean;
			female: EstimatedCell;
			male: EstimatedCell;
		}[];
	}[];
	/** The model a view shows first: DELTA disaggregation. */
	defaultModel: DisaggregationModelId;
	/** Five-year groups (21), kept for the detail table and export only. */
	groups: { group: string; female: EstimatedCell; male: EstimatedCell }[];
	female: EstimatedCell;
	male: EstimatedCell;
	/** Records left out, by reason; counted, never hidden. */
	excluded: {
		biological: number;
		underReview: number;
		noYear: number;
		before1950: number;
		noReference: number;
	};
	reference: { source: string; release: string; licence: string };
	/** Small-print footnote that must travel with every view and export. */
	footnote: string;
	/** True: an estimate from a national structure is never a basis for targeting. */
	notForTargeting: true;
	meta: PanelMeta;
}
