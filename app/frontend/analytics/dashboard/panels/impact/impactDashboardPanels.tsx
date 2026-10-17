// The Disaster impact panel set (panels paper v0.3, section 4.3): panels 1
// to 4 draw from the loader payload; 5 to 16 follow in D1 step 2 and say so
// in their frame meanwhile (decision 1 (a): each keeps its own frame).
import type { ViewContext } from "~/frontend/context";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { DashboardPanel } from "../../types";
import { CoverageWaffle } from "./CoverageWaffle";
import { HazardRanking } from "./HazardRanking";
import { HeadlineTiles } from "./HeadlineTiles";
import { ImpactTimeline } from "./ImpactTimeline";
import { impactMeasureLabel } from "./measureLabels";

/** Titles of panels 5 to 16, in the paper's order. */
function laterPanelTitles(ctx: ViewContext): [number, string][] {
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	return [
		[5, t("dashboard.impact_5", "Sendai Targets A and B counts")],
		[6, t("dashboard.impact_6", "Hazard by human effect")],
		[7, t("dashboard.impact_7", "Ranked divisions")],
		[8, t("dashboard.impact_8", "Hazard by sector")],
		[9, t("dashboard.impact_9", "People moved")],
		[10, t("dashboard.impact_10", "Houses destroyed and damaged")],
		[11, t("dashboard.impact_11", "Largest records")],
		[12, t("dashboard.impact_12", "Reporting completeness and precision")],
		[13, t("dashboard.impact_13", "Season of impact")],
		[14, t("dashboard.impact_14", "Period change by division")],
		[15, t("dashboard.impact_15", "Extensive and intensive risk")],
		[16, t("dashboard.impact_16", "Disaggregation")],
	];
}

export function impactDashboardPanels(
	ctx: ViewContext,
	data: ImpactPanels1to4,
	source: string,
): DashboardPanel[] {
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const common = { ctx, source, scope: data.scopeText, provisional: data.provisional };
	const ready: DashboardPanel[] = [
		{
			id: "impact-1",
			n: 1,
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
			title: t("dashboard.impact_4", "Hazard ranking"),
			render: () => (
				<HazardRanking
					{...common}
					title={t("dashboard.impact_4", "Hazard ranking")}
					measureLabel={impactMeasureLabel(ctx, data.timeline.measure)}
					rows={data.hazardRanking}
					meta={data.meta.hazardRanking}
				/>
			),
		},
	];
	const later = laterPanelTitles(ctx).map(
		([n, title]): DashboardPanel => ({
			id: `impact-${n}`,
			n,
			title,
			gap: {
				code: "D1 step 2",
				text: t("dashboard.panel_in_build", "This panel is being built."),
			},
		}),
	);
	return [...ready, ...later];
}
