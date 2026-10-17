// /:lang/analytics: the D1 Analysis dashboard (D1 build brief v0.2), one
// page with four buttons in Alex's order (2026-10-17): Sectors, Hazardous
// events, Disaster events, Disaster impact. The URL carries delta.query/1
// (`dim`) plus `view=sectors`, so every view has a shareable link.
// Disaster impact reads the Analytics loaders; the other three show their
// gap until their loaders land.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	getImpactMap,
	getImpactPanels5to16,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { DashboardDownload } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell, viewLabel } from "~/frontend/analytics/dashboard/DashboardShell";
import { searchForView, viewFromSearch, type DashboardView } from "~/frontend/analytics/dashboard/views";
import { ImpactMap } from "~/frontend/analytics/dashboard/panels/impact/ImpactMap";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import type { DashboardPanel } from "~/frontend/analytics/dashboard/types";
import { ViewContext } from "~/frontend/context";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import { authLoaderPublicOrWithPerm, hasPermission } from "~/utils/auth";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { ImpactMapPayload } from "~/utils/dashboard/impactMap";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import {
	parseDeltaQuery,
	type DeltaQuery,
} from "~/utils/deltaQuery";
import { htmlTitle } from "~/utils/htmlmeta";
import { getCountryAccountsIdFromSession, getCountrySettingsFromSession } from "~/utils/session";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request }: LoaderFunctionArgs) => {
	const params = new URL(request.url).searchParams;
	const { query, issues } = parseDeltaQuery(params);
	const view = viewFromSearch(params, query);
	// A filter that cannot be applied is refused, never silently dropped.
	if (issues.length > 0) {
		throw new Response(JSON.stringify({ refused: issues }), {
			status: 422,
			headers: { "Content-Type": "application/json" },
		});
	}
	// 403 for the provisional basis without ValidateData (AB-01, D7).
	const audience = await approvalAudienceForBasis(request, query.scope.basis);
	const canReview = audience !== "public" && (await hasPermission(request, "ValidateData"));
	// The reviewer queue keeps its own guard (ViewData, signed in); the link follows it.
	const canOpenReviewQueue = audience !== "public" && (await hasPermission(request, "ViewData"));
	const countryAccountsId = await getCountryAccountsIdFromSession(request);
	if (!countryAccountsId) throw new Response("No instance selected", { status: 400 });
	const settings = await getCountrySettingsFromSession(request);
	const country = (settings?.countryName as string | undefined) ?? "";
	const ctx = {
		countryAccountsId,
		audience,
		tenantName: country || null,
		provisional: basisIncludesProvisional(audience),
	};
	// Only the chosen view is read; the others load when their button is pressed.
	const impact =
		view === "disaster_impact"
			? await Promise.all([
					getImpactPanels1to4(query, ctx),
					getImpactPanels5to16(query, ctx),
					getImpactMap(query, ctx),
				])
			: null;
	return {
		query,
		view,
		canReview,
		canOpenReviewQueue,
		// The page-level CSV is for signed-in readers (ruling D6).
		signedIn: audience !== "public",
		provisional: ctx.provisional,
		country,
		impact: impact?.[0] ?? null,
		impactMore: impact?.[1] ?? null,
		impactMap: impact?.[2] ?? null,
		audience,
	};
});

/** The gap shown by a view whose panels are not built yet. */
function inBuild(ctx: ViewContext, view: DashboardView): DashboardPanel[] {
	const gap =
		view === "hazardous_event"
			? {
					code: "G-01",
					text: ctx.t({
						code: "dashboard.no_hazardous_events",
						msg: "No hazardous events recorded. Migrated DesInventar records carry no hazardous-event layer.",
					}),
				}
			: {
					code: view === "disaster_event" ? "D1 step 3" : "D1 sectors",
					text: ctx.t({
						code: "dashboard.view_in_build",
						msg: "Not yet available: the panels for this view are being built.",
					}),
				};
	return [{ id: `${view}-in-build`, n: 1, title: viewLabel(ctx, view), gap }];
}

export default function AnalysisDashboard() {
	const ld = useLoaderData<typeof loader>();
	const ctx = new ViewContext();
	const [, setSearchParams] = useSearchParams();
	const query = ld.query as DeltaQuery;
	const view = ld.view as DashboardView;
	const source = `DELTA ${ld.country}`.trim();
	const impact = ld.impact as ImpactPanels1to4 | null;

	const setView = (next: DashboardView) =>
		setSearchParams(searchForView(query, next), { preventScrollReset: true });

	const panels = impact
		? impactDashboardPanels(ctx, impact, source, {
				data: ld.impactMore as ImpactPanels5to16,
				country: ld.country,
			})
		: inBuild(ctx, view);
	// Until the shared filter bar arrives, the line names the place and basis.
	const summary =
		impact?.scopeText ??
		[ld.country, ld.provisional ? ctx.t({ code: "dashboard.basis_provisional", msg: "Basis: provisional" }) : ctx.t({ code: "dashboard.basis_published", msg: "Basis: published" })]
			.filter(Boolean)
			.join(" · ");

	return (
		<div className="mg-container py-4">
			<DashboardShell
				ctx={ctx}
				view={view}
				onViewChange={setView}
				reviewHref={ld.canOpenReviewQueue ? ctx.url("/analytics/plausibility-review") : undefined}
				summary={summary}
				provisional={ld.provisional}
				map={
					ld.impactMap ? (
						<ImpactMap
							ctx={ctx}
							map={ld.impactMap as ImpactMapPayload}
							scope={{
								tenant: ld.country || null,
								fromDate: query.where.time?.from ?? null,
								toDate: query.where.time?.to ?? null,
								audience: ld.audience,
								provisional: ld.provisional,
							}}
						/>
					) : undefined
				}
				panels={panels}
				download={
					ld.signedIn && impact ? (
						<DashboardDownload
							ctx={ctx}
							title={`${ctx.t({ code: "dashboard.title", msg: "Analysis" })}: ${viewLabel(ctx, view)}`}
							scopeLine={summary}
							source={source}
							basis={ld.provisional ? "provisional" : "published"}
							panels={panels}
						/>
					) : undefined
				}
				about={
					<AboutTheData
						ctx={ctx}
						country={ld.country}
						dimension={view === "sectors" ? "disaster_impact" : view}
						provisional={ld.provisional}
					/>
				}
			/>
		</div>
	);
}

export const meta: MetaFunction = ({ params }) => {
	const ctx = new ViewContext({ lang: params.lang || "en" });
	const title = ctx.t({ code: "meta.analysis_dashboard", msg: "Analysis" });
	return [{ title: htmlTitle(ctx, title) }, { name: "description", content: title }];
};
