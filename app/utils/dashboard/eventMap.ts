// Payload for the D1 map (slot M0) on the Disaster events and Hazardous
// events views: bubbles of the number of events per level-1 division, with
// the same areas as the Disaster impact map. Events are placed by the
// geoportal's one rule (geo.event_atom through eventCountsByDivision), so the
// dashboard and the geoportal give the same number per province.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";

export interface EventMapArea {
	divisionId: string;
	name: string;
	geojson: unknown | null;
	labelPoint: [number, number] | null;
	/** Events counted in the division; an event in several counts in each. 0 reads "No events recorded". */
	events: number;
	/** Of those, events placed where their member records are (no own division link). */
	fromRecords: number;
}

export interface EventMapPayload {
	dimension: "disaster_event" | "hazardous_event";
	areas: EventMapArea[];
	/** Events in scope that could not be placed at level 1, with their reasons. */
	unplacedEvents: number;
	unplacedReasons: Record<string, number>;
	legend: {
		symbol: "Number of events";
		note: "An event in several provinces counts in each, so provinces do not add up.";
	};
	meta: PanelMeta;
}
