// Payload types for the D1 Analysis dashboard, Sectors view (view=sectors),
// panels 1 to 7 (DELTA_Dashboard_Sectors_Panels.md, section 3). Sectors read
// disaster-impact records by level-2 sector. Damage and losses never share a
// cell, axis or total; money stays gap G-06 until the money convention (D-04).

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type { RankedDivisions } from "~/utils/dashboard/impactPanels5to16";

export interface SectorRef {
	sectorId: string;
	label: string;
	level: number;
	parentId: string | null;
}

export interface SectorGap {
	code: "G-04" | "G-06" | "G-08" | "G-22";
	reason: string;
}

/** Panel 1: headline tiles. Damage and losses are separate tiles. */
export interface SectorHeadline {
	/** Records in scope reporting damage in any sector (flag or counted dwelling row). */
	recordsAnySector: PanelCell;
	sectorsLinked: { linked: number; level2Total: number };
	dwellingsDamaged: PanelCell;
	dwellingsDestroyed: PanelCell;
	/** Records reporting losses in any sector; no loss rows exist in migrated data. */
	losses: PanelCell;
	money: SectorGap;
}

/** Panel 2: records reporting damage per level-2 sector, under level-1 headings. */
export interface SectorsReporting {
	groups: {
		level1: SectorRef;
		rows: { sector: SectorRef; records: PanelCell }[];
	}[];
}

/** Panel 3: damage, losses and disruption per linked sector, as states. */
export interface EffectTypeMatrix {
	columns: ["damage_physical", "damage_money", "losses", "disruption"];
	rows: {
		sector: SectorRef;
		damagePhysical: PanelCell;
		damageMoney: SectorGap;
		losses: PanelCell;
		disruption: PanelCell;
	}[];
}

/** Panel 4: records reporting damage per HIPs type and linked sector. */
export interface HazardBySector {
	sectors: SectorRef[];
	rows: { hipTypeId: string; label: string; cells: PanelCell[] }[];
}

/** Panel 5: records reporting damage per sector and start year. */
export interface SectorByYear {
	series: {
		sector: SectorRef;
		years: { year: number; records: PanelCell }[];
	}[];
	/** Sector-linked records in scope with no start year: counted, not drawn. */
	recordsWithoutYear: number;
}

/** Panel 6: dwellings damaged and destroyed, two bars never added. */
export interface DwellingsPanel {
	groupBy: "hipType" | "year";
	rows: {
		key: string;
		label: string;
		damaged: PanelCell;
		destroyed: PanelCell;
	}[];
}

/** Panel 7: what DELTA holds towards Sendai Targets C and D, by sector. */
export interface SectorSendaiCrosswalk {
	/** False under a place filter: indicator codes are dropped (TR-060). */
	nationalOnly: boolean;
	rows: {
		code: string | null;
		indicator: string;
		heldLabel: string;
		held: PanelCell | null;
		status: "COUNT" | "MONEY" | "NOT_HELD";
		gap: SectorGap | null;
	}[];
}

/**
 * Ranked by divisions: records reporting damage in any sector (or the chosen
 * sectors) per level-1 division. A record with only explicit "no" answers is
 * a confirmed zero; a record that says nothing is not reported. Same shape as
 * the Disaster impact panel, so one component draws both.
 */
export type SectorRankedDivisions = RankedDivisions;

/**
 * Sector reporting completeness: per level-2 sector, how many records in
 * scope answer each question (yes or an explicit no) out of all records.
 * These are counts of records, not figures: 0 answers means no record
 * answered, which is itself the finding.
 */
export interface SectorCompleteness {
	recordsTotal: number;
	rows: {
		sector: SectorRef;
		damage: { yes: number; no: number };
		losses: { yes: number; no: number };
		disruption: { yes: number; no: number };
	}[];
}

/**
 * Records with several sectors (reassessment SEC-10): among records reporting
 * damage in at least one level-2 sector, how many sectors each reports, and
 * the sector pairs reported together most often. Counts of records.
 */
export interface MultiSectorRecords {
	recordsWithSector: number;
	bins: { label: string; records: number }[];
	pairs: { a: SectorRef; b: SectorRef; records: number }[];
}

/**
 * Set when no record is in scope. The view then shows one frame with the
 * reason instead of panels of zeros: no data is never drawn as 0.
 */
export interface SectorsEmpty {
	reason: "No records in scope for these filters.";
}

export interface SectorPanels1to7 {
	empty: SectorsEmpty | null;
	headline: SectorHeadline;
	reporting: SectorsReporting;
	effectTypes: EffectTypeMatrix;
	hazardBySector: HazardBySector;
	byYear: SectorByYear;
	dwellings: DwellingsPanel;
	sendai: SectorSendaiCrosswalk;
	rankedDivisions: SectorRankedDivisions;
	completeness: SectorCompleteness;
	multiSector: MultiSectorRecords;
	meta: Record<
		| "headline"
		| "reporting"
		| "effectTypes"
		| "hazardBySector"
		| "byYear"
		| "dwellings"
		| "sendai"
		| "rankedDivisions"
		| "completeness"
		| "multiSector",
		PanelMeta
	>;
}
