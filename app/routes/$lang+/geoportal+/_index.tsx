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
	Select,
	SelectValue,
	ToggleButton,
	ToggleButtonGroup,
	Popover,
	ListBox,
	ListBoxItem,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
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
import {
	densityPer1000Km2,
	measureFamily,
	toMapCell,
} from "~/frontend/geoportal/geoCells";
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
import {
	defaultSymbolFor,
	resolveMapState,
	type MapSymbol,
} from "~/utils/mapState";
import { GEO_DIMENSION_LABELS, geoMeasureInfo } from "~/utils/geoMeasures";
import { htmlTitle } from "~/utils/htmlmeta";
import { PrintButton } from "~/frontend/print/PrintButton";
import { basemapLayers } from "~/utils/basemap.server";
import { selectableBasemaps, type BasemapLayerId } from "~/utils/basemap";

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
	// RV-5: every geoportal measure is a count, so spikes by default; the
	// reader may switch to a density choropleth. View state, not delta.query.
	const symbolParam = url.searchParams.get("symbol");
	const symbol: MapSymbol =
		symbolParam === "choropleth" || symbolParam === "spike"
			? symbolParam
			: defaultSymbolFor("count");
	// Signed-in page: every configured layer (Alex: the reader chooses).
	const basemaps = selectableBasemaps(
		basemapLayers(url.origin, lang),
		"signed-in",
	);
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
				features: {
					properties: {
						divisionId: string;
						name: string;
						labelPoint?: [number, number];
						areaKm2?: number | string;
					};
				}[];
			},
			hazardTree: tree as HazardTree | null,
			basemaps,
			symbol,
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
				basemaps,
				symbol,
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
	const [basemapId, setBasemapId] = useState<BasemapLayerId | null>(null);
	const [basemapStatus, setBasemapStatus] = useState<"ok" | "unavailable">(
		"ok",
	);
	const [homeSignal, setHomeSignal] = useState(0);
	const [printUrl, setPrintUrl] = useState("");
	useEffect(() => setPrintUrl(window.location.href), [data.query, data.level]);

	const query = data.query as DeltaQuery;
	const choropleth = data.choropleth;
	const measure = query.measure ?? "records";
	const info = geoMeasureInfo(measure);
	const isEventDim = query.dimension !== "disaster_impact";
	const reportedNoun = isEventDim
		? t({ code: "geoportal.unit.events", msg: "events" })
		: t({ code: "geoportal.unit.disaster_impacts", msg: "disaster impacts" });

	const symbol = data.symbol as MapSymbol;
	const areaKm2 = useMemo(
		() =>
			new Map(
				(data.boundaries?.features ?? []).map((f) => [
					f.properties.divisionId,
					Number(f.properties.areaKm2) || 0,
				]),
			),
		[data.boundaries],
	);
	const mapState = useMemo(() => {
		if (!choropleth) return null;
		// RV-5: the choropleth shows density per 1,000 km2 (true area of the
		// division); spikes show the count itself. Null stays null.
		const cells = choropleth.cells.map(toMapCell).map((c) => {
			if (symbol !== "choropleth" || typeof c.value !== "number") return c;
			return {
				...c,
				value: densityPer1000Km2(c.value, areaKm2.get(c.areaId) ?? 0),
			};
		});
		return resolveMapState(cells, {
			symbol,
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
	}, [choropleth, measure, query, symbol, areaKm2]);

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
		p.set("symbol", symbol);
		navigate(`?${p.toString()}`);
	};
	const setSymbol = (next: MapSymbol) => {
		const p = serializeDeltaQuery(query);
		p.set("level", String(data.level));
		p.set("symbol", next);
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
	const densityNote = t({
		code: "geoportal.unit.per_1000km2",
		msg: "per 1,000 km²",
	});
	const measureTitle = `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${t(info.label)}${symbol === "choropleth" ? ` (${densityNote})` : ""}`;
	const unitLabel =
		symbol === "choropleth" ? `${t(info.unit)} ${densityNote}` : t(info.unit);
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
					<div className="flex items-center gap-2" data-print="hide">
						<span role="status" className="text-xs text-brand-text-muted">
							{copied}
						</span>
						<Button
							onPress={copyLink}
							className="border border-brand-border-control rounded px-3 py-1 text-sm bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
						>
							{t({ code: "geoportal.copy", msg: "Copy link" })}
						</Button>
						<PrintButton ctx={ctx} />
					</div>
				</div>

				<p className="hidden print:block text-sm my-1">
					{measureTitle} ·{" "}
					{t(
						{ code: "geoportal.dossier.level", msg: "Admin level {n}" },
						{ n: data.level },
					)}{" "}
					· {periodText(query, t)}
					<br />
					<span className="text-xs text-brand-text-muted">
						{t(
							{ code: "geoportal.print.source", msg: "Printed from {url}" },
							{ url: printUrl },
						)}
					</span>
				</p>
				<div className="hidden md:block" data-print="hide">
					{bar}
				</div>
				<div className="md:hidden py-2" data-print="hide">
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

						<div className="grid gap-3 my-2 lg:grid-cols-[minmax(0,1fr)_380px] print:!block">
							<div className="relative min-w-0">
								<ClientOnly
									fallback={
										<div className="h-[60vh] lg:h-[calc(100vh-22rem)] min-h-[420px] bg-data-map-canvas-background" />
									}
								>
									{() => (
										<div className="h-[60vh] lg:h-[calc(100vh-22rem)] min-h-[420px] print:!h-[150mm]">
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
													basemaps={data.basemaps}
													basemapId={basemapId}
													onBasemapStatus={setBasemapStatus}
													homeSignal={homeSignal}
													symbol={symbol}
													spikeColor={mapState.legend.spikes?.color}
													height="100%"
													label={`${measureTitle}: ${t({ code: "geoportal.map", msg: "map" })}`}
													describedBy={tableId}
												/>
											</Suspense>
										</div>
									)}
								</ClientOnly>
								<div
									className="absolute right-2 bottom-8 z-10 flex flex-col items-end gap-1"
									data-print="hide"
								>
									<ToggleButtonGroup
										aria-label={t({
											code: "geoportal.map.symbol",
											msg: "Map style",
										})}
										selectionMode="single"
										disallowEmptySelection
										selectedKeys={[symbol]}
										onSelectionChange={(keys) => {
											const [k] = Array.from(keys);
											if (k) setSymbol(k as MapSymbol);
										}}
										className="flex rounded border border-brand-border-control overflow-hidden text-xs shadow-sm"
									>
										<ToggleButton
											id="spike"
											className="px-2 py-1 bg-brand-surface data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
										>
											{t({ code: "geoportal.map.spikes", msg: "Spikes" })}
										</ToggleButton>
										<ToggleButton
											id="choropleth"
											className="px-2 py-1 bg-brand-surface data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
										>
											{t({ code: "geoportal.map.density", msg: "Density" })}
										</ToggleButton>
									</ToggleButtonGroup>
									<Button
										onPress={() => setHomeSignal((n) => n + 1)}
										className="border border-brand-border-control rounded px-2 py-1 text-xs bg-brand-surface shadow-sm data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t({ code: "geoportal.map.home", msg: "Full extent" })}
									</Button>
									{data.basemaps.length > 0 && (
										<Select
											aria-label={t({
												code: "geoportal.map.basemap",
												msg: "Basemap",
											})}
											selectedKey={basemapId ?? "none"}
											onSelectionChange={(k) => {
												setBasemapStatus("ok");
												setBasemapId(
													k === "none" ? null : (k as BasemapLayerId),
												);
											}}
											className="flex flex-col items-end gap-1"
										>
											<Button className="flex items-center gap-2 text-xs bg-brand-surface border border-brand-border-control rounded px-2 py-1 shadow-sm data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring">
												{t({ code: "geoportal.map.basemap", msg: "Basemap" })}:{" "}
												<SelectValue />
											</Button>
											<Popover className="bg-brand-surface border border-brand-border-control rounded shadow text-xs">
												<ListBox className="max-h-72 overflow-auto">
													<ListBoxItem
														id="none"
														textValue={t({
															code: "geoportal.basemap.none",
															msg: "None",
														})}
														className="px-2 py-1 cursor-pointer data-[focused]:bg-brand-surface-subtle data-[selected]:font-semibold"
													>
														{t({ code: "geoportal.basemap.none", msg: "None" })}
													</ListBoxItem>
													{data.basemaps.map((b) => (
														<ListBoxItem
															key={b.id}
															id={b.id}
															textValue={t(b.label)}
															className="px-2 py-1 cursor-pointer data-[focused]:bg-brand-surface-subtle data-[selected]:font-semibold"
														>
															{t(b.label)}
															{b.note && (
																<span className="block text-brand-text-muted">
																	{t(b.note)}
																</span>
															)}
														</ListBoxItem>
													))}
												</ListBox>
											</Popover>
										</Select>
									)}
									{(() => {
										const picked = data.basemaps.find(
											(b) => b.id === basemapId,
										);
										return picked?.note ? (
											<p className="text-xs bg-brand-surface border border-brand-border-control rounded px-2 py-1">
												{t(picked.note)}
											</p>
										) : null;
									})()}
									{basemapId !== null && basemapStatus === "unavailable" && (
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
								{(() => {
									const logo = data.basemaps.find(
										(b) => b.id === basemapId,
									)?.logo;
									return logo ? (
										<img
											src={logo}
											alt={t({
												code: "geoportal.basemap.logo",
												msg: "Map provider logo",
											})}
											className="absolute left-10 top-2 z-10 h-5"
											data-print="hide"
										/>
									) : null;
								})()}
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
									<div
										className="hidden md:block absolute right-2 top-2 z-10 pointer-events-none"
										data-print="hide"
									>
										<GeoReadout
											name={nameOf.get(readoutId) ?? ""}
											area={readoutArea}
											unit={unitLabel}
											reportedNoun={reportedNoun}
											selected={readoutId === shownId && hoverId === null}
											t={t}
										/>
									</div>
								)}
							</div>

							<aside className="min-w-0 lg:h-[calc(100vh-22rem)] lg:min-h-[420px] lg:overflow-auto print:!h-auto print:!overflow-visible border border-brand-border rounded p-2">
								<Tabs defaultSelectedKey="place">
									<TabList
										data-print="hide"
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
									<TabPanels>
										<TabPanel
											id="place"
											shouldForceMount
											className="data-[inert]:hidden print:!block"
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
											className="data-[inert]:hidden print:!block"
										>
											<GeoTable
												id={tableId}
												label={`${measureTitle}: ${t({ code: "geoportal.table", msg: "table" })}`}
												rows={rows}
												selectedId={shownId}
												onSelect={selectFromList}
												unit={unitLabel}
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
									</TabPanels>
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
