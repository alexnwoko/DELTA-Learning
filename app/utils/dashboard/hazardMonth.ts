// Payload type for the hazard-by-month panel on the Disaster impact and
// Disaster events views (Alex, 2026-10-19): every hazard by calendar month,
// years pooled, with a switch between the number of occurrences and the
// people affected, so that months where few occurrences carry a high human
// toll stand out (rare severe outliers), as a lead toward cascades and an
// anticipatory action window.
//
// Rows are specific HIPs hazards (Drought, Flooding), so a reader finds the
// hazard by its name; a record coded only to a cluster gets a cluster row.
// Occurrences with no usable month are never dropped: each row counts them,
// so a hazard whose dates are source defaults still shows, with the reason.

import type {
	ImpactHeadlineMeasure,
	PanelCell,
	PanelMeta,
} from "~/utils/dashboard/impactPanels";

export interface HazardMonthRow {
	/** Row key: the HIPs hazard id, "cluster:<id>" or "none". */
	key: string;
	/** "hazard" (specific HIPs hazard), "cluster" (coded to a cluster only) or "none". */
	level: "hazard" | "cluster" | "none";
	/** Specific hazard name, cluster name, or "Hazard not coded". */
	label: string;
	/** HIPs hazard id when level is "hazard". */
	hipHazardId: string | null;
	/** HIPs cluster and its name, for grouping rows. */
	hipClusterId: string | null;
	clusterLabel: string | null;
	/** HIPs type of the cluster. */
	hipTypeId: string | null;
	/** Occurrences with a usable month, all years. */
	total: number;
	/** All occurrences of the hazard in scope, with or without a usable month. */
	allOccurrences: number;
	/** People affected over the dated occurrences; value states as everywhere. */
	people: PanelCell;
	/** Occurrences left out of the months, and why. */
	unplaced: {
		/** On a placeholder date (a source default such as 7 September). */
		placeholder: number;
		/** With a start year but no month. */
		noMonth: number;
	};
	/** All 12 months, in order; a month with no occurrence has count 0. */
	cells: {
		month: number;
		/** Records or events (see unit) starting in this month. */
		count: number;
		/** People affected in those occurrences; not_reported when none reports. */
		people: PanelCell;
		/** Few occurrences carrying a high toll (RARE_SEVERE_RULE), server-side. */
		rare: boolean;
	}[];
}

export interface HazardMonth {
	/** "disaster_record" on Disaster impact; "disaster_event" on Disaster events. */
	unit: "disaster_record" | "disaster_event";
	/** The human effect the people switch shows. */
	measure: ImpactHeadlineMeasure;
	rows: HazardMonthRow[];
	/** Occurrences in scope with a start year but no month: counted, not drawn. */
	withoutMonth: number;
	/** Occurrences on a placeholder date: counted, not drawn, never a month. */
	placeholderDates: number;
	/** The calendar days found to be placeholders ("MM-DD"), with their counts. */
	placeholderDays: { day: string; occurrences: number }[];
	years: { from: number; to: number } | null;
	meta: PanelMeta;
}
