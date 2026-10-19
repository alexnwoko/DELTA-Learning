// Payload types for the D1 Analysis dashboard, Disaster events view, panels
// 11, 12, 13 and 16 (reassessment DE-11, DE-12, DE-13, DE-16; Alex,
// 2026-10-19: build what the data holds). Counts are counts of disaster
// events or of their linked disaster records, never one for the other.

import type { EventGroupingRule } from "~/utils/dashboard/eventPanels";
import type {
	ImpactHeadlineMeasure,
	PanelMeta,
} from "~/utils/dashboard/impactPanels";

/** Panel 11: the disaster event register, newest first. */
export interface EventRegister {
	rows: {
		eventId: string;
		name: string;
		startDate: string | null;
		endDate: string | null;
		hazardLabel: string;
		rule: EventGroupingRule;
		glide: string | null;
		nationalId: string | null;
		/** Linked disaster records in the approval basis. */
		records: number;
		/** Level-1 divisions of the linked records. */
		divisions: number;
	}[];
	/** Events in scope; the register lists the newest EVENT_REGISTER_TOP. */
	eventsInScope: number;
}

/** Panel 12: how many events in scope fill each field. */
export interface EventCompleteness {
	eventsInScope: number;
	rows: {
		key:
			| "name"
			| "start_day"
			| "start_year_only"
			| "end_date"
			| "hazard_type"
			| "specific_hazard"
			| "glide"
			| "national_id"
			| "linked_records"
			| "places";
		label: string;
		/** Events filling the field; a count of events, 0 is a finding. */
		events: number;
	}[];
}

/** Panel 13: events by how many level-1 divisions their records touch. */
export interface DivisionsPerEvent {
	bins: { label: string; events: number }[];
	/** Events whose linked records name no division. */
	eventsWithoutDivision: number;
}

/** Panel 16: events with at least one linked record reporting damage per sector. */
export interface EventsBySector {
	rows: { sectorId: string; label: string; events: number }[];
	/** Events none of whose linked records reports sector damage. */
	eventsWithoutSector: number;
}

/**
 * Panel DE-17: empirical exceedance of the chosen human effect per disaster
 * event. Each point is one event with a reported value: how many events in
 * scope reached at least that value, per year of the record, and the
 * empirical return period (years / rank). Built from recorded events only;
 * not a hazard or risk model, and short records give unstable tails.
 */
export interface EventExceedance {
	measure: ImpactHeadlineMeasure;
	/** Years from the first to the last event start year in scope. */
	years: number | null;
	points: {
		eventId: string;
		name: string;
		value: number;
		/** Events in scope at or above this value. */
		rank: number;
		/** rank / years: events per year at or above the value. */
		perYear: number | null;
		/** years / rank. */
		returnPeriodYears: number | null;
	}[];
	/** Events in scope with no reported value for the measure (left out). */
	eventsNotReported: number;
	/** True when fewer than EXCEEDANCE_MIN_EVENTS events report a value. */
	tooFewEvents: boolean;
}

/** Panel DE-21: disaster events by start month, per year. */
export interface EventSeason {
	cells: { year: number; month: number; events: number }[];
	/** Events with a start year but no month: counted, not drawn. */
	eventsWithoutMonth: number;
}

export interface EventPanels8to16 {
	register: EventRegister;
	completeness: EventCompleteness;
	divisionsPerEvent: DivisionsPerEvent;
	bySector: EventsBySector;
	exceedance: EventExceedance;
	season: EventSeason;
	meta: Record<
		| "register"
		| "completeness"
		| "divisionsPerEvent"
		| "bySector"
		| "exceedance"
		| "season",
		PanelMeta
	>;
}
