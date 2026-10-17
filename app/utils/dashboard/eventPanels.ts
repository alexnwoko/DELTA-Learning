// Payload types for the D1 Analysis dashboard, Disaster events dimension,
// panels 1 to 7 (panel catalogue v0.3 section 4.2). Event counts are plain
// counts of recorded events; human effects over linked records are cells with
// their value state (TR-076). The map (M0) is added once the geoportal's event
// placement (geo.event_atom) is shared, so both surfaces count events per
// province the same way.

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type { ImpactHeadlineMeasure } from "~/utils/dashboard/impactPanels";

/**
 * How an event was formed: GLIDE (a GLIDE number or the GLIDE registry),
 * serial (the guarded country serial rule, RV-1), or entered (recorded
 * directly as an event, not grouped by a migration rule).
 */
export type EventGroupingRule = "glide" | "serial" | "entered";
export const EVENT_GROUPING_RULES: readonly EventGroupingRule[] = [
	"glide",
	"serial",
	"entered",
];

/** Panel 1: headline tiles. */
export interface EventHeadline {
	events: number;
	byRule: Record<EventGroupingRule, number>;
	eventsWithGlide: number;
	/** Records in scope linked to an event, and all records in scope. */
	recordsLinked: number;
	recordsInScope: number;
	/** Deaths over the records linked to the events, with "n of N linked records". */
	deaths: PanelCell;
}

/** Panel 2: record-to-event linkage waffle; the parts sum to recordsInScope. */
export interface EventLinkage {
	linked: Record<EventGroupingRule, number>;
	notLinked: number;
	recordsInScope: number;
}

/** Panel 3: largest events by the chosen measure, top 25. */
export interface LargestEvents {
	measure: ImpactHeadlineMeasure;
	rows: {
		eventId: string;
		name: string;
		glide: string | null;
		startDate: string | null;
		hazardLabel: string;
		rule: EventGroupingRule;
		/** Linked records in the approval basis. */
		records: number;
		/** Level-1 divisions touched by the linked records. */
		divisions: number;
		cell: PanelCell;
	}[];
}

/** Panel 4: events per start year; a year with none is a gap, not 0. */
export interface EventsByYear {
	years: {
		year: number;
		events: number;
		byRule: Record<EventGroupingRule, number>;
	}[];
	eventsWithoutYear: number;
}

/** Panel 5: events per HIPs type of the event ("none" when not coded). */
export interface EventsByHazard {
	rows: { hipTypeId: string; label: string; events: number }[];
}

/** Panel 6: linked records per event, fixed bins. */
export interface RecordsPerEvent {
	bins: {
		label: "1" | "2 to 5" | "6 to 20" | "21 to 100" | "Over 100";
		events: number;
	}[];
	/** Events in scope with no linked record in the approval basis. */
	eventsWithoutRecords: number;
	/** Records in scope not linked to any event: shown apart, "Not grouped". */
	recordsNotGrouped: number;
}

/** Panel 7: event size against the GAR 2015 threshold, per event. */
export interface EventSize {
	threshold: { deaths: 30; housesDestroyed: 600; source: "GAR 2015" };
	intensive: number;
	extensive: number;
	/** Events whose linked records confirm zero deaths and destroy no houses. */
	zeroConfirmed: number;
	/** Events whose linked records report neither deaths nor houses destroyed. */
	notReported: number;
	note: string;
}

export interface EventPanels1to7 {
	headline: EventHeadline;
	linkage: EventLinkage;
	largest: LargestEvents;
	byYear: EventsByYear;
	byHazard: EventsByHazard;
	recordsPerEvent: RecordsPerEvent;
	eventSize: EventSize;
	meta: Record<
		| "headline"
		| "linkage"
		| "largest"
		| "byYear"
		| "byHazard"
		| "recordsPerEvent"
		| "eventSize",
		PanelMeta
	>;
}
