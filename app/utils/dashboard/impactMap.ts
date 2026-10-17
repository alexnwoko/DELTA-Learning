// Payload for the D1 Disaster impact map (slot M0): rounded bars of
// dwellings destroyed and damaged over areas shaded by the number of deaths
// (Alex, 2026-10-17). Every figure keeps its value state (TR-076). Areas are
// sub-national, so no figure carries a Sendai indicator code (TR-060).

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";

export interface ImpactMapArea {
	divisionId: string;
	name: string;
	/**
	 * The division's shape as GeoJSON, simplified to about 500 m from
	 * division.geom (the stored division.geojson when geom is absent); null
	 * when the division has neither, so it is listed beside the map.
	 */
	geojson: unknown | null;
	/** ST_PointOnSurface, [lng, lat], where the bars stand. */
	labelPoint: [number, number] | null;
	/** Shading: the number of deaths recorded in the area. */
	deaths: PanelCell;
	/** Bars, never added: dwellings destroyed and damaged. */
	dwellingsDestroyed: PanelCell;
	dwellingsDamaged: PanelCell;
}

export interface ImpactMapPayload {
	/** Level-1 divisions of the tenant, every one listed, reported or not. */
	areas: ImpactMapArea[];
	/** Records in scope with no division: shown beside the map, not on it. */
	recordsWithoutDivision: number;
	/** A record in several divisions counts in each: areas do not add up. */
	multiDivisionRecords: number;
	legend: {
		shading: "Number of deaths";
		bars: ["Dwellings destroyed", "Dwellings damaged"];
		note: "Sub-national figures. Not a Sendai indicator value.";
	};
	meta: PanelMeta;
}
