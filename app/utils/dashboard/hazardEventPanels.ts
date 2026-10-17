// Payload types for the D1 Analysis dashboard, Hazardous events dimension,
// panels 1 to 7 (panel catalogue v0.3 section 4.1). Counts are plain counts of
// recorded hazardous events. Migrated tenants hold none (DesInventar has no
// hazardous-event entity), so the payload says so with gap G-01 rather than
// drawing zeros.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";

export interface HazardEventsEmpty {
	code: "G-01";
	reason: "No hazardous events recorded. Migrated data holds none; only events entered in DELTA appear here.";
}

/** Panel 1: headline tiles; shares are n of the events in scope. */
export interface HazardEventHeadline {
	events: number;
	ongoingOrForecasted: number;
	linkedToDisasterEvent: number;
	withFootprint: number;
	codedAtHazardLevel: number;
}

/** Panel 2: events recorded as ongoing or forecasted. */
export interface OngoingHazardEvents {
	rows: {
		eventId: string;
		hazardLabel: string;
		status: "ongoing" | "forecasted";
		startDate: string | null;
		divisions: number;
		dataSource: string | null;
		lastUpdate: string | null;
	}[];
}

/** Panel 3: events per start year; a year with none is a gap. */
export interface HazardEventsByYear {
	years: { year: number; events: number }[];
	eventsWithoutYear: number;
}

/** Panel 4: season of onset, events with month precision only. */
export interface HazardEventSeason {
	cells: { year: number; month: number; events: number }[];
	eventsWithoutMonth: number;
}

/** Panel 5: events per HIPs type. */
export interface HazardEventsByHazard {
	rows: { hipTypeId: string; label: string; events: number }[];
}

/** Panel 6: classification depth per HIPs type. */
export interface HazardEventDepth {
	rows: {
		hipTypeId: string;
		label: string;
		typeOnly: number;
		cluster: number;
		specificHazard: number;
	}[];
}

/** Panel 7: level-1 divisions by event count, top 15. */
export interface HazardEventDivisions {
	rows: { divisionId: string; name: string; events: number }[];
	/** Level-1 divisions with no event recorded: listed as such, never a zero bar. */
	divisionsWithoutEvents: number;
	/** An event in several divisions counts in each. */
	multiDivisionEvents: number;
}

export interface HazardEventPanels1to7 {
	/** Set when no hazardous event is in scope; the panels then show this. */
	empty: HazardEventsEmpty | null;
	headline: HazardEventHeadline;
	ongoing: OngoingHazardEvents;
	byYear: HazardEventsByYear;
	season: HazardEventSeason;
	byHazard: HazardEventsByHazard;
	depth: HazardEventDepth;
	divisions: HazardEventDivisions;
	meta: PanelMeta;
}
