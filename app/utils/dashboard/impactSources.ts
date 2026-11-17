// Payload type for the D1 Analysis dashboard, Disaster impact view, panel
// DI-18 "Reporting sources" (reassessment, 2026-10-19): who reported the
// disaster records in scope. Sources are free text at entry; they are
// grouped by exact text after trimming, never merged by guesswork.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";

export interface ImpactSources {
	/** The most frequent sources, most records first. */
	rows: { source: string; records: number }[];
	/** Records from the other sources, and how many sources that is. */
	rest: { sources: number; records: number } | null;
	/** Records in scope with no source recorded. */
	recordsWithoutSource: number;
	recordsInScope: number;
	/** Distinct source texts in scope. */
	distinctSources: number;
	meta: PanelMeta;
}
