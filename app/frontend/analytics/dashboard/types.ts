// The D1 Analysis dashboard's building blocks (D1 build brief, sections 2
// and 3): one panel per question, numbered 1 to 16 per dimension.
import type React from "react";
import type { PanelExport } from "./panelCell";
import type { DashboardView } from "./views";

/** Why a panel has nothing to draw yet (panels paper, section 6). */
export interface PanelGap {
	/** Gap code, for example "G-01". */
	code: string;
	/** Already translated: what the panel shows instead of a chart. */
	text: string;
	/**
	 * A count that explains the gap, for example draft records held. null
	 * when there is none; never 0 standing in for "nothing" (decision 1).
	 */
	count?: number | null;
	/** Already translated: what the count counts, for example "draft records". */
	countLabel?: string;
}

export interface DashboardPanel {
	/** Stable id, used for anchors and print sections, e.g. "impact-3". */
	id: string;
	/** Position 1 to 16; 13 to 16 sit under "Show more". */
	n: number;
	/** Already translated. */
	title: string;
	/** Set when the panel has no data yet; the panel then shows its gap. */
	gap?: PanelGap | null;
	/** Draws the panel (normally a ChartFrame). Not called for a gap panel. */
	render?: () => React.ReactNode;
	/** The panel's rows and notes, for the page-level CSV. */
	exportData?: PanelExport;
}

/** Panels shown by default; the rest wait under "Show more". */
export const DEFAULT_PANEL_COUNT = 12;

/**
 * Decision 1 (accepted 2026-10-16): while G-01 holds, empty panels on the
 * two event dimensions fold into one "Not yet available" strip; on Disaster
 * impact each empty panel keeps its own frame with its reason.
 */
export function collapsesGaps(view: DashboardView): boolean {
	return view === "hazardous_event" || view === "disaster_event";
}
