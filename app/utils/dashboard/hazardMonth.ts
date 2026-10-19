// Payload type for the hazard-by-month panel on the Disaster impact and
// Disaster events views (Alex, 2026-10-19): every hazard by calendar month,
// years pooled, with a switch between the number of occurrences and the
// people affected, so that months where few occurrences carry a high human
// toll stand out (rare severe outliers), as a lead toward cascades and an
// anticipatory action window.

import type {
	ImpactHeadlineMeasure,
	PanelCell,
	PanelMeta,
} from "~/utils/dashboard/impactPanels";

export interface HazardMonth {
	/** "disaster_record" on Disaster impact; "disaster_event" on Disaster events. */
	unit: "disaster_record" | "disaster_event";
	/** The human effect the people switch shows. */
	measure: ImpactHeadlineMeasure;
	rows: {
		/** HIPs cluster; "none" when no cluster is recorded. */
		hipClusterId: string;
		label: string;
		/** HIPs type of the cluster, for grouping rows. */
		hipTypeId: string | null;
		/** Occurrences with a month, all years. */
		total: number;
		/** All 12 months, in order; a month with no occurrence has count 0. */
		cells: {
			month: number;
			/** Records or events (see unit) starting in this month. */
			count: number;
			/** People affected in those occurrences; not_reported when none reports. */
			people: PanelCell;
			/**
			 * Few occurrences carrying a high toll, by the rule in meta.method
			 * (RARE_SEVERE_RULE); computed server-side.
			 */
			rare: boolean;
		}[];
	}[];
	/** Occurrences in scope with a start year but no month: counted, not drawn. */
	withoutMonth: number;
	/**
	 * Occurrences on a placeholder date (PLACEHOLDER_DATE_RULE), such as a
	 * calendar day used as a default: counted, not drawn, never a month.
	 */
	placeholderDates: number;
	years: { from: number; to: number } | null;
	meta: PanelMeta;
}
