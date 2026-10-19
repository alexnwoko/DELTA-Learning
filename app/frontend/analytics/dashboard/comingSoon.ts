// Features Coming Soon (Alex, 2026-10-19): every unbuilt or not-ready
// feature per view, from DELTA_Analytics_Full_Design_Reassessment.md
// section 4 (Analytics, 2026-10-19). "Placeholder" features wait for data
// or a schema change and say what for; "buildable" ones are being built by
// Analytics and end "coming soon". A feature whose id has a slot in the
// view's layout draws a grey placeholder there; the rest list in the strip
// with their chart type. Descriptions are 12 words or fewer.
import type { ViewContext } from "~/frontend/context";
import type { GhostShape } from "./GhostChart";
import { chartTypeLabel } from "./PanelGrid";
import type { DashboardPanel } from "./types";

export interface ComingSoon {
	/** Panel id; numbers follow the dashboard catalogue (DE-14 is events-14). */
	id: string;
	/** Catalogue number, for order within the strip. */
	n: number;
	title: string;
	desc: string;
	shape: GhostShape;
}

const soon = (id: string, n: number, title: string, desc: string, shape: GhostShape): ComingSoon => ({ id, n, title, desc, shape });

export const COMING_SOON: Record<"events" | "hazard-events" | "sectors" | "impact", readonly ComingSoon[]> = {
	events: [
		soon("events-8", 8, "Declaration, warning and response timeline", "Declaration, warning and response dates per event; waits for those records.", "line"),
		soon("events-9", 9, "Event chain", "Records and events that chain together; coming soon.", "flow"),
		soon("events-10", 10, "Approval and assessment status", "Events by approval and assessment state; coming soon.", "bars"),
		soon("events-11", 11, "Disaster event register", "Every event with its identifiers, dates and hazard; coming soon.", "table"),
		soon("events-12", 12, "Reporting completeness of disaster events", "How complete each event field is, by year; coming soon.", "heatmap"),
		soon("events-13", 13, "Divisions per disaster event", "How many divisions each event touched; coming soon.", "dots"),
		soon("events-14", 14, "Official warning recorded, by hazard", "Share of events with an official warning recorded; waits for warning data.", "bars"),
		soon("events-15", 15, "Compare disaster events", "Two to four events side by side; coming soon.", "bars"),
		soon("events-16", 16, "Disaster events by sector", "Which sectors each event hit; coming soon.", "heatmap"),
		soon("events-17", 17, "Exceedance and return period", "How often an event of each size is exceeded; coming soon.", "line"),
		soon("events-18", 18, "Onset class and member start-date span", "Rapid or slow onset, and days between member records; coming soon.", "boxplot"),
		soon("events-19", 19, "Identifiers and cross-references", "Events carrying GLIDE, national and registry identifiers; coming soon.", "tiles"),
		soon("events-20", 20, "Events with several hazards", "Events that group records of several hazard types; coming soon.", "bars"),
		soon("events-21", 21, "Season of disaster events", "Months in which disaster events start; coming soon.", "heatmap"),
		soon("events-22", 22, "Response, humanitarian and recovery costs", "Response, humanitarian and recovery costs per event; waits for cost data.", "bars"),
		soon("events-23", 23, "Damage and losses in money per event", "Damage and losses in money per event, kept apart; waits for valuation.", "columns"),
		soon("events-24", 24, "Non-economic losses per event", "Non-economic losses reported per event; waits for non-economic loss records.", "table"),
		soon("events-25", 25, "Sources and links", "Sources and links cited for each event; waits for source entries.", "table"),
		soon("events-26", 26, "Parent and child events", "Parent and child events, such as a season of floods; waits for links.", "flow"),
	],
	"hazard-events": [
		soon("hazard-events-m0", 0, "Hazardous event map", "Map of where hazardous events occurred; waits for hazardous-event places.", "map"),
		soon("hazard-events-8", 8, "Hazard by division", "Places hit by several hazard types; waits for hazardous-event places.", "map"),
		soon("hazard-events-9", 9, "Hazardous events linked to disaster impact", "Hazardous events that led to disaster events; waits for links.", "flow"),
		soon("hazard-events-10", 10, "Cascade and multi-hazard links", "Hazards that triggered other hazards; waits for recorded cause links.", "flow"),
		soon("hazard-events-11", 11, "Hazardous event register", "List of hazardous events with dates, hazard and places; waits for records.", "table"),
		soon("hazard-events-12", 12, "Reporting completeness of hazardous events", "How complete each hazardous-event field is; waits for records.", "bars"),
		soon("hazard-events-13", 13, "Hazard hierarchy", "Events across hazard types, clusters and hazards; waits for records.", "boxes"),
		soon("hazard-events-14", 14, "Trends per hazard type", "Yearly count per hazard type; waits for hazardous-event records.", "line"),
		soon("hazard-events-15", 15, "Duration of hazardous events by onset class", "How long sudden and slow hazards last; waits for end dates.", "boxplot"),
		soon("hazard-events-16", 16, "Magnitude of hazardous events by hazard", "Strength of each event in its hazard's unit; waits for numeric magnitude.", "dots"),
		soon("hazard-events-17", 17, "Forecast and observed", "When forecasted hazards were later observed; waits for status history.", "dots"),
		soon("hazard-events-18", 18, "National hazard names", "National hazard names matched to HIPs hazards; waits for records.", "table"),
		soon("hazard-events-19", 19, "Approval state", "Hazardous events by approval state; waits for hazardous-event records.", "bars"),
		soon("hazard-events-20", 20, "Sources and originators", "Who recorded each hazardous event; waits for source fields.", "bars"),
	],
	sectors: [
		soon("sectors-m0", 0, "Sector map", "Where records report sector damage; coming soon.", "map"),
		soon("sectors-src", 9, "Source fields not yet loaded", "Sector quantities still held in source fields; coming soon.", "table"),
		soon("sectors-10", 10, "Records with several sectors", "How often one record hits several sectors; coming soon.", "columns"),
		soon("sectors-11", 11, "Sector effects by disaster event", "Which disaster events hit which sectors; coming soon.", "table"),
		soon("sectors-12", 12, "Largest sector records", "Records reporting the largest sector damage; coming soon.", "table"),
		soon("sectors-14", 14, "Asset types available and used", "Which asset types exist and which records use; coming soon.", "table"),
		soon("sectors-15", 15, "Sector tree", "How records spread over the sector tree; coming soon.", "table"),
		soon("sectors-16", 16, "Sector damage by decade", "How sector damage has changed by decade; coming soon.", "heatmap"),
		soon("sectors-17", 17, "Source sector flags not yet linked", "Records flagging the seven sectors not yet linked; coming soon.", "bars"),
		soon("sectors-18", 18, "Damage cost by sector", "Repair and replacement cost of damage by sector; waits for valuation.", "bars"),
		soon("sectors-19", 19, "Losses by sector", "Losses by sector, public and private; waits for losses records.", "bars"),
		soon("sectors-20", 20, "Disruption by sector", "Service disruption by sector, duration and users; waits for disruption records.", "heatmap"),
		soon("sectors-21", 21, "Agriculture losses by type", "Agriculture losses by type of production; waits for losses records.", "bars"),
		soon("sectors-22", 22, "Sectors covered by assessments", "Sectors covered by each damage and loss assessment; waits for assessments.", "table"),
	],
	impact: [
		soon("impact-18", 18, "Reporting sources", "Which sources report the records; coming soon.", "bars"),
		soon("impact-19", 19, "Duration recorded at source", "How long effects lasted, per hazard, as recorded; coming soon.", "boxplot"),
		soon("impact-20", 20, "Displacement timing", "Pre-emptive or reactive, temporary or permanent displacement; coming soon.", "bars"),
		soon("impact-21", 21, "Losses by hazard", "Losses in money by hazard, apart from damage; waits for losses records.", "bars"),
		soon("impact-22", 22, "Direct economic loss", "Direct economic loss by hazard; waits for currency and valuation rules.", "columns"),
		soon("impact-23", 23, "Disruption of basic services", "Basic services disrupted, duration and users; waits for disruption records.", "bars"),
		soon("impact-24", 24, "Non-economic losses", "Non-economic losses by category, such as heritage; waits for records.", "boxes"),
		soon("impact-25", 25, "Point locations", "Exact places of damage on the map; waits for point locations.", "map"),
		soon("impact-26", 26, "Rates per population", "Deaths and affected per 100,000 people; waits for population data.", "map"),
		soon("impact-27", 27, "Poverty disaggregation", "Human effects by poverty status; waits for disaggregated records.", "bars"),
	],
};

/** Hazardous events 1 to 7 in their grey state: what each will show (reassessment 4.2). */
export const HAZARD_GREY: Record<number, string> = {
	1: "Counts of recorded, linked and mapped hazardous events; waits for records.",
	2: "Hazards recorded as ongoing or forecasted; waits for hazardous-event records.",
	3: "Hazardous events starting each year; waits for hazardous-event records.",
	4: "Months in which hazardous events start; waits for records.",
	5: "Hazard types recorded most often; waits for hazardous-event records.",
	6: "How deeply events are coded in HIPs; waits for records.",
	7: "Places recording the most hazardous events; waits for records.",
};

/** The grey-state description of hazardous events panel n (1 to 16). */
export function hazardGreyText(ctx: ViewContext, n: number): string {
	const later = COMING_SOON["hazard-events"].find((f) => f.id === `hazard-events-${n}`);
	const msg = HAZARD_GREY[n] ?? later?.desc ?? "";
	return ctx.t({ code: n <= 7 ? `dashboard.hazard_events_grey${n}` : `dashboard.soon_hazard_events_${n}`, msg });
}

/**
 * The view's unbuilt features as gap panels. A feature with a slot in the
 * layout keeps a grey placeholder there; the rest carry no ghost, so the
 * grid lists them in Features Coming Soon with their chart type. Ids the
 * view already draws are skipped, so a feature leaves the list the day its
 * panel is built.
 */
export function comingSoonPanels(
	ctx: ViewContext,
	view: keyof typeof COMING_SOON,
	layout: readonly string[],
	drawn: readonly DashboardPanel[],
): DashboardPanel[] {
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const have = new Set(drawn.filter((p) => !p.gap).map((p) => p.id));
	return COMING_SOON[view]
		.filter((f) => !have.has(f.id))
		.map((f): DashboardPanel => {
			const key = f.id.replace(/-/g, "_");
			const text = t(`dashboard.soon_${key}`, f.desc);
			const slotted = layout.includes(f.id);
			return {
				id: f.id,
				n: 100 + f.n,
				title: t(`dashboard.soon_${key}_title`, f.title),
				gap: slotted
					? { text, ghost: f.shape }
					: { text, chartType: chartTypeLabel(ctx, { text, ghost: f.shape }) ?? undefined },
			};
		});
}
