// /:lang/analytics: the D1 Analysis dashboard (D1 build brief v0.2), one
// page with four buttons in Alex's order (2026-10-17): Sectors, Hazardous
// events, Disaster events, Disaster impact. The URL carries delta.query/1
// (`dim`) plus `view=sectors`, so every view has a shareable link.
// Each view reads its own Analytics loader, only when it is shown.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { getEventMap } from "~/backend.server/models/analytics/dashboard/eventMap.server";
import { getTenantOutline, neighbourOutlines, worldBoundariesUrl } from "~/backend.server/models/geo/tenantExtent";
import { getEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/eventPanels.server";
import { getEventPanels8to16 } from "~/backend.server/models/analytics/dashboard/eventPanels8to16.server";
import { getImpactSources } from "~/backend.server/models/analytics/dashboard/impactSources.server";
import { getHazardMonth } from "~/backend.server/models/analytics/dashboard/hazardMonth.server";
import { getEstimatedDisaggregation } from "~/backend.server/models/analytics/dashboard/estimatedDisaggregation.server";
import { getRecordsByApproval } from "~/backend.server/models/analytics/dashboard/recordsByApproval.server";
import { getSendaiSection } from "~/backend.server/models/analytics/dashboard/sendaiPanels.server";
import { getHazardEventPanels1to7 } from "~/backend.server/models/analytics/dashboard/hazardEventPanels.server";
import { getSectorPanels1to7 } from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	getImpactMap,
	getImpactPanels5to16,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { HazardRail, withHazardType } from "~/frontend/analytics/dashboard/HazardRail";
import { chipsFor, measuresFor } from "~/frontend/analytics/dashboard/filterDefinitions";
import { getDashboardFilterOptions } from "~/frontend/analytics/dashboard/filterOptions.server";
import { GeoFilterBar } from "~/frontend/geoportal/GeoFilterBar";
import { querySummary } from "~/frontend/geoportal/filterBarState";
import type { GeoT } from "~/frontend/geoportal/i18n";
import { BasisSwitch, PublishedBasisNotice, type ApprovalCounts } from "~/frontend/analytics/dashboard/BasisControls";
import { DashboardDownload } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell, viewLabel } from "~/frontend/analytics/dashboard/DashboardShell";
import { hasSendai, searchFor, sfmFromSearch, toggleDivision, viewFromSearch, type DashboardView } from "~/frontend/analytics/dashboard/views";
import { SendaiSectionView, SendaiToggle, downloadPanels, sendaiSectionPanels } from "~/frontend/analytics/dashboard/panels/sendai/sendaiSection";
import { EventMap } from "~/frontend/analytics/dashboard/panels/events/EventMap";
import { eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { hazardEventDashboardPanels } from "~/frontend/analytics/dashboard/panels/hazards/hazardEventPanels";
import { ImpactMap } from "~/frontend/analytics/dashboard/panels/impact/ImpactMap";
import { sectorDashboardPanels } from "~/frontend/analytics/dashboard/panels/sectors/sectorPanels";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import type { DashboardPanel } from "~/frontend/analytics/dashboard/types";
import {
	events8to16FromFirstRecord,
	eventsFromFirstRecord,
	hazardEventsFromFirstRecord,
	impact1to4FromFirstRecord,
	impact5to16FromFirstRecord,
	sectorsFromFirstRecord,
	sendaiFromFirstRecord,
	type FirstYear,
} from "~/frontend/analytics/dashboard/firstRecord";
import { ViewContext } from "~/frontend/context";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import { authLoaderPublicOrWithPerm, hasPermission } from "~/utils/auth";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { EventMapPayload } from "~/utils/dashboard/eventMap";
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import type { EventPanels8to16 } from "~/utils/dashboard/eventPanels8to16";
import type { ImpactSources } from "~/utils/dashboard/impactSources";
import type { HazardMonth } from "~/utils/dashboard/hazardMonth";
import type { EstimatedDisaggregation } from "~/utils/dashboard/estimatedDisaggregation";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import type { ImpactMapPayload } from "~/utils/dashboard/impactMap";
import type { SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import type { SendaiSection } from "~/utils/dashboard/sendaiPanels";
import type { DashboardFilterOptions } from "~/frontend/analytics/dashboard/filterOptions.server";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import {
	parseDeltaQuery,
	type DeltaQuery,
} from "~/utils/deltaQuery";
import { selectableBasemaps } from "~/utils/basemap";
import { basemapLayers } from "~/utils/basemap.server";
import { htmlTitle } from "~/utils/htmlmeta";
import { getCountryAccountsIdFromSession, getCountrySettingsFromSession } from "~/utils/session";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request, params: routeParams }: LoaderFunctionArgs) => {
	const url = new URL(request.url);
	const params = url.searchParams;
	const { query, issues } = parseDeltaQuery(params);
	const view = viewFromSearch(params, query);
	// The Sendai Framework Monitoring toggle (sfm=1), outside delta.query/1.
	// Ignored on a view without the Sendai section.
	const sfm = sfmFromSearch(params) && hasSendai(view);
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
	// The country's name: the instance settings, else the country account's own
	// name (the cached tenant outline), so "About the data" and the Sendai
	// notice never print a blank (Geoportal's PDF check, 2026-10-19).
	const country =
		(settings?.countryName as string | undefined) || (await getTenantOutline(countryAccountsId)).name || "";
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
					// DI-18 Reporting sources (Analytics fe24a633).
					getImpactSources(query, ctx),
					// Hazard by month, records (Alex, 2026-10-19; Analytics 0071b980).
					getHazardMonth(query, ctx, "disaster_record"),
					// Estimated sex and age split (Analytics 40a0d72b).
					getEstimatedDisaggregation(query, ctx),
				])
			: null;
	const events = view === "disaster_event" ? await getEventPanels1to7(query, ctx) : null;
	// Panels 11, 12, 13 and 16 (Analytics ee73e61f); none while the view is empty.
	const eventsMore = events && !events.empty ? await getEventPanels8to16(query, ctx) : null;
	const eventsHazardMonth = events && !events.empty ? await getHazardMonth(query, ctx, "disaster_event") : null;
	const hazardEvents = view === "hazardous_event" ? await getHazardEventPanels1to7(query, ctx) : null;
	const sectors = view === "sectors" ? await getSectorPanels1to7(query, ctx) : null;
	// The Sendai section, the same on Disaster events and Disaster impact, and
	// absent (no section, no toggle) on the other views (Alex, 2026-10-18;
	// FR-AN-020, FR-AN-024).
	const sendai = hasSendai(view) ? await getSendaiSection(query, ctx) : null;
	// Every dimension has a map (Alex, 2026-10-17). A view with no hazardous
	// event at all (G-01) shows its one frame instead.
	const eventMap =
		view === "disaster_event" || (view === "hazardous_event" && !hazardEvents?.empty)
			? await getEventMap(query, ctx, view)
			: null;
	// Under every map (Alex, 2026-10-18): the basemaps, the first on by
	// default (TR-166 amended; public pages get self-hosted layers only), and
	// the country outline with its name and its neighbours. Read only when a
	// map is drawn.
	const hasMap = impact !== null || eventMap !== null;
	// Neighbouring countries in thinner grey under the outline; none until
	// the admin0 layer is seeded.
	// The world's countries behind them (Geoportal's admin0 layer; null until loaded).
	const [outline, neighbours, worldUrl] = hasMap
		? await Promise.all([
				getTenantOutline(countryAccountsId),
				neighbourOutlines(countryAccountsId),
				worldBoundariesUrl(routeParams.lang ?? "en"),
			])
		: [null, [], null];
	const mapLayers = hasMap
		? {
				basemaps: selectableBasemaps(
					basemapLayers(url.origin, routeParams.lang ?? "en"),
					audience === "public" ? "public" : "signed-in",
				),
				boundaries: outline
					? {
							outline: outline.geojson,
							countryLabelPoint: outline.labelPoint,
							countryName: outline.name ?? (country || null),
							neighbours,
							world: worldUrl ? { url: worldUrl, iso3: outline.iso3 ?? null } : null,
						}
					: undefined,
			}
		: null;
	// The shared filter bar's options: hazard tree, divisions and regions.
	const filterOptions = await getDashboardFilterOptions(countryAccountsId, query, audience, routeParams.lang ?? "en");
	// For the G-00 notice: only the published basis can be empty this way.
	const approvalCounts = query.scope.basis === "published" ? await getRecordsByApproval(query, ctx) : null;
	return {
		query,
		view,
		events,
		eventsMore,
		eventsHazardMonth,
		hazardEvents,
		sectors,
		eventMap,
		mapLayers,
		filterOptions,
		sendai,
		sfm,
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
		impactSources: impact?.[3] ?? null,
		impactHazardMonth: impact?.[4] ?? null,
		impactEstimated: impact?.[5] ?? null,
		audience,
	};
});

export default function AnalysisDashboard() {
	const ld = useLoaderData<typeof loader>();
	const ctx = new ViewContext();
	const [, setSearchParams] = useSearchParams();
	const sfm = ld.sfm as boolean;
	// Every move keeps the view, the filters and the Sendai toggle in the URL.
	// Each move, the Sendai toggle included, pushes a history entry: the
	// toggle swaps the whole content like the view buttons do, so Back
	// returns the reader to the page as they last saw it.
	const go = (q: DeltaQuery, v: DashboardView, sfmOn = sfm) =>
		setSearchParams(searchFor(q, v, sfmOn), { preventScrollReset: true });
	const query = ld.query as DeltaQuery;
	const view = ld.view as DashboardView;
	const source = `DELTA ${ld.country}`.trim();
	const filterOptions = ld.filterOptions as DashboardFilterOptions;
	// Every chart starts at its own first period with data (Alex, 2026-10-20),
	// not at the country's first record year.
	const firstYear: FirstYear = null;
	const impact = ld.impact ? impact1to4FromFirstRecord(ld.impact as ImpactPanels1to4, firstYear) : null;
	const impactMore = ld.impactMore ? impact5to16FromFirstRecord(ld.impactMore as ImpactPanels5to16, firstYear) : null;
	const events = ld.events ? eventsFromFirstRecord(ld.events as EventPanels1to7, firstYear) : null;
	const hazardEvents = ld.hazardEvents ? hazardEventsFromFirstRecord(ld.hazardEvents as HazardEventPanels1to7, firstYear) : null;
	const sectors = ld.sectors ? sectorsFromFirstRecord(ld.sectors as SectorPanels1to7, firstYear) : null;

	const setView = (next: DashboardView) =>
		go(query, next);
	const setBasis = (basis: DeltaQuery["scope"]["basis"]) =>
		go({ ...query, scope: { ...query.scope, basis } }, view);

	// Until the shared filter bar arrives, the line names the place and basis.
	const geoT = ctx.t as unknown as GeoT;
	// A map click sets the place filter; clicking the selected area clears it.
	const selectDivision = (divisionId: string) =>
		go(toggleDivision(query, divisionId), view);
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
	const sendai = ld.sendai ? sendaiFromFirstRecord(ld.sendai as SendaiSection, firstYear) : null;
	const sendaiPanels = sendai ? sendaiSectionPanels(ctx, sendai, { source, scope: summary, country: ld.country }) : [];
	const viewPanels: DashboardPanel[] = impact
		? impactDashboardPanels(ctx, impact, source, {
				data: impactMore as ImpactPanels5to16,
				country: ld.country,
				// A place filter makes every figure sub-national: no Sendai codes (TR-060).
				subnational: Boolean(query.where.geo || query.where.region),
				sources: ld.impactSources as ImpactSources | null,
				hazardMonth: ld.impactHazardMonth as HazardMonth | null,
				estimated: ld.impactEstimated as EstimatedDisaggregation | null,
			})
		: events
			? eventDashboardPanels(ctx, events, { ...opts, map: ld.eventMap as EventMapPayload | null, more: ld.eventsMore ? events8to16FromFirstRecord(ld.eventsMore as EventPanels8to16, firstYear) : null, hazardMonth: ld.eventsHazardMonth as HazardMonth | null })
			: hazardEvents
				? hazardEventDashboardPanels(ctx, hazardEvents, { ...opts, signedIn: ld.signedIn })
				: sectors
					? sectorDashboardPanels(ctx, sectors, { ...opts, country: ld.country })
					: [];
	// The Sendai section shows the Targets A and B counts (S0): the impact
	// panel 5 table would repeat it, so it leaves the view list then.
	const panels = sendai ? viewPanels.filter((p) => p.id !== "impact-5") : viewPanels;

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
				country={ld.country || null}
				rail={
					<HazardRail
						ctx={ctx}
						tree={filterOptions.hazardTree}
						selected={query.where.hazard?.typeId ?? null}
						onChange={(typeId) =>
							go(withHazardType(query, typeId), view)
						}
						// The tree counts records: no count on the two event views.
						showCounts={view === "disaster_impact" || view === "sectors"}
					/>
				}
				filterBar={
					<GeoFilterBar
						query={query}
						level={1}
						levels={[1]}
						// The header's Basis switch is the one basis control on this page.
						canReview={false}
						onChange={({ query: next }) =>
							go(next, view)
						}
						hazardTree={filterOptions.hazardTree}
						dimensionControl="none"
						measures={measuresFor(view)}
						chips={chipsFor(view, { hazardTree: filterOptions.hazardTree, sectors: sectorChips })}
						place={filterOptions.place}
						levelControl={false}
						notApplied={notApplied}
						summary={false}
						layout="row"
						years={filterOptions.years}
						end={
							sendai ? <SendaiToggle ctx={ctx} on={sfm} onChange={(on) => go(query, view, on)} /> : undefined
						}
						t={geoT}
					/>
				}
				provisional={ld.provisional}
				map={
					// An empty view shows its one frame, with no map of empty areas.
					panels.some((p) => p.id.endsWith("-empty")) ? undefined : ld.impactMap ? (
						<ImpactMap ctx={ctx} map={ld.impactMap as ImpactMapPayload} scope={mapScope} onSelectDivision={selectDivision} layers={ld.mapLayers ?? undefined} />
					) : ld.eventMap ? (
						<EventMap ctx={ctx} map={ld.eventMap as EventMapPayload} scope={mapScope} onSelectDivision={selectDivision} layers={ld.mapLayers ?? undefined} />
					) : undefined
				}
				sendai={sendai ? <SendaiSectionView ctx={ctx} d={sendai} panels={sendaiPanels} country={ld.country} /> : undefined}
				sfmOn={sfm && Boolean(sendai)}
				panels={panels}
				download={
					ld.signedIn && [...sendaiPanels, ...panels].some((p) => p.exportData) ? (
						<DashboardDownload
							ctx={ctx}
							title={`${ctx.t({ code: "dashboard.title", msg: "Analysis" })}: ${viewLabel(ctx, view)}`}
							scopeLine={summary}
							source={source}
							basis={ld.provisional ? "provisional" : "published"}
							panels={downloadPanels(sendaiPanels, panels, sfm && Boolean(sendai))}
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
