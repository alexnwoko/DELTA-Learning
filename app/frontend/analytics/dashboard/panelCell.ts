// Words for a panel figure (TR-076). A figure is never shown bare: a
// reported value is a number, a confirmed zero says so, and every other
// state shows its word, never 0. Pure module, safe on server and client.
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import type { DContext } from "~/utils/dcontext";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import { STATE_ENCODING } from "~/utils/mapState";
import type { DashboardPanel } from "./types";

/** The figure as the screen shows it: a number or a state word. */
export function cellText(ctx: DContext, cell: PanelCell): string {
	if (cell.valueState === "reported" && cell.value !== null) {
		return cell.value.toLocaleString(ctx.lang);
	}
	// The same words as the map legend and the data table (STATE_ENCODING).
	// A reported state with no value cannot be drawn; say so rather than 0.
	const state = cell.valueState === "reported" ? "not_reported" : cell.valueState;
	return STATE_ENCODING[state].label;
}

/** Records that answered the question: a value or a confirmed zero. */
export function recordsAnswering(cell: PanelCell): number {
	return cell.recordsReported + cell.recordsZeroConfirmed;
}

/** "243 of 534 records report this", the coverage beside every figure (W-8). */
export function coverageText(ctx: DContext, cell: PanelCell): string {
	// No record in scope is no data, never "0 of 0" (Alex, 2026-10-17).
	if (cell.recordsTotal === 0) return noRecordsText(ctx);
	return ctx.t(
		{ code: "dashboard.coverage", msg: "{n} of {total} records report this" },
		{
			n: recordsAnswering(cell).toLocaleString(ctx.lang),
			total: cell.recordsTotal.toLocaleString(ctx.lang),
		},
	);
}

/** "2 flagged for review", or null when none is (C30). */
export function flaggedText(ctx: DContext, cell: PanelCell): string | null {
	if (!cell.recordsFlagged) return null;
	return ctx.t(
		{ code: "dashboard.flagged", msg: "{n} flagged for review" },
		{ n: cell.recordsFlagged.toLocaleString(ctx.lang) },
	);
}

/** A cell as a ChartFrame row: the table, CSV and SVG footer read these. */
export function cellRow(label: string, cell: PanelCell, series?: string): ChartExportRow {
	return {
		label,
		series,
		// Only a reported value or a confirmed zero is a number (TR-076).
		value:
			cell.valueState === "reported" || cell.valueState === "zero_confirmed" ? cell.value : null,
		valueState: cell.valueState,
		recordsFlagged: cell.recordsFlagged,
	};
}

/** What a panel exports: the rows its chart draws and its caption notes. */
export interface PanelExport {
	rows: ChartExportRow[];
	method: string;
	notes: string[];
}

/** Caption notes: the panel's own lines, then coverage and unapplied filters. */
export function panelNotes(meta: PanelMeta, own: (string | undefined)[] = []): string[] {
	return [...own, meta.coverage, ...meta.notApplied.map((f) => `Not applied: ${f}`)].filter(
		(n): n is string => Boolean(n),
	);
}

/** The words for an empty scope: no data is never shown as 0. */
export function noRecordsText(ctx: DContext): string {
	return ctx.t({ code: "dashboard.no_records_in_scope", msg: "No records in scope" });
}

/** One frame across a view when nothing is in scope (Alex, 2026-10-17). */
export function emptyViewPanel(id: string, title: string, reason: string): DashboardPanel {
	return { id: `${id}-empty`, n: 1, title, gap: { text: reason } };
}
