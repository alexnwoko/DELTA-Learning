// /:lang/analytics: the D1 Analysis dashboard (D1 build brief v0.2), one
// page with four buttons in Alex's order (2026-10-17): Sectors, Hazardous
// events, Disaster events, Disaster impact. The URL carries delta.query/1
// (`dim`) plus `view=sectors`, so every view has a shareable link.
// Each view reads its own Analytics loader, only when it is shown.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { getEventMap } from "~/backend.server/models/analytics/dashboard/eventMap.server";
import { getEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/eventPanels.server";
import { getRecordsByApproval } from "~/backend.server/models/analytics/dashboard/recordsByApproval.server";
import { getHazardEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/hazardEventPanels.server";
import { getSectorPanels1to7 } from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	getImpactMap,
	getImpactPanels5to16,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { chipsFor, measuresFor } from "~/frontend/analytics/dashboard/filterDefinitions";
import { getDashboardFilterOptions } from "~/frontend/analytics/dashboard/filterOptions.server";
import { GeoFilterBar } from "~/frontend/geoportal/GeoFilterBar";
import { querySummary } from "~/frontend/geoportal/filterBarState";
import type { GeoT } from "~/frontend/geoportal/i18n";
import { BasisSwitch, PublishedBasisNotice, type ApprovalCounts } from "~/frontend/analytics/dashboard/BasisControls";
import { DashboardDownload } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell, viewLabel } from "~/frontend/analytics/dashboard/DashboardShell";
import { searchForView, viewFromSearch, type DashboardView } from "~/frontend/analytics/dashboard/views";
import { EventMap } from "~/frontend/analytics/dashboard/panels/events/EventMap";
import { eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { hazardEventDashboardPanels } from "~/frontend/analytics/dashboard/panels/hazards/hazardEventPanels";
import { ImpactMap } from "~/frontend/analytics/dashboard/panels/impact/ImpactMap";
import { sectorDashboardPanels } from "~/frontend/analytics/dashboard/panels/sectors/sectorPanels";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import type { DashboardPanel } from "~/frontend/analytics/dashboard/types";
import { ViewContext } from "~/frontend/context";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import { authLoaderPublicOrWithPerm, hasPermission } from "~/utils/auth";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { EventMapPayload } from "~/utils/dashboard/eventMap";
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import type { ImpactMapPayload } from "~/utils/dashboard/impactMap";
import type { SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import type { DashboardFilterOptions } from "~/frontend/analytics/dashboard/filterOptions.server";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import {
	parseDeltaQuery,
	type DeltaQuery,
} from "~/utils/deltaQuery";
import { htmlTitle } from "~/utils/htmlmeta";
import { getCountryAccountsIdFromSession, getCountrySettingsFromSession } from "~/utils/session";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request, params: routeParams }: LoaderFunctionArgs) => {
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
	const events = view === "disaster_event" ? await getEventPanels1to7(query, ctx) : null;
	const hazardEvents = view === "hazardous_event" ? await getHazardEventPanels1to7(query, ctx) : null;
	const sectors = view === "sectors" ? await getSectorPanels1to7(query, ctx) : null;
	// Every dimension has a map (Alex, 2026-10-17). A view with no hazardous
	// event at all (G-01) shows its one frame instead.
	const eventMap =
		view === "disaster_event" || (view === "hazardous_event" && !hazardEvents?.empty)
			? await getEventMap(query, ctx, view)
			: null;
	// The shared filter bar's options: hazard tree, divisions and regions.
	const filterOptions = await getDashboardFilterOptions(countryAccountsId, query, audience, routeParams.lang ?? "en");
	// For the G-00 notice: only the published basis can be empty this way.
	const approvalCounts = query.scope.basis === "published" ? await getRecordsByApproval(query, ctx) : null;
	return {
		query,
		view,
		events,
		hazardEvents,
		sectors,
		eventMap,
		filterOptions,
		approvalCounts: approvalCounts as ApprovalCounts | null,
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
	const setBasis = (basis: DeltaQuery["scope"]["basis"]) =>
		setSearchParams(searchForView({ ...query, scope: { ...query.scope, basis } }, view), {
			preventScrollReset: true,
		});

	// Until the shared filter bar arrives, the line names the place and basis.
	const geoT = ctx.t as unknown as GeoT;
	const filterOptions = ld.filterOptions as DashboardFilterOptions;
	// The same words as the geoportal bar's summary (querySummary).
	const summary = querySummary(query, { scopeLabel: ld.country || undefined, hazardTree: filterOptions.hazardTree }, geoT);
	// Filters the current view's loader could not apply, named on the bar.
	const notApplied: string[] =
		(impact?.meta.tiles.notApplied ??
			(ld.events as EventPanels1to7 | null)?.meta.headline.notApplied ??
			(ld.hazardEvents as HazardEventPanels1to7 | null)?.meta.notApplied ??
			(ld.sectors as SectorPanels1to7 | null)?.meta.headline.notApplied ??
			[]) as string[];
	const sectorChips = (ld.sectors as SectorPanels1to7 | null)?.reporting.groups.flatMap((g) =>
		g.rows.map((r) => ({ id: r.sector.sectorId, label: r.sector.label })),
	);

	const opts = { source, scope: summary, provisional: ld.provisional };
	const mapScope = {
		tenant: ld.country || null,
		fromDate: query.where.time?.from ?? null,
		toDate: query.where.time?.to ?? null,
		audience: ld.audience,
		provisional: ld.provisional,
	};
	const panels: DashboardPanel[] = impact
		? impactDashboardPanels(ctx, impact, source, {
				data: ld.impactMore as ImpactPanels5to16,
				country: ld.country,
			})
		: ld.events
			? eventDashboardPanels(ctx, ld.events as EventPanels1to7, opts)
			: ld.hazardEvents
				? hazardEventDashboardPanels(ctx, ld.hazardEvents as HazardEventPanels1to7, { ...opts, signedIn: ld.signedIn })
				: ld.sectors
					? sectorDashboardPanels(ctx, ld.sectors as SectorPanels1to7, { ...opts, country: ld.country })
					: [];

	return (
		<div className="mg-container py-4">
			<DashboardShell
				ctx={ctx}
				view={view}
				onViewChange={setView}
				reviewHref={ld.canOpenReviewQueue ? ctx.url("/analytics/plausibility-review") : undefined}
				basisControl={
					ld.canReview ? <BasisSwitch ctx={ctx} basis={query.scope.basis} onChange={setBasis} /> : undefined
				}
				notice={
					query.scope.basis === "published" ? (
						<PublishedBasisNotice
							ctx={ctx}
							counts={ld.approvalCounts as ApprovalCounts | null}
							canReview={ld.canReview}
							onShowUnpublished={() => setBasis("provisional")}
						/>
					) : undefined
				}
				summary={summary}
				filterBar={
					<GeoFilterBar
						query={query}
						level={1}
						levels={[1]}
						// The header's Basis switch is the one basis control on this page.
						canReview={false}
						onChange={({ query: next }) =>
							setSearchParams(searchForView(next, view), { preventScrollReset: true })
						}
						hazardTree={filterOptions.hazardTree}
						dimensionControl="none"
						measures={measuresFor(view)}
						chips={chipsFor(view, { hazardTree: filterOptions.hazardTree, sectors: sectorChips })}
						place={filterOptions.place}
						levelControl={false}
						presets={[1, 3, 5, 10]}
						notApplied={notApplied}
						summary={false}
						t={geoT}
					/>
				}
				provisional={ld.provisional}
				map={
					ld.impactMap ? (
						<ImpactMap ctx={ctx} map={ld.impactMap as ImpactMapPayload} scope={mapScope} />
					) : ld.eventMap ? (
						<EventMap ctx={ctx} map={ld.eventMap as EventMapPayload} scope={mapScope} />
					) : undefined
				}
				panels={panels}
				download={
					ld.signedIn && panels.some((p) => p.exportData) ? (
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
