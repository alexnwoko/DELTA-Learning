// Payload type for the records behind a month cell of Hazard by month
// (FR-AN-068): the disaster records a figure is built from, so a reader can
// check a rare severe or "Under review" cell against its sources.

import type {
	ImpactHeadlineMeasure,
	PanelMeta,
} from "~/utils/dashboard/impactPanels";

export interface CellRecord {
	recordId: string;
	startDate: string | null;
	/** Division names the record is linked to; empty when none is recorded. */
	places: string[];
	/** The measure's value; null when the record does not report it, never 0. */
	value: number | null;
	valueState: "reported" | "zero_confirmed" | "not_reported";
	/** Plausibility flags on the record, by code; the value stays as recorded. */
	flags: string[];
	/** The record is under review for this measure. */
	underReview: boolean;
	/** Primary data source, as recorded. */
	source: string | null;
}

export interface CellRecords {
	/** Row key from Hazard by month: hazard id, "cluster:<id>" or "none". */
	key: string;
	month: number;
	measure: ImpactHeadlineMeasure;
	/** Largest reported value first; records not reporting it last. */
	records: CellRecord[];
	/** All the records in the cell, which can exceed the records listed. */
	total: number;
	meta: PanelMeta;
}
