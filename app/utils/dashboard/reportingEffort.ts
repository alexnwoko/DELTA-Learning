// Payload type for the reporting effort panel (FR-AN-090): per start year, how
// many records, reporting divisions and sources stand behind the data, so a
// rise in records can be read apart from a rise in disasters.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";

export interface ReportingEffortYear {
	year: number;
	records: number;
	/** Distinct divisions with a record, at the query's admin level. */
	divisions: number;
	/** Distinct primary data sources, by exact text after trimming. */
	sources: number;
	/** Records per reporting division; null under the minimum divisions. */
	recordsPerDivision: number | null;
}

export interface ReportingEffort {
	/** Years holding at least one record, in order. */
	years: ReportingEffortYear[];
	/** Records with no start year: counted, not drawn. */
	recordsNoYear: number;
	/** Fewest divisions in a year for the ratio to be shown. */
	minDivisions: number;
	note: string;
	meta: PanelMeta;
}
