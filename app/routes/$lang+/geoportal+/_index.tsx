// Geoportal map page (increment I-2, design review 2026-10-16). The map is
// the page: a question bar on top, a full-height map with its legend card
// and readout, and a side panel with the place dossier and the ranked area
// list (TR-182, TR-176). The loader resolves the request exactly as the geo
// API does (resolveGeoRequest), so the page and the API never disagree.
// Signed-in only until the public routes (TR-181, TR-236) land in R1.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { preload } from "react-dom";
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
	Popover,
	ListBox,
	ListBoxItem,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	ToggleButton,
	ToggleButtonGroup,
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
	flattenHazardTree,
	GeoFilterBar,
	type NestedHazardTree,
} from "~/frontend/geoportal/GeoFilterBar";
import { GeoReadout } from "~/frontend/geoportal/GeoReadout";
import { GeoSendai } from "~/frontend/geoportal/GeoSendai";
import { GeoPlacePicker } from "~/frontend/geoportal/GeoPlacePicker";
import { withPlace } from "~/frontend/geoportal/filterBarState";
import { GeoDossier, type DossierData } from "~/frontend/geoportal/GeoDossier";
import {
	barCells,
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
	listPlaceOptions,
	refusalBody,
} from "~/backend.server/models/geo/queries";
import { authLoaderWithPerm, hasPermission } from "~/utils/auth";
import {
	getCountryAccountsIdFromSession,
	getCountrySettingsFromSession,
} from "~/utils/session";
import { serializeDeltaQuery, type DeltaQuery } from "~/utils/deltaQuery";
import {
	resolveLayeredMapState,
	resolveMapState,
	type MapSymbol,
} from "~/utils/mapState";
import { GEO_DIMENSION_LABELS, geoMeasureInfo } from "~/utils/geoMeasures";
import { htmlTitle } from "~/utils/htmlmeta";
import { PrintButton } from "~/frontend/print/PrintButton";
import { basemapLayers } from "~/utils/basemap.server";
import { listRegions } from "~/backend.server/models/geo/regions";
import {
	getTenantOutline,
	mapDataVersion,
	worldBoundariesUrl,
} from "~/backend.server/models/geo/tenantExtent";
import { divisionAreasKm2 } from "~/backend.server/models/analytics/divisionAreas";
import { selectableBasemaps, type BasemapLayerId } from "~/utils/basemap";
import { PageBrand } from "~/frontend/PageBrand";
import { showByLabel } from "~/frontend/geoportal/GeoFilterBar";

// OpenLayers loads with the map, not with the page (NFR-130).
const GeoMap = lazy(() =>
	import("~/frontend/geoportal/GeoMap").then((m) => ({ default: m.GeoMap })),
);

/**
 * Map geometry is fetched by the browser, not inlined in the page (NFR-113
 * first paint): the page carries only the URLs, each with a version so the
 * browser can keep the answer for a year. The fetch starts from a preload
 * hint in the page head, in parallel with the map's JavaScript.
 */
function useGeometry<T>(src: string | null): { data: T | null; failed: boolean } {
	if (src) preload(src, { as: "fetch", crossOrigin: "anonymous" });
	const [state, setState] = useState<{ src: string | null; data: T | null; failed: boolean }>(
		{ src: null, data: null, failed: false },
	);
	useEffect(() => {
		if (!src) return;
		const ctrl = new AbortController();
		fetch(src, { signal: ctrl.signal })
			.then((r) => {
				if (!r.ok) throw new Error(String(r.status));
				return r.json() as Promise<T>;
			})
			.then((data) => setState({ src, data, failed: false }))
			.catch((err: unknown) => {
				if ((err as { name?: string })?.name !== "AbortError") {
					setState({ src, data: null, failed: true });
				}
			});
		return () => ctrl.abort();
	}, [src]);
	return state.src === src ? state : { data: null, failed: false };
}

type BoundaryCollection = {
	type?: "FeatureCollection";
	features: {
		properties: {
			divisionId: string;
			name: string;
			labelPoint?: [number, number];
			areaKm2?: number | string;
		};
	}[];
};
type MapContext = {
	outline: {
		geojson: { type: string; coordinates: unknown } | null;
		labelPoint: [number, number] | null;
		name: string | null;
		iso3?: string | null;
	} | null;
	neighbours: {
		iso3: string;
		name: string;
		geojson: { type: string; coordinates: unknown };
		labelPoint: [number, number];
	}[];
};
type WorldLayer = {
	lines: { type: string; coordinates: unknown } | null;
	labels: { iso3: string; name: string; labelPoint: [number, number] }[];
};

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
	// The page heading names the country (Alex, 2026-10-20): the instance
	// settings, else the country account's own name, as on Analysis.
	const settings = await getCountrySettingsFromSession(args.request);
	const countryName =
		(settings?.countryName as string | undefined) ||
		(await getTenantOutline(countryAccountsId)).name ||
		null;
	// Roll-ups start at level 1, never at a level-0 country outline.
	const defaultLevel = levels.find((l) => l >= 1) ?? levels[0] ?? 1;
	if (!url.searchParams.get("level")) {
		url.searchParams.set("level", String(defaultLevel));
	}
	const dim = url.searchParams.get("dim") ?? "disaster_impact";
	// Alex 2026-10-17: the Disaster impact map opens on the number of deaths.
	if (!url.searchParams.get("measure") && dim === "disaster_impact") {
		url.searchParams.set("measure", "deaths");
	}
	const canReview = await hasPermission(args.request, "ValidateData");
	// Map style (Alex 2026-10-17). View state, not delta.query.
	// - Disaster impact default "bars": areas shaded by the selected count
	//   (deaths by default) with dwellings destroyed and damaged as rounded
	//   bars on top (resolveLayeredMapState).
	// - Event dimensions default "bubble": counts as bubbles.
	// - "choropleth": density per 1,000 km2 of land area.
	const symbolParam = url.searchParams.get("symbol");
	let symbol: MapSymbol =
		symbolParam === "bubble" ||
		symbolParam === "bars" ||
		symbolParam === "choropleth"
			? symbolParam
			: dim === "disaster_impact"
				? "bars"
				: "bubble";
	if (symbol === "bars" && dim !== "disaster_impact") symbol = "bubble";
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
			region: true,
		});
		const [choropleth, boundaries, tree, regions] = await Promise.all([
			getChoropleth(countryAccountsId, req),
			// The same request as the boundaries URL below, so both share one
			// cache entry; the page keeps only the names, the browser fetches
			// the shapes.
			getBoundaries(countryAccountsId, {
				level: req.level as number,
				parentId: null,
				bbox: null,
				z: 8,
				lang,
			}),
			getHazardTree(countryAccountsId, { ...req, notApplied: [] }, lang).catch(
				() => null,
			),
			// RG-1: the tenant's regions for the Area control.
			listRegions(countryAccountsId, lang),
		]);
		const [placeOptions, version, worldSrc] = await Promise.all([
			listPlaceOptions(countryAccountsId, lang),
			mapDataVersion(countryAccountsId),
			worldBoundariesUrl(lang),
		]);
		const v = (ver: string | null) => (ver ? `&v=${ver}` : "");
		const api = `/${lang}/api/geo`;
		const geometrySrc = {
			boundaries: `${api}/boundaries?level=${req.level}&z=8${v(version)}`,
			context: `${api}/map-context?r=1${v(version)}`,
			world: worldSrc,
		};
		// Bars: the housing breakdown, each part read with the same filters.
		const housing =
			symbol === "bars"
				? await Promise.all(
						(["houses_destroyed", "houses_damaged"] as const).map((m) =>
							getChoropleth(countryAccountsId, {
								...req,
								query: { ...req.query, measure: m },
							}).then((c) => c.cells),
						),
					)
				: null;
		// True area of each division (full geometry), the same figure the
		// analytics maps use, so a density reads the same on both.
		const areaKm2 = Object.fromEntries(
			await divisionAreasKm2(
				(
					boundaries as { features: { properties: { divisionId: string } }[] }
				).features.map((f) => f.properties.divisionId),
				countryAccountsId,
			),
		);
		return {
			query: req.query,
			level: req.level as number,
			levels,
			canReview,
			choropleth,
			// Names only (the table, the readout); the shapes come from geometrySrc.
			areas: (boundaries as BoundaryCollection).features.map((f) => ({
				divisionId: f.properties.divisionId,
				name: f.properties.name,
			})),
			geometrySrc,
			// G6 is nested; the bar reads three flat lists (Frontend, 2026-10-17).
			hazardTree: flattenHazardTree(tree as NestedHazardTree | null),
			regions: regions.map((r) => ({
				regionId: r.regionId,
				name: r.name,
				kind: r.kind,
			})),
			basemaps,
			symbol,
			housing: housing ? { destroyed: housing[0], damaged: housing[1] } : null,
			areaKm2,
			placeOptions,
			countryName,
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
				areas: [] as { divisionId: string; name: string }[],
				geometrySrc: null,
				hazardTree: null,
				regions: [],
				basemaps,
				symbol,
				housing: null,
				areaKm2: {} as Record<string, number>,
				placeOptions: [] as {
					id: string;
					name: string;
					level: number;
					parentId: string | null;
				}[],
				countryName,
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
	coarser_than_level: {
		code: "geoportal.unplaced.coarser",
		msg: "recorded only at a coarser level than this map",
	},
	undated: {
		code: "geoportal.unplaced.undated",
		msg: "no start date, so outside any chosen period",
	},
};

// An empty collection while the area shapes download. It must say it is a
// FeatureCollection: OpenLayers reads a bare { features } as one feature
// with no geometry type and throws ("Unsupported GeoJSON type: undefined"),
// which broke client-side navigation to the geoportal (Alex, 2026-10-21).
const EMPTY_BOUNDARIES: BoundaryCollection = {
	type: "FeatureCollection",
	features: [],
};

export default function GeoportalPage() {
	const data = useLoaderData<typeof loader>();
	const boundaries = useGeometry<BoundaryCollection>(data.geometrySrc?.boundaries ?? null);
	const mapContext = useGeometry<MapContext>(data.geometrySrc?.context ?? null);
	const world = useGeometry<WorldLayer>(data.geometrySrc?.world ?? null);
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
	// Basemap ON by default on both maps (Alex, 2026-10-18, amends TR-166):
	// the first selectable layer; the reader can still choose None.
	const [basemapId, setBasemapId] = useState<BasemapLayerId | null>(
		data.basemaps[0]?.id ?? null,
	);
	const [basemapStatus, setBasemapStatus] = useState<"ok" | "unavailable">(
		"ok",
	);
	const [homeSignal, setHomeSignal] = useState(0);
	const [showLabels, setShowLabels] = useState(true);
	// lg breakpoint: the Place panel covers the map's right 380 px, so the map
	// fits the country into the space left of it.
	const [isWide, setIsWide] = useState(false);
	useEffect(() => {
		const mq = window.matchMedia("(min-width: 1024px)");
		const on = () => setIsWide(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);
	const [printUrl, setPrintUrl] = useState("");
	useEffect(() => setPrintUrl(window.location.href), [data.query, data.level]);

	const query = data.query as DeltaQuery;
	const choropleth = data.choropleth;
	const measure = query.measure ?? "records";
	const info = geoMeasureInfo(measure);
	const isEventDim = query.dimension !== "disaster_impact";
	// Records held only at a coarser level than the map's Analysis level.
	const coarsestLevel = Math.min(...(data.levels.length ? data.levels : [1]));
	const coarserCount =
		choropleth && data.level > coarsestLevel
			? Number(choropleth.unattributed.reasons.coarser_than_level ?? 0)
			: 0;
	const reportedNoun = isEventDim
		? t({ code: "geoportal.unit.events", msg: "events" })
		: t({ code: "geoportal.unit.disaster_impacts", msg: "disaster impacts" });

	const symbol = data.symbol as MapSymbol;
	const areaKm2 = useMemo(
		() => new Map(Object.entries(data.areaKm2 ?? {})),
		[data.areaKm2],
	);
	const mapState = useMemo(() => {
		if (!choropleth) return null;
		// Alex 2026-10-17: bubbles carry counts, rounded bars the housing
		// breakdown, shading a density per 1,000 km2 of true area (never a
		// raw count). Null stays null; parts are never added.
		const scope = {
			tenant: null,
			fromDate: query.where.time?.from ?? null,
			toDate: query.where.time?.to ?? null,
			hazard: null,
			audience:
				query.scope.basis === "provisional"
					? ("reviewer-provisional" as const)
					: ("signed-in" as const),
			provisional: choropleth.meta.provisional,
		};
		const housingFamily = measureFamily("houses_destroyed");
		// Layered (Alex's default): shading by the selected count, housing
		// bars on top, two colour families, never added. A housing measure
		// cannot shade under housing bars, so it shows the bars alone.
		if (
			symbol === "bars" &&
			data.housing &&
			measureFamily(measure) !== housingFamily
		) {
			const bars = barCells([
				{
					key: "houses_destroyed",
					label: t(geoMeasureInfo("houses_destroyed").label),
					cells: data.housing.destroyed,
				},
				{
					key: "houses_damaged",
					label: t(geoMeasureInfo("houses_damaged").label),
					cells: data.housing.damaged,
				},
			]).map((c) => ({ areaId: c.areaId, parts: c.parts ?? [] }));
			return resolveLayeredMapState(choropleth.cells.map(toMapCell), bars, {
				family: measureFamily(measure),
				barsFamily: housingFamily,
				scope,
				notApplied: choropleth.meta.notApplied,
			});
		}
		const cells =
			symbol === "bars" && data.housing
				? barCells([
						{
							key: "houses_destroyed",
							label: t(geoMeasureInfo("houses_destroyed").label),
							cells: data.housing.destroyed,
						},
						{
							key: "houses_damaged",
							label: t(geoMeasureInfo("houses_damaged").label),
							cells: data.housing.damaged,
						},
					])
				: choropleth.cells.map(toMapCell).map((c) => {
						if (symbol !== "choropleth" || typeof c.value !== "number")
							return c;
						return {
							...c,
							value: densityPer1000Km2(c.value, areaKm2.get(c.areaId) ?? 0),
						};
					});
		return resolveMapState(cells, {
			symbol,
			family: symbol === "bars" ? housingFamily : measureFamily(measure),
			scope,
			notApplied: choropleth.meta.notApplied,
		});
	}, [choropleth, measure, query, areaKm2, symbol, data.housing, t]);

	const rows: GeoTableRow[] = useMemo(() => {
		if (!mapState) return [];
		const byId = new Map(mapState.areas.map((a) => [a.areaId, a]));
		return data.areas.map((a) => ({
			id: a.divisionId,
			name: a.name,
			area: byId.get(a.divisionId),
		}));
	}, [data.areas, mapState]);
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
	// Alex, 2026-10-18: the Place panel opens on the whole country and follows
	// the area chosen on the map or in the pickers. (The earlier default, the
	// area with the highest value, is gone; topId stays for the list.)
	void topId;
	void userCleared;
	const shownId = selectedId;
	const autoChosen = false;
	const dossierKey = shownId ?? "country";

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
		let live = true;
		fetch(`/${lang}/api/geo/place/${dossierKey}/dossier?${search}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => live && setDossier(d))
			.catch(() => live && setDossier(null));
		return () => {
			live = false;
		};
	}, [dossierKey, search, lang]);

	const onFilters = (next: { query: DeltaQuery; level: number }) => {
		const p = serializeDeltaQuery(next.query);
		p.set("level", String(next.level));
		if (symbol !== "choropleth") p.set("symbol", symbol);
		navigate(`?${p.toString()}`);
	};
	const setSymbol = (next: MapSymbol) => {
		const p = serializeDeltaQuery(query);
		p.set("level", String(data.level));
		if (next !== "choropleth") p.set("symbol", next);
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
	const layered =
		symbol === "bars" &&
		Boolean(data.housing) &&
		measureFamily(measure) !== measureFamily("houses_destroyed");
	const housingTitle = t({
		code: "geoportal.map.housing",
		msg: "Houses destroyed and damaged",
	});
	const measureTitle = layered
		? `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${t(info.label)} · ${t({ code: "geoportal.map.bars_of", msg: "bars: {what}" }, { what: housingTitle })}`
		: symbol === "bars"
			? `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${housingTitle}`
			: symbol === "bubble"
				? `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${t(info.label)}`
				: `${t(GEO_DIMENSION_LABELS[query.dimension])} · ${t(info.label)} (${densityNote})`;
	const housingUnit = t(geoMeasureInfo("houses_destroyed").unit);
	const unitLabel =
		symbol === "bars" && !layered
			? housingUnit
			: symbol === "choropleth"
				? `${t(info.unit)} ${densityNote}`
				: t(info.unit);
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
			place={data.regions.length > 0 ? { regions: data.regions } : null}
			notApplied={data.choropleth?.meta.notApplied}
			t={t}
		/>
	);

	return (
		<MainContainer title={title} showHeader={false}>
			<div className="geo-page py-2 print:pt-0">
				<div className="flex flex-wrap items-center justify-between gap-2">
					{/* The section heading, shared with Data Entry and Analysis (Alex, 2026-10-19). */}
					<PageBrand ctx={ctx} section="geoportal" country={data.countryName} />
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

						{/* Placement disclosure (gap review step 2, OD-3 a): at a finer
						    Analysis level, records held only at a coarser level are not
						    on the map. Say how many, never share them out (TR-077). */}
						{coarserCount > 0 && (
							<div
								role="status"
								className="text-sm border-l-4 border-data-map-not-applied-note-border bg-data-map-not-applied-note-background px-2 py-1 my-1 flex flex-wrap items-center gap-2"
							>
								<span>
									{t(
										{
											code: "geoportal.coarser.note",
											msg: "{n} of {total} {noun} are recorded only at a coarser level and are not on this map. They are never shared out to smaller areas.",
										},
										{
											n: coarserCount.toLocaleString(),
											total: (
												(choropleth.unattributed.placedRecords ?? 0) +
												choropleth.unattributed.records
											).toLocaleString(),
											noun: reportedNoun,
										},
									)}
								</span>
								<Button
									onPress={() => onFilters({ query, level: coarsestLevel })}
									className="border border-brand-border-control rounded px-2 py-0.5 bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
								>
									{t(
										{
											code: "geoportal.coarser.show_level",
											msg: "Switch to {level}",
										},
										{ level: showByLabel(coarsestLevel, t) },
									)}
								</Button>
							</div>
						)}

						{/* The Place panel floats over the map's right side on wide
						    screens (Alex, 2026-10-18) and stacks below it on narrow ones. */}
						<div className="relative flex flex-col gap-3 my-2 print:!block">
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
													boundaries={boundaries.data ?? EMPTY_BOUNDARIES}
													areas={mapState.areas}
													selectedId={shownId}
													onSelect={selectFromMap}
													onHover={setHoverId}
													focusId={focusId}
													basemaps={data.basemaps}
													basemapId={basemapId}
													onBasemapStatus={setBasemapStatus}
													homeSignal={homeSignal}
													symbolColor={mapState.legend.symbols?.color ?? null}
													outline={mapContext.data?.outline ?? null}
													neighbours={mapContext.data?.neighbours ?? []}
													world={world.data}
													ownIso3={mapContext.data?.outline?.iso3 ?? null}
													padRight={isWide ? 396 : 0}
													disclaimer={t({
														code: "geoportal.map.un_disclaimer",
														msg: "The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.",
													})}
													showLabels={showLabels}
													height="100%"
													label={`${measureTitle}: ${t({ code: "geoportal.map", msg: "map" })}`}
													describedBy={tableId}
												/>
											</Suspense>
											{boundaries.failed && (
												<p
													role="status"
													className="absolute left-12 top-2 z-10 rounded bg-brand-surface px-2 py-1 text-sm shadow-sm"
												>
													{t({
														code: "geoportal.map.shapes_unavailable",
														msg: "Area shapes could not be loaded; the table still shows every figure.",
													})}
												</p>
											)}
										</div>
									)}
								</ClientOnly>
								<div
									className="absolute right-2 lg:right-[400px] bottom-8 z-10 flex flex-col items-end gap-1"
									data-print="hide"
								>
									<ToggleButtonGroup
										aria-label={t({
											code: "geoportal.map.style",
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
										{(
											[
												[
													"bubble",
													{ code: "geoportal.map.bubbles", msg: "Bubbles" },
												],
												["bars", { code: "geoportal.map.bars", msg: "Bars" }],
												[
													"choropleth",
													{ code: "geoportal.map.shading", msg: "Shading" },
												],
											] as const
										).map(([id, label]) => (
											<ToggleButton
												key={id}
												id={id}
												isDisabled={id === "bars" && isEventDim}
												className="px-2 py-1 bg-brand-surface data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[disabled]:opacity-50 data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
											>
												{t(label)}
											</ToggleButton>
										))}
									</ToggleButtonGroup>
									<Button
										onPress={() => setHomeSignal((n) => n + 1)}
										className="border border-brand-border-control rounded px-2 py-1 text-xs bg-brand-surface shadow-sm data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t({ code: "geoportal.map.home", msg: "Full extent" })}
									</Button>
									<ToggleButton
										isSelected={showLabels}
										onChange={setShowLabels}
										className="border border-brand-border-control rounded px-2 py-1 text-xs bg-brand-surface shadow-sm data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t({
											code: "geoportal.map.labels",
											msg: "Boundaries and labels",
										})}
									</ToggleButton>
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
										note={
											data.level >= 1
												? t({
														code: "geoportal.legend.not_sendai",
														msg: "Sub-national figures. Not a Sendai indicator value.",
													})
												: undefined
										}
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
										className="hidden md:block absolute left-12 top-2 z-10 pointer-events-none"
										data-print="hide"
									>
										<GeoReadout
											name={nameOf.get(readoutId) ?? ""}
											area={readoutArea}
											unit={unitLabel}
											partsUnit={housingUnit}
											showValue={layered || symbol !== "bars"}
											reportedNoun={reportedNoun}
											selected={readoutId === shownId && hoverId === null}
											t={t}
										/>
									</div>
								)}
							</div>

							<aside className="min-w-0 lg:absolute lg:right-2 lg:top-2 lg:bottom-2 lg:w-[380px] lg:z-20 lg:shadow-md lg:overflow-auto bg-brand-surface/95 print:!static print:!w-auto print:!h-auto print:!overflow-visible border border-brand-border rounded p-2">
								<Tabs defaultSelectedKey="place">
									<div className="flex flex-wrap items-end gap-2 border-b mb-2">
										<GeoPlacePicker
											options={data.placeOptions}
											shownId={shownId}
											onPick={selectFromList}
											t={t}
										/>
										<TabList
											data-print="hide"
											aria-label={t({ code: "geoportal.panel", msg: "Panel" })}
											className="flex gap-1"
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
									</div>
									<TabPanels>
										<TabPanel
											id="place"
											shouldForceMount
											className="data-[inert]:hidden print:!block"
										>
											{dossier ? (
												<div className="space-y-3">
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
													{query.dimension === "disaster_impact" && (
														<GeoSendai
															cumulative={dossier.cumulative}
															level={dossier.division.level}
															rates={dossier.rates ?? null}
															analysisHref={`/${lang}/analytics?${serializeDeltaQuery(
																dossier.division.id === "country"
																	? withPlace(query, null)
																	: withPlace(query, {
																			divisionId: dossier.division.id,
																		}),
															).toString()}`}
															region={
																query.where.region
																	? {
																			name:
																				data.regions.find(
																					(r) =>
																						r.regionId ===
																						query.where.region?.regionId,
																				)?.name ?? "",
																			href: `/${lang}/analytics?${serializeDeltaQuery(query).toString()}`,
																		}
																	: null
															}
															t={t}
														/>
													)}
												</div>
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
												note={
													data.level >= 1
														? t({
																code: "geoportal.legend.not_sendai",
																msg: "Sub-national figures. Not a Sendai indicator value.",
															})
														: undefined
												}
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
