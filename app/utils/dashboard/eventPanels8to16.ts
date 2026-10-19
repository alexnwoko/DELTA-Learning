// Payload types for the D1 Analysis dashboard, Disaster events view, panels
// 11, 12, 13 and 16 (reassessment DE-11, DE-12, DE-13, DE-16; Alex,
// 2026-10-19: build what the data holds). Counts are counts of disaster
// events or of their linked disaster records, never one for the other.

import type { EventGroupingRule } from "~/utils/dashboard/eventPanels";
import type { PanelMeta } from "~/utils/dashboard/impactPanels";

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

export interface EventPanels8to16 {
	register: EventRegister;
	completeness: EventCompleteness;
	divisionsPerEvent: DivisionsPerEvent;
	bySector: EventsBySector;
	meta: Record<
		"register" | "completeness" | "divisionsPerEvent" | "bySector",
		PanelMeta
	>;
}
