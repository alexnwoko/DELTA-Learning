// Payload for the Sendai Framework Monitoring section of the D1 dashboard
// (DELTA_Analytics_SFM_Requirements.md, section 6.2): nine fixed slots in
// target rows, the same on every view. Figures are Sendai-aligned counts
// from national records, not the country's official SFM submission. Under a
// division or region filter every code is null (TR-060, FR-AN-009).

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";

export type SendaiSlot =
	| "s0"
	| "a1"
	| "a2"
	| "b1"
	| "b2"
	| "c1"
	| "c2"
	| "d1"
	| "d2";

export interface SendaiGap {
	code: "G-06" | "G-08" | "G-22";
	reason: string;
}

/** S0: Targets A and B counts. Rates (A-1, B-1) are refused for want of a population figure. */
export interface SendaiS0 {
	indicators: {
		code: "A-2" | "A-3" | "B-2" | null;
		label: string;
		cell: PanelCell;
	}[];
	/** Dwellings: inputs to B-3 and B-4, never an indicator value (TR-216). */
	inputs: { inputTo: "B-3" | "B-4" | null; label: string; cell: PanelCell }[];
	/** Directly affected as recorded; not built from its parts, no code (TR-216). */
	directlyAffected: PanelCell;
	refused: { code: string | null; reason: string }[];
}

/** A1: deaths and missing persons per year, with the annual average over the years shown. */
export interface SendaiA1 {
	years: { year: number; deaths: PanelCell; missing: PanelCell }[];
	reference: {
		from: number;
		to: number;
		years: number;
		deaths: PanelCell;
	} | null;
}

/** A2: deaths and missing persons per HIPs type. */
export interface SendaiA2 {
	rows: {
		hipTypeId: string;
		label: string;
		deaths: PanelCell;
		missing: PanelCell;
	}[];
}

/** B1: injured or ill per year, with directly affected (no code) as the toggle. */
export interface SendaiB1 {
	injured: { year: number; cell: PanelCell }[];
	affectedDirect: { year: number; cell: PanelCell }[];
}

/** B2: dwellings destroyed and damaged per year, never added. */
export interface SendaiB2 {
	rows: { year: number; destroyed: PanelCell; damaged: PanelCell }[];
}

/** C1: direct economic loss is a gap; what is held in physical units is listed. */
export interface SendaiC1 {
	gap: SendaiGap;
	/** Records carrying an untyped money value from the source, without currency; not used. */
	untypedMoneyRecords: number;
	units: {
		label: string;
		status: "held" | "source field, not loaded";
		/** Records reporting the unit above 0. Sums are withheld until a plausibility cap exists. */
		records: number;
	}[];
}

/** C2: records reporting damage per linked sector and decade. */
export interface SendaiC2 {
	sectors: { sectorId: string; label: string }[];
	rows: { decade: number; cells: PanelCell[] }[];
}

/** D1: facility counts are held in source fields only. */
export interface SendaiD1 {
	gap: SendaiGap;
	sourceFields: { field: string; label: string; records: number }[];
}

/** D2: disruptions to basic services are not recorded. */
export interface SendaiD2 {
	gap: SendaiGap;
}

export interface SendaiSection {
	/** False under a division or region filter: every code is null. */
	nationalOnly: boolean;
	provisional: boolean;
	/** "Based on n of N records": records reporting any Target A or B figure, a confirmed zero included. */
	coverage: { recordsWith: number; recordsTotal: number };
	s0: SendaiS0;
	a1: SendaiA1;
	a2: SendaiA2;
	b1: SendaiB1;
	b2: SendaiB2;
	c1: SendaiC1;
	c2: SendaiC2;
	d1: SendaiD1;
	d2: SendaiD2;
	meta: Record<SendaiSlot, PanelMeta>;
}
