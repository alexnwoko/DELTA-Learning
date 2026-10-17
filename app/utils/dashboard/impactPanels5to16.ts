// Payload types for the D1 Analysis dashboard, Disaster impact panels 5 to
// 16 (D1 build brief, section 3; panel authority:
// DELTA_Dashboard_Panels_Per_Dimension_Research.md v0.3, section 4.3).
// Same rules as panels 1 to 4: every figure is a PanelCell with its value
// state and record counts, never a bare 0 (TR-076). Pure module.

import {
	exampleCell,
	type PanelCell,
	type PanelMeta,
} from "~/utils/dashboard/impactPanels";
import type { QueryHumanEffect } from "~/utils/deltaQuery";

/** Panel 5: Sendai Targets A and B counts, computed from DELTA records. */
export interface SendaiCountsPanel {
	/** Always shown: these are not the country's official SFM submission. */
	notice: "These figures are not the official Sendai Framework Monitor submission of the country.";
	/** Indicators with a count: A-2 deaths, A-3 missing, B-2 injured or ill. */
	indicators: { code: "A-2" | "A-3" | "B-2"; label: string; cell: PanelCell }[];
	/** Dwelling counts are inputs to B-3 and B-4 and carry no indicator code. */
	inputs: { inputTo: "B-3" | "B-4"; label: string; cell: PanelCell }[];
	/** Indicators refused today, with the reason (rates need TR-152; B-1 per TR-216). */
	refused: { code: string; reason: string }[];
}

/** Panel 6: hazard by effect matrix. Rows HIPs types; columns human effects. */
export interface HazardEffectMatrix {
	effects: QueryHumanEffect[];
	rows: { hipTypeId: string; label: string; cells: PanelCell[] }[];
}

/** Panel 7: ranked divisions, top 15 and the rest grouped. */
export interface RankedDivisions {
	rows: { divisionId: string; name: string; cell: PanelCell }[];
	/** The divisions after the top 15, summed; null when there are none. */
	rest: { divisions: number; cell: PanelCell } | null;
	/** A record touching several divisions counts in each: rows do not add up. */
	multiDivisionRecords: number;
}

/** Panel 8: hazard by sector matrix. Cell = records reporting damage in the sector. */
export interface HazardSectorMatrix {
	sectors: { sectorId: string; label: string }[];
	rows: { hipTypeId: string; label: string; cells: PanelCell[] }[];
}

/** Panel 9: people moved. Three separate bars, never added (contract O-2). */
export interface PeopleMovedPanel {
	rows: {
		hipTypeId: string;
		label: string;
		displaced: PanelCell;
		evacuated: PanelCell;
		relocated: PanelCell;
	}[];
	/** "Displaced includes people evacuated before the event ..." */
	overlapNote: string;
}

/** Panel 10: houses destroyed and damaged, by hazard type or division. */
export interface HousesPanel {
	groupBy: "hipType" | "division";
	rows: {
		key: string;
		label: string;
		destroyed: PanelCell;
		damaged: PanelCell;
	}[];
}

/** Panel 11: largest records, with their plausibility flags (C30). */
export interface LargestRecords {
	measure: QueryHumanEffect;
	rows: {
		recordId: string;
		startDate: string | null;
		divisionName: string | null;
		hazardLabel: string;
		cell: PanelCell;
		/** C30 codes, for example IMPLAUSIBLE_MAGNITUDE or AGGREGATE_ON_SUBUNIT. */
		flags: string[];
	}[];
}

/** Panel 12: reporting completeness and precision. */
export interface CompletenessMatrix {
	rows: {
		key: string;
		label: string;
		/** Share of records in scope that report the field; null when no record is in scope. */
		share: number | null;
		recordsWith: number;
		recordsTotal: number;
	}[];
	/** Cells under 25% read "Under 25% of records report this". */
	lowShareThreshold: 0.25;
}

/** Panel 13: season of impact. Records with month precision only. */
export interface SeasonGrid {
	measure: QueryHumanEffect;
	cells: { year: number; month: number; cell: PanelCell }[];
	/** Records left out because their date has no month. */
	recordsWithoutMonth: number;
}

/** Panel 14: change between two periods, as annual averages. */
export interface PeriodChange {
	measure: QueryHumanEffect;
	periodA: { from: number; to: number; years: number };
	periodB: { from: number; to: number; years: number };
	rows: {
		divisionId: string;
		name: string;
		/** Annual average over each period, with its value state. */
		averageA: PanelCell;
		averageB: PanelCell;
	}[];
	/** "Analytical periods; not a Sendai performance measure." */
	label: string;
}

/** Panel 15: extensive and intensive risk (GAR 2015 rule, ruling RV-2). */
export interface ExtensiveIntensive {
	threshold: { deaths: 30; housesDestroyed: 600; source: "GAR 2015" };
	/** "The GAR threshold is defined on records; it is applied here to records." */
	note: string;
	measure: "deaths" | "houses_destroyed";
	intensive: PanelCell;
	extensive: PanelCell;
	intensiveRecords: number;
	extensiveRecords: number;
}

/** Panel 16: disaggregation by sex, age and disability. */
export interface DisaggregationPanel {
	effect: QueryHumanEffect;
	rows: {
		dimension: "sex" | "age" | "disability";
		category: string;
		cell: PanelCell;
	}[];
	coverage: { recordsWithBreakdown: number; recordsTotal: number };
}

/** The loader's answer for Disaster impact panels 5 to 16. */
export interface ImpactPanels5to16 {
	sendai: SendaiCountsPanel;
	hazardEffect: HazardEffectMatrix;
	rankedDivisions: RankedDivisions;
	hazardSector: HazardSectorMatrix;
	peopleMoved: PeopleMovedPanel;
	houses: HousesPanel;
	largestRecords: LargestRecords;
	completeness: CompletenessMatrix;
	season: SeasonGrid;
	periodChange: PeriodChange;
	extensiveIntensive: ExtensiveIntensive;
	disaggregation: DisaggregationPanel;
	meta: Record<
		| "sendai"
		| "hazardEffect"
		| "rankedDivisions"
		| "hazardSector"
		| "peopleMoved"
		| "houses"
		| "largestRecords"
		| "completeness"
		| "season"
		| "periodChange"
		| "extensiveIntensive"
		| "disaggregation",
		PanelMeta
	>;
}

const c = exampleCell;
const meta = (method: string): PanelMeta => ({
	method,
	coverage: "EXAMPLE DATA",
	notApplied: [],
});

/**
 * Example payload for panels 5 to 16. Figures are invented and labelled as
 * such; each panel carries at least one cell that is not reported.
 */
export const IMPACT_PANELS_5TO16_FIXTURE: ImpactPanels5to16 = {
	sendai: {
		notice:
			"These figures are not the official Sendai Framework Monitor submission of the country.",
		indicators: [
			{ code: "A-2", label: "Deaths", cell: c(615, "reported", 243, 534, 2) },
			{
				code: "A-3",
				label: "Missing persons",
				cell: c(null, "not_reported", 0, 534),
			},
			{
				code: "B-2",
				label: "Injured or ill",
				cell: c(1204, "reported", 88, 534),
			},
		],
		inputs: [
			{
				inputTo: "B-3",
				label: "Houses damaged",
				cell: c(30211, "reported", 301, 534),
			},
			{
				inputTo: "B-4",
				label: "Houses destroyed",
				cell: c(8120, "reported", 210, 534),
			},
		],
		refused: [
			{ code: "A-1", reason: "Needs a population denominator (TR-152)" },
			{
				code: "B-1",
				reason: "Directly affected is not added from its parts (TR-216)",
			},
		],
	},
	hazardEffect: {
		effects: ["deaths", "injured", "displaced"],
		rows: [
			{
				hipTypeId: "1042",
				label: "Hydrological",
				cells: [
					c(410, "reported", 150, 300),
					c(900, "reported", 60, 300),
					c(30000, "reported", 120, 300),
				],
			},
			{
				hipTypeId: "1037",
				label: "Meteorological",
				cells: [
					c(0, "zero_confirmed", 12, 90),
					c(null, "not_reported", 0, 90),
					c(1200, "reported", 30, 90),
				],
			},
		],
	},
	rankedDivisions: {
		rows: [
			{ divisionId: "d1", name: "Luanda", cell: c(120, "reported", 40, 80) },
			{
				divisionId: "d2",
				name: "Benguela",
				cell: c(95, "reported", 33, 61, 1),
			},
			{
				divisionId: "d3",
				name: "Cunene",
				cell: c(null, "not_reported", 0, 12),
			},
		],
		rest: { divisions: 3, cell: c(40, "reported", 20, 50) },
		multiDivisionRecords: 7,
	},
	hazardSector: {
		sectors: [
			{ sectorId: "s1", label: "Agriculture" },
			{ sectorId: "s2", label: "Housing" },
		],
		rows: [
			{
				hipTypeId: "1042",
				label: "Hydrological",
				cells: [c(64, "reported", 64, 300), c(120, "reported", 120, 300)],
			},
			{
				hipTypeId: "1037",
				label: "Meteorological",
				cells: [c(null, "not_reported", 0, 90), c(9, "reported", 9, 90)],
			},
		],
	},
	peopleMoved: {
		rows: [
			{
				hipTypeId: "1042",
				label: "Hydrological",
				displaced: c(34943, "reported", 120, 300),
				evacuated: c(26117, "reported", 90, 300),
				relocated: c(8826, "reported", 35, 300),
			},
			{
				hipTypeId: "1037",
				label: "Meteorological",
				displaced: c(null, "not_reported", 0, 90),
				evacuated: c(null, "not_reported", 0, 90),
				relocated: c(310, "reported", 4, 90),
			},
		],
		overlapNote:
			"Displaced includes people evacuated before the event. The three figures overlap and are never added.",
	},
	houses: {
		groupBy: "hipType",
		rows: [
			{
				key: "1042",
				label: "Hydrological",
				destroyed: c(7900, "reported", 200, 300),
				damaged: c(29000, "reported", 280, 300),
			},
			{
				key: "1037",
				label: "Meteorological",
				destroyed: c(0, "zero_confirmed", 10, 90),
				damaged: c(null, "not_reported", 0, 90),
			},
		],
	},
	largestRecords: {
		measure: "deaths",
		rows: [
			{
				recordId: "r1",
				startDate: "2021-03-12",
				divisionName: "Benguela",
				hazardLabel: "Flash flood",
				cell: c(98, "reported", 1, 1),
				flags: [],
			},
			{
				recordId: "r2",
				startDate: "2019",
				divisionName: null,
				hazardLabel: "Drought",
				cell: c(60, "reported", 1, 1, 1),
				flags: ["AGGREGATE_ON_SUBUNIT"],
			},
		],
	},
	completeness: {
		rows: [
			{
				key: "deaths",
				label: "Deaths",
				share: 0.45,
				recordsWith: 243,
				recordsTotal: 534,
			},
			{
				key: "missing",
				label: "Missing",
				share: 0.02,
				recordsWith: 11,
				recordsTotal: 534,
			},
			{
				key: "startMonth",
				label: "Start date to the month",
				share: 0.81,
				recordsWith: 433,
				recordsTotal: 534,
			},
		],
		lowShareThreshold: 0.25,
	},
	season: {
		measure: "deaths",
		cells: [
			{ year: 2021, month: 3, cell: c(110, "reported", 9, 20) },
			{ year: 2021, month: 4, cell: c(0, "zero_confirmed", 3, 6) },
			{ year: 2021, month: 5, cell: c(null, "not_reported", 0, 4) },
		],
		recordsWithoutMonth: 101,
	},
	periodChange: {
		measure: "deaths",
		periodA: { from: 2005, to: 2014, years: 10 },
		periodB: { from: 2015, to: 2024, years: 10 },
		rows: [
			{
				divisionId: "d1",
				name: "Luanda",
				averageA: c(8.2, "reported", 30, 60),
				averageB: c(12, "reported", 40, 80),
			},
			{
				divisionId: "d3",
				name: "Cunene",
				averageA: c(null, "not_reported", 0, 9),
				averageB: c(1.5, "reported", 5, 12),
			},
		],
		label: "Analytical periods; not a Sendai performance measure.",
	},
	extensiveIntensive: {
		threshold: { deaths: 30, housesDestroyed: 600, source: "GAR 2015" },
		note: "The GAR threshold is defined on records; it is applied here to records.",
		measure: "deaths",
		intensive: c(380, "reported", 6, 6),
		extensive: c(235, "reported", 237, 528),
		intensiveRecords: 6,
		extensiveRecords: 528,
	},
	disaggregation: {
		effect: "deaths",
		rows: [
			{
				dimension: "sex",
				category: "Female",
				cell: c(40, "reported", 12, 243),
			},
			{ dimension: "sex", category: "Male", cell: c(52, "reported", 12, 243) },
			{
				dimension: "disability",
				category: "With disability",
				cell: c(null, "not_reported", 0, 243),
			},
		],
		coverage: { recordsWithBreakdown: 12, recordsTotal: 243 },
	},
	meta: {
		sendai: meta("Sum over records in scope; a record counts once"),
		hazardEffect: meta("Sum per HIPs type and effect"),
		rankedDivisions: meta(
			"Sum per division; a record in several divisions counts in each",
		),
		hazardSector: meta("Records reporting damage, per HIPs type and sector"),
		peopleMoved: meta(
			"Displaced, evacuated and relocated per contract O-2; never added",
		),
		houses: meta("Sum of houses destroyed and damaged per group"),
		largestRecords: meta("Records in scope, largest first, with C30 flags"),
		completeness: meta("Share of records in scope reporting each field"),
		season: meta("Sum per start month; records without a month are left out"),
		periodChange: meta("Annual average per period; years stated"),
		extensiveIntensive: meta("GAR 2015 thresholds applied per record"),
		disaggregation: meta("Sum per category over records with a breakdown"),
	},
};
