// Payload types for the D1 Analysis dashboard, Sectors view (view=sectors),
// panels 1 to 7 (DELTA_Dashboard_Sectors_Panels.md, section 3). Sectors read
// disaster-impact records by level-2 sector. Damage and losses never share a
// cell, axis or total; money stays gap G-06 until the money convention (D-04).

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";

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

export interface SectorPanels1to7 {
	headline: SectorHeadline;
	reporting: SectorsReporting;
	effectTypes: EffectTypeMatrix;
	hazardBySector: HazardBySector;
	byYear: SectorByYear;
	dwellings: DwellingsPanel;
	sendai: SectorSendaiCrosswalk;
	meta: Record<
		| "headline"
		| "reporting"
		| "effectTypes"
		| "hazardBySector"
		| "byYear"
		| "dwellings"
		| "sendai",
		PanelMeta
	>;
}
