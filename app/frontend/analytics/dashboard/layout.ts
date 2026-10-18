// Panel layouts, two panels a row, left then right (Alex, 2026-10-18).
// Every view follows one logic: headline, then where (Ranked by divisions),
// what leads and when, the cross-tabulations, the physical outcomes, then
// coverage and reporting completeness. Panels not listed wait under "Show
// more", in number order. FE_Proposal_02_Dashboard_Layouts.md has the
// reasons for each view.
import { panelPosition, type DashboardPanel } from "./types";

/** Places each panel by the layout; the rest follow, under "Show more"; dropped ids are left out. */
export function arrangeByLayout(panels: DashboardPanel[], layout: readonly string[], drop: readonly string[] = []): DashboardPanel[] {
	return panels
		.filter((p) => !drop.includes(p.id))
		.map((p) => {
			const at = layout.indexOf(p.id);
			return at >= 0 ? { ...p, order: at + 1, more: false } : { ...p, order: 100 + p.n, more: true };
		})
		.sort((a, b) => panelPosition(a) - panelPosition(b));
}

export const EVENTS_LAYOUT: readonly string[] = [
	"events-1", "events-divisions", // at a glance | Ranked by divisions
	"events-5", "events-4", // Hazard ranking by disaster events | Disaster events by year
	"events-3", "events-16", // Largest disaster events by disaster impact | Disaster events by sector
	"events-7", "events-13", // Extensive and intensive risk by disaster event | Divisions per disaster event
	"events-2", "events-12", // Records grouped into disaster events | Reporting completeness of disaster events
];
/**
 * "Official warning recorded, by hazard" is left out until the flag can say
 * "not reported": it defaults to false, so every event would read as having
 * had no warning (FE-Proposal-02, decision 6).
 */
export const EVENTS_DROPPED: readonly string[] = ["events-14"];

export const HAZARD_EVENTS_LAYOUT: readonly string[] = [
	"hazard-events-1", "hazard-events-7", // at a glance | Ranked by divisions
	"hazard-events-5", "hazard-events-3", // Hazard ranking by hazardous events | by year
	"hazard-events-8", "hazard-events-9", // Hazard by division | Linked to disaster impact
	"hazard-events-2", "hazard-events-4", // ongoing or forecasted | by month of onset
	"hazard-events-6", "hazard-events-12", // classification depth | Reporting completeness
];

/**
 * Sectors: Ranked by divisions and Sector reporting completeness slot in at
 * row 1 right and after Houses when Analytics delivers them; the Sendai C
 * and D inputs table waits under Show more (the Sendai section carries C
 * and D on the other views).
 */
export const SECTORS_LAYOUT: readonly string[] = [
	"sectors-1", "sectors-divisions", // at a glance | Ranked by divisions (to come)
	"sectors-2", "sectors-5", // Sector ranking by records reporting damage | Sector damage by year
	"sectors-3", "sectors-4", // Damage, losses and disruption by sector | Hazard by sector
	"sectors-6", "sectors-completeness", // Houses destroyed and damaged | Sector reporting completeness (to come)
];
