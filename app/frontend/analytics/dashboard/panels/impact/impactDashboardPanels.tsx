// The Disaster impact panel set (panels paper v0.3, section 4.3): panels 1
// to 4 from the first payload, 5 to 16 from the second (panels5to16.tsx).
import type { ViewContext } from "~/frontend/context";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import type { ImpactSources } from "~/utils/dashboard/impactSources";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import { cellRow, panelNotes } from "../../panelCell";
import { RowBars } from "../blocks";
import { emptyViewPanel } from "../../panelCell";
import { comingSoonPanels } from "../../comingSoon";
import { arrangeByLayout } from "../../layout";
import type { DashboardPanel } from "../../types";
import { CoverageWaffle, waffleExport } from "./CoverageWaffle";
import { HazardRanking, rankingExport } from "./HazardRanking";
import { HeadlineTiles, headlineExport } from "./HeadlineTiles";
import { ImpactTimeline, timelineExport } from "./ImpactTimeline";
import { impactMeasureLabel } from "./measureLabels";
import { impactPanels5to16 } from "./panels5to16";

/**
 * The Disaster impact layout (Alex, 2026-10-18), two panels a row, left
 * then right. Panels not listed (largest records, season, period change,
 * extensive and intensive risk) wait under "Show more", in number order.
 * Panel 5 (Sendai counts) is not listed: the Sendai section carries it.
 */
export const IMPACT_LAYOUT: readonly string[] = [
	"impact-1", "impact-7", // Human effects at a glance | Ranked by divisions
	"impact-4", "impact-3", // Hazard ranking by disaster impact | Human effects by year
	"impact-6", "impact-8", // Hazard by human effect | Hazard by sector
	"impact-10", "impact-9", // Houses destroyed and damaged | People displaced, evacuated and relocated
	"impact-2", "impact-12", // Coverage of the records | Reporting completeness and precision
	"impact-16", // Disaster impact by sex and age disaggregation
];

/** Places each panel by IMPACT_LAYOUT; the rest follow, under "Show more". */
export function arrangeImpactPanels(panels: DashboardPanel[]): DashboardPanel[] {
	return arrangeByLayout(panels, IMPACT_LAYOUT);
}

export function impactDashboardPanels(
	ctx: ViewContext,
	data: ImpactPanels1to4,
	source: string,
	later?: { data: ImpactPanels5to16; country: string; subnational?: boolean; sources?: ImpactSources | null },
): DashboardPanel[] {
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	// No record in scope: one frame, never tiles and bars of 0 (Alex, 2026-10-17).
	if (data.coverage.recordsTotal === 0) {
		return [emptyViewPanel("impact", t("dashboard.dim_disaster_impact", "Disaster impact"), t("dashboard.impact_empty", "No records in scope for these filters."))];
	}
	const common = { ctx, source, scope: data.scopeText, provisional: data.provisional };
	const ready: DashboardPanel[] = [
		{
			id: "impact-1",
			n: 1,
			exportData: headlineExport(ctx, data.tiles, data.meta.tiles),
			title: t("dashboard.impact_1", "Human effects at a glance"),
			render: () => (
				<HeadlineTiles
					{...common}
					title={t("dashboard.impact_1", "Human effects at a glance")}
					tiles={data.tiles}
					meta={data.meta.tiles}
				/>
			),
		},
		{
			id: "impact-2",
			n: 2,
			exportData: waffleExport(ctx, data.coverage, data.meta.coverage),
			title: t("dashboard.impact_2", "Coverage of the records"),
			render: () => (
				<CoverageWaffle
					{...common}
					title={t("dashboard.impact_2", "Coverage of the records")}
					coverage={data.coverage}
					meta={data.meta.coverage}
				/>
			),
		},
		{
			id: "impact-3",
			n: 3,
			exportData: timelineExport(ctx, data.timeline, data.meta.timeline, "all"),
			title: t("dashboard.impact_3", "Human effects by year"),
			render: () => (
				<ImpactTimeline
					{...common}
					title={t("dashboard.impact_3", "Human effects by year")}
					timeline={data.timeline}
					meta={data.meta.timeline}
				/>
			),
		},
		{
			id: "impact-4",
			n: 4,
			exportData: rankingExport(data.hazardRanking, data.meta.hazardRanking),
			title: t("dashboard.impact_4", "Hazard ranking by disaster impact"),
			render: () => (
				<HazardRanking
					{...common}
					title={t("dashboard.impact_4", "Hazard ranking by disaster impact")}
					measureLabel={impactMeasureLabel(ctx, data.timeline.measure)}
					rows={data.hazardRanking}
					meta={data.meta.hazardRanking}
				/>
			),
		},
	];
	const rest = later
		? impactPanels5to16(ctx, later.data, {
				source,
				scope: data.scopeText,
				provisional: data.provisional,
				country: later.country,
				subnational: later.subnational,
			})
		: [];
	// Unbuilt features (Alex, 2026-10-19): Features Coming Soon.
	const sources = later?.sources ? [impactSourcesPanel(ctx, later.sources, common)] : [];
	const built = [...ready, ...rest, ...sources];
	return arrangeImpactPanels([...built, ...comingSoonPanels(ctx, "impact", IMPACT_LAYOUT, built)]);
}

/** A count as a reported cell, for the bars. */
const recordsCell = (n: number) => ({ value: n, valueState: "reported" as const, recordsReported: n, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: n, recordsFlagged: 0 });

/**
 * DI-18 Reporting sources (Analytics fe24a633): records per primary data
 * source as entered, grouped by exact text, never merged by guesswork.
 */
function impactSourcesPanel(
	ctx: ViewContext,
	d: ImpactSources,
	common: { ctx: ViewContext; source: string; scope: string; provisional: boolean },
): DashboardPanel {
	const t = (code: string, msg: string, r?: Record<string, unknown>) => ctx.t({ code, msg }, r);
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const title = t("dashboard.impact_18", "Reporting sources");
	const restLabel = d.rest ? t("dashboard.other_sources", "{n} other sources", { n: n(d.rest.sources) }) : "";
	const rows = [...d.rows.map((r) => ({ label: r.source, n: r.records })), ...(d.rest ? [{ label: restLabel, n: d.rest.records }] : [])];
	const notes = [
		t("dashboard.sources_distinct", "{n} distinct sources, grouped by their exact text.", { n: n(d.distinctSources) }),
		d.recordsWithoutSource > 0 ? t("dashboard.sources_none", "{n} of {total} records name no source.", { n: n(d.recordsWithoutSource), total: n(d.recordsInScope) }) : undefined,
	];
	const exportData = { rows: rows.map((r) => cellRow(r.label, recordsCell(r.n))), method: d.meta.method, notes: panelNotes(d.meta, notes) };
	return {
		id: "impact-18",
		n: 18,
		title,
		exportData,
		render: () => (
			<ChartFrame ctx={ctx} title={title} rows={exportData.rows}
				meta={{ source: common.source, scope: common.scope, method: d.meta.method, basis: common.provisional ? "provisional" : "published", notes: exportData.notes }}>
				<RowBars ctx={ctx} label={title} rows={rows.map((r) => ({ key: r.label, label: r.label, bars: [{ cell: recordsCell(r.n) }] }))} />
				{notes.filter(Boolean).map((x) => <p key={x} className="m-0 text-xs text-brand-text-muted">{x}</p>)}
			</ChartFrame>
		),
	};
}
