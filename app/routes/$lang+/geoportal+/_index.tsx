// Geoportal map page (increment I-2, design review 2026-10-16). The map is
// the page: a question bar on top, a full-height map with its legend card
// and readout, and a side panel with the place dossier and the ranked area
// list (TR-182, TR-176). The loader resolves the request exactly as the geo
// API does (resolveGeoRequest), so the page and the API never disagree.
// Signed-in only until the public routes (TR-181, TR-236) land in R1.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
	useLoaderData,
	useNavigate,
	useParams,
	type MetaFunction,
} from "react-router";
import {
	Button,
	Dialog,
	DialogTrigger,
	Heading,
	Modal,
	ModalOverlay,
	Switch,
	Tab,
	TabList,
	TabPanel,
	Tabs,
} from "react-aria-components";
import { sql } from "drizzle-orm";

import { dr } from "~/db.server";
import { MainContainer } from "~/frontend/container";
import { ViewContext } from "~/frontend/context";
import { ClientOnly } from "~/frontend/analytics/sectors/sections/ClientOnly";
import { GeoLegend } from "~/frontend/geoportal/GeoLegend";
import {
	GeoTable,
	rankRows,
	type GeoTableRow,
} from "~/frontend/geoportal/GeoTable";
import {
	GeoFilterBar,
	type HazardTree,
} from "~/frontend/geoportal/GeoFilterBar";
import { GeoReadout } from "~/frontend/geoportal/GeoReadout";
import { GeoDossier, type DossierData } from "~/frontend/geoportal/GeoDossier";
import { measureFamily, toMapCell } from "~/frontend/geoportal/geoCells";
import { refusalText } from "~/frontend/geoportal/refusals";
import type { GeoT } from "~/frontend/geoportal/i18n";
import {
	GeoRefusalWithMeta,
	resolveGeoRequest,
} from "~/backend.server/handlers/geo";
import {
	getBoundaries,
	getChoropleth,
	getHazardTree,
	refusalBody,
} from "~/backend.server/models/geo/queries";
import { authLoaderWithPerm, hasPermission } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";
import { serializeDeltaQuery, type DeltaQuery } from "~/utils/deltaQuery";
import { resolveMapState } from "~/utils/mapState";
import { GEO_DIMENSION_LABELS, geoMeasureInfo } from "~/utils/geoMeasures";
import { htmlTitle } from "~/utils/htmlmeta";
import { basemapConfig } from "~/utils/basemap.server";

// OpenLayers loads with the map, not with the page (NFR-130).
const GeoMap = lazy(() =>
	import("~/frontend/geoportal/GeoMap").then((m) => ({ default: m.GeoMap })),
);

async function adminLevels(countryAccountsId: string): Promise<number[]> {
	const res = await dr.execute(sql`
		SELECT DISTINCT admin_level FROM geo.division_geom_cache
		WHERE country_accounts_id = ${countryAccountsId} AND geom_z8 IS NOT NULL
		ORDER BY admin_level
	`);
	return (res.rows as { admin_level: number }[]).map((r) =>
		Number(r.admin_level),
	);
}

export const loader = authLoaderWithPerm("ViewData", async (args) => {
	const countryAccountsId = await getCountryAccountsIdFromSession(args.request);
	if (!countryAccountsId) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const lang = args.params.lang || "en";
	const url = new URL(args.request.url);
	const levels = await adminLevels(countryAccountsId);
	// Roll-ups start at level 1, never at a level-0 country outline.
	const defaultLevel = levels.find((l) => l >= 1) ?? levels[0] ?? 1;
	if (!url.searchParams.get("level")) {
		url.searchParams.set("level", String(defaultLevel));
	}
	const dim = url.searchParams.get("dim") ?? "disaster_impact";
	if (!url.searchParams.get("measure") && dim === "disaster_impact") {
		url.searchParams.set("measure", "records");
	}
	const canReview = await hasPermission(args.request, "ValidateData");
	const basemap = basemapConfig(url.origin);
	const ctx = {
		countryAccountsId,
		lang,
		url,
		request: args.request,
		viaApiKey: false,
	};

	try {
		const req = await resolveGeoRequest(ctx, {
			requireMeasure: true,
			requireLevel: true,
			eventDimensions: true,
		});
		const [choropleth, boundaries, tree] = await Promise.all([
			getChoropleth(countryAccountsId, req),
			getBoundaries(countryAccountsId, {
				level: req.level as number,
				z: 8,
				lang,
			}),
			getHazardTree(countryAccountsId, { ...req, notApplied: [] }, lang).catch(
				() => null,
			),
		]);
		return {
			query: req.query,
			level: req.level as number,
			levels,
			canReview,
			choropleth,
			boundaries: boundaries as {
				features: { properties: { divisionId: string; name: string } }[];
			},
			hazardTree: tree as HazardTree | null,
			basemap,
			refusal: null,
		};
	} catch (err) {
		if (err instanceof GeoRefusalWithMeta) {
			return {
				query: err.meta.query,
				level: Number(url.searchParams.get("level")),
				levels,
				canReview,
				choropleth: null,
				boundaries: null,
				hazardTree: null,
				basemap,
				refusal: refusalBody(err.refusal, err.meta),
			};
		}
		throw err;
	}
});

function periodText(q: DeltaQuery, t: GeoT): string {
	const from = q.where.time?.from;
	const to = q.where.time?.to;
	if (from && to)
		return t(
			{ code: "geoportal.period.range", msg: "{from} to {to}" },
			{ from, to },
		);
	if (from)
		return t({ code: "geoportal.period.from", msg: "from {from}" }, { from });
	if (to) return t({ code: "geoportal.period.to", msg: "up to {to}" }, { to });
	return t({ code: "geoportal.period.all", msg: "all dates" });
}

export const meta: MetaFunction<typeof loader> = ({
	params,
	loaderData: data,
}) => {
	const ctx = new ViewContext({ lang: params.lang || "en" });
	const t: GeoT = (l, r) => ctx.t(l, r);
	const page = t({ code: "geoportal.title", msg: "Geoportal" });
	if (!data || !("query" in data) || !data.query) {
		return [{ title: htmlTitle(ctx, page) }];
	}
	const q = data.query as DeltaQuery;
	const parts = [
		t(geoMeasureInfo(q.measure ?? "records").label),
		t(
			{ code: "geoportal.dossier.level", msg: "Admin level {n}" },
			{ n: data.level },
		),
		periodText(q, t),
		page,
	];
	return [{ title: htmlTitle(ctx, parts.join(" · ")) }];
};

/** Plain wording for the unplaced reasons the read model records. */
const UNPLACED_REASONS: Record<string, { code: string; msg: string }> = {
	no_division_row: {
		code: "geoportal.unplaced.no_division_row",
		msg: "no area recorded",
	},
	no_division_geometry: {
		code: "geoportal.unplaced.no_division_geometry",
		msg: "area has no boundary",
	},
	geometry_spans_divisions: {
		code: "geoportal.unplaced.spans",
		msg: "location spans several areas",
	},
	geometry_outside_divisions: {
		code: "geoportal.unplaced.outside",
		msg: "location outside every area",
	},
	members_unplaced: {
		code: "geoportal.unplaced.members",
		msg: "its disaster impacts have no area",
	},
};

export default function GeoportalPage() {
	const data = useLoaderData<typeof loader>();
	const ctx = new ViewContext();
	const t: GeoT = (l, r) => ctx.t(l, r);
	const navigate = useNavigate();
	const params = useParams();
	const lang = params.lang || "en";
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [userCleared, setUserCleared] = useState(false);
	const [focusId, setFocusId] = useState<string | null>(null);
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [dossier, setDossier] = useState<DossierData | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	// Basemap off by default (TR-166); the switch is the reader's choice.
	const [basemapOn, setBasemapOn] = useState(false);
	const [basemapStatus, setBasemapStatus] = useState<"ok" | "unavailable">(
		"ok",
	);
	const [homeSignal, setHomeSignal] = useState(0);

	const query = data.query as DeltaQuery;
	const choropleth = data.choropleth;
	const measure = query.measure ?? "records";
	const info = geoMeasureInfo(measure);
	const isEventDim = query.dimension !== "disaster_impact";
	const reportedNoun = isEventDim
		? t({ code: "geoportal.unit.events", msg: "events" })
		: t({ code: "geoportal.unit.disaster_impacts", msg: "disaster impacts" });

	const mapState = useMemo(() => {
		if (!choropleth) return null;
		return resolveMapState(choropleth.cells.map(toMapCell), {
			family: measureFamily(measure),
			scope: {
				tenant: null,
				fromDate: query.where.time?.from ?? null,
				toDate: query.where.time?.to ?? null,
				hazard: null,
				audience:
					query.scope.basis === "provisional"
						? "reviewer-provisional"
						: "signed-in",
				provisional: choropleth.meta.provisional,
			},
			notApplied: choropleth.meta.notApplied,
		});
	}, [choropleth, measure, query]);

	const rows: GeoTableRow[] = useMemo(() => {
		if (!data.boundaries || !mapState) return [];
		const byId = new Map(mapState.areas.map((a) => [a.areaId, a]));
		return data.boundaries.features.map((f) => ({
			id: f.properties.divisionId,
			name: f.properties.name,
			area: byId.get(f.properties.divisionId),
		}));
	}, [data.boundaries, mapState]);
	const nameOf = useMemo(
		() => new Map(rows.map((r) => [r.id, r.name])),
		[rows],
	);
	const noRecordsAreas = rows.filter((r) => !r.area).length;

	// The dossier is the default view (TR-182): with no area chosen yet, the
	// page opens the area with the highest value and says so.
	const topId = useMemo(() => {
		const first = rankRows(rows, {
			column: "value",
			direction: "descending",
		})[0];
		return first && first.rank !== null ? first.row.id : null;
	}, [rows]);
	const shownId = selectedId ?? (userCleared ? null : topId);
	const autoChosen = selectedId === null && shownId !== null;

	useEffect(() => {
		setSelectedId(null);
		setUserCleared(false);
	}, [data.query, data.level]);

	const search = useMemo(() => {
		const p = serializeDeltaQuery(query);
		p.set("level", String(data.level));
		return p;
	}, [query, data.level]);

	useEffect(() => {
		setDossier(null);
		if (!shownId) return;
		let live = true;
		fetch(`/${lang}/api/geo/place/${shownId}/dossier?${search}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => live && setDossier(d))
			.catch(() => live && setDossier(null));
		return () => {
			live = false;
		};
	}, [shownId, search, lang]);

	const onFilters = (next: { query: DeltaQuery; level: number }) => {
		const p = serializeDeltaQuery(next.query);
		p.set("level", String(next.level));
		navigate(`?${p.toString()}`);
	};
	const selectFromMap = (id: string | null) => {
		setSelectedId(id);
		setUserCleared(id === null);
	};
	const selectFromList = (id: string | null) => {
		setSelectedId(id);
		setUserCleared(id === null);
		setFocusId(id);
	};
	const copyLink = async () => {
		const href = window.location.href;
		try {
			await navigator.clipboard.writeText(href);
			setCopied(t({ code: "geoportal.copy.done", msg: "Link copied" }));
		} catch {
			setCopied(href);
		}
	};

	const hazardTypeNames = useMemo(
		() =>
			Object.fromEntries(
				(data.hazardTree?.types ?? []).map((h) => [h.id, h.name]),
			),
		[data.hazardTree],
	);

	const title = t({ code: "geoportal.title", msg: "Geoportal" });
	const tableId = "geoportal-table";
	const measureTitle = `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${t(info.label)}`;
	const activeFilters =
		(query.where.time ? 1 : 0) +
		(query.where.hazard ? 1 : 0) +
		(query.scope.basis === "provisional" ? 1 : 0);
	const readoutId = hoverId ?? shownId;
	const readoutArea = readoutId
		? mapState?.areas.find((a) => a.areaId === readoutId)
		: undefined;
	const refusal = data.refusal
		? refusalText(data.refusal.error.code, data.refusal.error, t)
		: null;
	const emptyPublished =
		choropleth &&
		choropleth.cells.length === 0 &&
		choropleth.unattributed.records === 0;

	const bar = (
		<GeoFilterBar
			query={query}
			level={data.level}
			levels={data.levels}
			canReview={data.canReview}
			onChange={onFilters}
			hazardTree={data.hazardTree}
			t={t}
		/>
	);

	return (
		<MainContainer title={title} showHeader={false}>
			<div className="geo-page py-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h1 className="text-xl font-semibold">{title}</h1>
					<div className="flex items-center gap-2">
						<span role="status" className="text-xs text-brand-text-muted">
							{copied}
						</span>
						<Button
							onPress={copyLink}
							className="border border-brand-border-control rounded px-3 py-1 text-sm bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
						>
							{t({ code: "geoportal.copy", msg: "Copy link" })}
						</Button>
					</div>
				</div>

				<div className="hidden md:block">{bar}</div>
				<div className="md:hidden py-2">
					<DialogTrigger>
						<Button className="border border-brand-border-control rounded px-3 py-1 text-sm bg-brand-surface">
							{t(
								{ code: "geoportal.filters", msg: "Filters ({n})" },
								{ n: activeFilters },
							)}
						</Button>
						<ModalOverlay
							isDismissable
							className="fixed inset-0 z-50 bg-brand-text/30"
						>
							<Modal className="fixed inset-0 bg-brand-surface overflow-auto p-4">
								<Dialog className="outline-none">
									{({ close }) => (
										<>
											<div className="flex justify-between items-center">
												<Heading slot="title" className="text-lg font-semibold">
													{t({
														code: "geoportal.filters.title",
														msg: "Filters",
													})}
												</Heading>
												<Button
													onPress={close}
													className="border border-brand-border-control rounded px-3 py-1 text-sm bg-brand-surface"
												>
													{t({ code: "geoportal.filters.done", msg: "Done" })}
												</Button>
											</div>
											{bar}
										</>
									)}
								</Dialog>
							</Modal>
						</ModalOverlay>
					</DialogTrigger>
				</div>

				{refusal && (
					<div
						role="alert"
						className="border-l-4 border-brand-warning-border bg-brand-warning-background p-3 my-2"
					>
						<p className="font-semibold">{refusal.title}</p>
						<p className="text-sm">{refusal.next}</p>
					</div>
				)}

				{choropleth && mapState && (
					<>
						<p className="text-sm text-brand-text-muted my-1">
							{mapState.scope.text}
						</p>
						{mapState.notApplied.map((n) => (
							<p
								key={n.filter}
								className="text-sm border-l-4 border-data-map-not-applied-note-border bg-data-map-not-applied-note-background px-2 py-1 my-1"
							>
								{n.text}
							</p>
						))}
						{choropleth.meta.provisional && (
							<p className="text-sm border-l-4 border-data-notice-provisional-border bg-data-notice-provisional-background px-2 py-1 my-1">
								{t({
									code: "geoportal.provisional",
									msg: "Provisional: these figures include data that is not yet published.",
								})}
							</p>
						)}
						{emptyPublished && (
							<div className="text-sm border-l-4 border-brand-border-control bg-brand-surface-subtle px-2 py-1 my-1 flex flex-wrap items-center gap-2">
								<span>
									{query.scope.basis === "provisional"
										? t({
												code: "geoportal.empty.scope",
												msg: "Nothing in scope for this dimension and these filters.",
											})
										: t({
												code: "geoportal.empty",
												msg: "Nothing is published for this view yet. Migrated data stays in draft until it is published.",
											})}
								</span>
								{data.canReview && query.scope.basis !== "provisional" && (
									<Button
										onPress={() =>
											onFilters({
												query: {
													...query,
													scope: { ...query.scope, basis: "provisional" },
												},
												level: data.level,
											})
										}
										className="border border-brand-border-control rounded px-2 py-0.5 bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t({
											code: "geoportal.empty.show_provisional",
											msg: "Show data not yet published",
										})}
									</Button>
								)}
							</div>
						)}

						<div className="grid gap-3 my-2 lg:grid-cols-[minmax(0,1fr)_380px]">
							<div className="relative min-w-0">
								<ClientOnly
									fallback={
										<div className="h-[60vh] lg:h-[calc(100vh-22rem)] min-h-[420px] bg-data-map-canvas-background" />
									}
								>
									{() => (
										<div className="h-[60vh] lg:h-[calc(100vh-22rem)] min-h-[420px]">
											<Suspense
												fallback={
													<div className="h-full bg-data-map-canvas-background" />
												}
											>
												<GeoMap
													boundaries={data.boundaries ?? { features: [] }}
													areas={mapState.areas}
													selectedId={shownId}
													onSelect={selectFromMap}
													onHover={setHoverId}
													focusId={focusId}
													basemap={data.basemap}
													basemapOn={basemapOn}
													onBasemapStatus={setBasemapStatus}
													homeSignal={homeSignal}
													height="100%"
													label={`${measureTitle}: ${t({ code: "geoportal.map", msg: "map" })}`}
													describedBy={tableId}
												/>
											</Suspense>
										</div>
									)}
								</ClientOnly>
								<div className="absolute right-2 bottom-8 z-10 flex flex-col items-end gap-1">
									<Button
										onPress={() => setHomeSignal((n) => n + 1)}
										className="border border-brand-border-control rounded px-2 py-1 text-xs bg-brand-surface shadow-sm data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t({ code: "geoportal.map.home", msg: "Full extent" })}
									</Button>
									{data.basemap && (
										<Switch
											isSelected={basemapOn}
											onChange={setBasemapOn}
											className="flex items-center gap-2 text-xs bg-brand-surface border border-brand-border-control rounded px-2 py-1 shadow-sm data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
										>
											{({ isSelected }) => (
												<>
													<span
														aria-hidden="true"
														className={`inline-block w-7 h-4 rounded-full relative ${isSelected ? "bg-brand-interactive" : "bg-brand-border-control"}`}
													>
														<span
															className={`absolute top-0.5 w-3 h-3 rounded-full bg-brand-surface transition-all ${isSelected ? "left-3.5" : "left-0.5"}`}
														/>
													</span>
													{t({ code: "geoportal.map.basemap", msg: "Basemap" })}
												</>
											)}
										</Switch>
									)}
									{data.basemap &&
										basemapOn &&
										basemapStatus === "unavailable" && (
											<p
												role="status"
												className="text-xs bg-brand-warning-background border border-brand-warning-border rounded px-2 py-1"
											>
												{t({
													code: "geoportal.map.basemap_unavailable",
													msg: "Basemap unavailable; boundaries and figures are still shown.",
												})}
											</p>
										)}
								</div>
								<div className="hidden md:block absolute left-2 bottom-9 z-10">
									<GeoLegend
										legend={mapState.legend}
										title={measureTitle}
										subtitle={`${t({ code: "geoportal.dossier.level", msg: "Admin level {n}" }, { n: data.level })} · ${periodText(query, t)}`}
										noRecordsAreas={noRecordsAreas}
										provenance={{
											boundaryVersion: choropleth.meta.boundaryVersion,
											refreshedAt: choropleth.meta.readModelRefreshedAt,
										}}
										t={t}
									/>
								</div>
								{readoutId && (
									<div className="hidden md:block absolute right-2 top-2 z-10 pointer-events-none">
										<GeoReadout
											name={nameOf.get(readoutId) ?? ""}
											area={readoutArea}
											unit={t(info.unit)}
											reportedNoun={reportedNoun}
											selected={readoutId === shownId && hoverId === null}
											t={t}
										/>
									</div>
								)}
							</div>

							<aside className="min-w-0 lg:h-[calc(100vh-22rem)] lg:min-h-[420px] lg:overflow-auto border border-brand-border rounded p-2">
								<Tabs defaultSelectedKey="place">
									<TabList
										aria-label={t({ code: "geoportal.panel", msg: "Panel" })}
										className="flex gap-1 border-b mb-2"
									>
										<Tab
											id="place"
											className="px-3 py-1 cursor-pointer data-[selected]:border-b-2 data-[selected]:border-brand-interactive data-[selected]:font-semibold data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
										>
											{t({ code: "geoportal.tab.place", msg: "Place" })}
										</Tab>
										<Tab
											id="areas"
											className="px-3 py-1 cursor-pointer data-[selected]:border-b-2 data-[selected]:border-brand-interactive data-[selected]:font-semibold data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
										>
											{t({ code: "geoportal.tab.areas", msg: "Areas" })}
										</Tab>
										<Tab
											id="legend"
											className="md:hidden px-3 py-1 cursor-pointer data-[selected]:border-b-2 data-[selected]:border-brand-interactive data-[selected]:font-semibold"
										>
											{t({ code: "geoportal.tab.legend", msg: "Legend" })}
										</Tab>
									</TabList>
									<TabPanel
										id="place"
										shouldForceMount
										className="data-[inert]:hidden"
									>
										{dossier ? (
											<GeoDossier
												data={dossier}
												hazardTypeNames={hazardTypeNames}
												autoNote={
													autoChosen
														? t({
																code: "geoportal.dossier.auto",
																msg: "Showing the area with the highest value. Select another area on the map or in the list.",
															})
														: null
												}
												t={t}
											/>
										) : (
											<p className="text-sm text-brand-text-muted">
												{shownId
													? t({
															code: "geoportal.dossier.loading",
															msg: "Loading place details",
														})
													: t({
															code: "geoportal.dossier.prompt",
															msg: "Select an area on the map or in the Areas list.",
														})}
											</p>
										)}
									</TabPanel>
									<TabPanel
										id="areas"
										shouldForceMount
										className="data-[inert]:hidden"
									>
										<GeoTable
											id={tableId}
											label={`${measureTitle}: ${t({ code: "geoportal.table", msg: "table" })}`}
											rows={rows}
											selectedId={shownId}
											onSelect={selectFromList}
											unit={t(info.unit)}
											t={t}
										/>
										<p className="text-xs text-brand-text-muted mt-2">
											{t({
												code: "geoportal.table.no_total",
												msg: "Area values are not added up: one disaster impact or event can count in more than one area.",
											})}
										</p>
									</TabPanel>
									<TabPanel id="legend" className="md:hidden">
										<GeoLegend
											legend={mapState.legend}
											title={measureTitle}
											subtitle={periodText(query, t)}
											noRecordsAreas={noRecordsAreas}
											provenance={{
												boundaryVersion: choropleth.meta.boundaryVersion,
												refreshedAt: choropleth.meta.readModelRefreshedAt,
											}}
											t={t}
										/>
									</TabPanel>
								</Tabs>
							</aside>
						</div>

						<p className="text-xs text-brand-text-muted">
							{choropleth.caption}
						</p>
						{choropleth.unattributed.records > 0 && (
							<section className="text-sm mt-2">
								<h2 className="font-semibold">
									{t({
										code: "geoportal.unattributed",
										msg: "Not placed on the map",
									})}
								</h2>
								<p>
									{t(
										{
											code: "geoportal.unattributed.count",
											msg: "{n} {noun} are listed here and never shared out to areas:",
										},
										{
											n: choropleth.unattributed.records.toLocaleString(),
											noun: reportedNoun,
										},
									)}
								</p>
								<ul className="list-disc ml-5">
									{Object.entries(choropleth.unattributed.reasons).map(
										([reason, n]) => (
											<li key={reason}>
												{UNPLACED_REASONS[reason]
													? t(UNPLACED_REASONS[reason])
													: reason.replaceAll("_", " ")}
												: {Number(n).toLocaleString()}
											</li>
										),
									)}
								</ul>
							</section>
						)}
					</>
				)}
			</div>
		</MainContainer>
	);
}
