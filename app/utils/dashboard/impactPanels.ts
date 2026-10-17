// Payload types for the D1 Analysis dashboard, Disaster impact panels 1 to 4
// (D1 build brief, section 3). Analytics builds the loader that returns
// them; Frontend builds the panels against these types and the fixture
// below until the loader lands. Pure module: safe on server and client.
//
// Every figure is a cell carrying its value state and record counts, so a
// figure no record reported is never drawn as 0 (TR-076).

import type { MeasureValue } from "~/utils/valueState";
import type { DeltaQuery } from "~/utils/deltaQuery";

/** One figure: value, value state and the records behind it. */
export type PanelCell = MeasureValue;

/** Human effects shown as headline tiles, in tile order. */
export const IMPACT_HEADLINE_MEASURES = [
	"deaths",
	"missing",
	"injured",
	"affected_direct",
	"displaced",
] as const;
export type ImpactHeadlineMeasure = (typeof IMPACT_HEADLINE_MEASURES)[number];

/** What every panel carries for its caption and export (ChartFrame meta). */
export interface PanelMeta {
	/** How the figure is computed, in words. */
	method: string;
	/** "Based on n of N records ..." where a panel needs it. */
	coverage?: string;
	/** Filters this panel could not apply, named, never dropped silently. */
	notApplied: string[];
}

/** Panel 1: one headline tile per measure, with a 10-year sparkline. */
export interface HeadlineTile {
	measure: ImpactHeadlineMeasure;
	cell: PanelCell;
	/** The last 10 years in scope, oldest first; a year with no report is a cell, not 0. */
	sparkline: { year: number; cell: PanelCell }[];
}

/** Panel 2: how the records in scope stand for one measure (10 by 10 waffle). */
export interface CoverageWaffle {
	measure: ImpactHeadlineMeasure;
	recordsReported: number;
	recordsZeroConfirmed: number;
	recordsNotReported: number;
	recordsFlagged: number;
	recordsTotal: number;
}

/** Panel 3: one column per year, with up to three labelled annotations. */
export interface ImpactTimeline {
	measure: ImpactHeadlineMeasure;
	years: { year: number; cell: PanelCell }[];
	/** Peak years, labelled in words; at most three. */
	annotations: { year: number; label: string }[];
	/** The "by hazard" toggle: the same series per HIPs type. */
	byHazard: {
		hipTypeId: string;
		label: string;
		years: { year: number; cell: PanelCell }[];
	}[];
}

/** Panel 4: hazard ranking, one row per HIPs type, sorted by value (nulls last). */
export interface HazardRankingRow {
	hipTypeId: string;
	label: string;
	cell: PanelCell;
}

/** The loader's answer for Disaster impact panels 1 to 4. */
export interface ImpactPanels1to4 {
	/** The query the figures answer, echoed (delta.query/1). */
	query: DeltaQuery;
	/** One-line scope and basis, as in the filter bar summary. */
	scopeText: string;
	provisional: boolean;
	tiles: HeadlineTile[];
	coverage: CoverageWaffle;
	timeline: ImpactTimeline;
	hazardRanking: HazardRankingRow[];
	meta: Record<"tiles" | "coverage" | "timeline" | "hazardRanking", PanelMeta>;
}

const cell = (
	value: number | null,
	valueState: PanelCell["valueState"],
	reported: number,
	total: number,
	flagged = 0,
): PanelCell => ({
	value,
	valueState,
	recordsReported: valueState === "reported" ? reported : 0,
	recordsZeroConfirmed: valueState === "zero_confirmed" ? reported : 0,
	recordsNotReported: total - reported,
	recordsTotal: total,
	recordsFlagged: flagged,
});

/**
 * Example payload for building panels before the loader lands. Figures are
 * invented and labelled as such; they cover every value state a panel must
 * draw: reported, confirmed zero, not reported and flagged.
 */
export const IMPACT_PANELS_FIXTURE: ImpactPanels1to4 = {
	query: {
		contract: "delta.query/1",
		dimension: "disaster_impact",
		scope: { basis: "provisional" },
		where: {},
	},
	scopeText:
		"EXAMPLE DATA · Angola · 2015 to 2024 · Hazard: all · Basis: published, validated, waiting-for-validation, draft · Provisional",
	provisional: true,
	tiles: [
		{
			measure: "deaths",
			cell: cell(615, "reported", 243, 534, 2),
			sparkline: [
				2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
			].map((year, i) => ({
				year,
				cell:
					i === 3
						? cell(null, "not_reported", 0, 40)
						: i === 6
							? cell(0, "zero_confirmed", 5, 40)
							: cell(20 + i * 7, "reported", 12, 40),
			})),
		},
		{
			measure: "missing",
			cell: cell(null, "not_reported", 0, 534),
			sparkline: [],
		},
		{
			measure: "injured",
			cell: cell(0, "zero_confirmed", 30, 534),
			sparkline: [],
		},
		{
			measure: "affected_direct",
			cell: cell(120400, "reported", 310, 534),
			sparkline: [],
		},
		{
			measure: "displaced",
			cell: cell(34943, "reported", 130, 534),
			sparkline: [],
		},
	],
	coverage: {
		measure: "deaths",
		recordsReported: 235,
		recordsZeroConfirmed: 8,
		recordsNotReported: 291,
		recordsFlagged: 2,
		recordsTotal: 534,
	},
	timeline: {
		measure: "deaths",
		years: [
			{ year: 2022, cell: cell(110, "reported", 30, 60) },
			{ year: 2023, cell: cell(null, "not_reported", 0, 55) },
			{ year: 2024, cell: cell(0, "zero_confirmed", 4, 50) },
		],
		annotations: [{ year: 2022, label: "Highest year in scope" }],
		byHazard: [],
	},
	hazardRanking: [
		{
			hipTypeId: "1042",
			label: "Meteorological and Hydrological",
			cell: cell(560, "reported", 210, 480),
		},
		{
			hipTypeId: "1037",
			label: "Biological",
			cell: cell(55, "reported", 20, 40),
		},
		{
			hipTypeId: "1041",
			label: "Geological",
			cell: cell(null, "not_reported", 0, 14),
		},
	],
	meta: {
		tiles: {
			method: "Sum over records in scope; a record counts once",
			notApplied: [],
		},
		coverage: {
			method: "Records in scope by value state for the chosen measure",
			notApplied: [],
		},
		timeline: {
			method: "Sum per year of event start; year-only dates included",
			notApplied: [],
		},
		hazardRanking: {
			method: "Sum per HIPs type; records without a HIPs type are listed apart",
			notApplied: [],
		},
	},
};
