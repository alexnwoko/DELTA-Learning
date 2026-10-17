// Geoportal map (increment I-2): OpenLayers, client side only. Every area is
// drawn from the shared map-state resolver (app/utils/mapState.ts): shaded
// areas from the ramp, every other state from STATE_ENCODING, so no state is
// told apart by lightness alone and null is never drawn as zero (TR-169).
// The map is never the only way to read the figures: GeoTable shows the same
// cells (TR-176).
import { useEffect, useMemo, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import VectorLayer from "ol/layer/Vector";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import {
	defaults as defaultInteractions,
	MouseWheelZoom,
} from "ol/interaction";
import { platformModifierKeyOnly } from "ol/events/condition";
import "ol/ol.css";
import type { FeatureLike } from "ol/Feature";

import {
	BAR_WIDTH_PX,
	barLengthPx,
	bubbleRadiusPx,
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	type MapArea,
	type MapPattern,
} from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/geoCells";
import { dataTokens } from "~/utils/designTokens.generated";
import {
	printableBasemap,
	type BasemapLayer,
	type BasemapLayerId,
} from "~/utils/basemap";
import { transformExtent } from "ol/proj";

export { NO_RECORDS_STYLE };

export interface GeoMapProps {
	/** GeoJSON FeatureCollection from G1 boundaries. */
	boundaries: { features: unknown[] };
	areas: readonly MapArea[];
	selectedId: string | null;
	onSelect: (divisionId: string | null) => void;
	/** Pointer hover; null when the pointer leaves every area. */
	onHover?: (divisionId: string | null) => void;
	/**
	 * Area to bring into view. Set when an area is chosen from the list, so
	 * the map follows the keyboard path (TR-176).
	 */
	focusId?: string | null;
	/** Map height; the page sets it to fill the viewport. */
	height?: string;
	/**
	 * Basemap layers the reader may pick (I-3 switcher). None is drawn until
	 * the reader picks one (TR-166).
	 */
	basemaps?: readonly BasemapLayer[];
	/** The layer the reader picked; null draws no basemap. */
	basemapId?: BasemapLayerId | null;
	/** Reports "unavailable" when basemap tiles fail to load (NFR-042). */
	onBasemapStatus?: (status: "ok" | "unavailable") => void;
	/** Each change of this number fits the map back to all areas. */
	homeSignal?: number;
	/** Colour of bubbles and bars (legend.symbols.color); none in shading mode. */
	symbolColor?: string | null;
	/** Accessible name; the table alternative carries the figures. */
	label: string;
	describedBy?: string;
}

function dash(dashArray: string | null): number[] | undefined {
	return dashArray ? dashArray.split(/\s+/).map(Number) : undefined;
}

const patternCache = new Map<string, CanvasPattern | string>();

/** A small repeating tile: the state's fill with its pattern in the stroke colour. */
function patternFill(
	pattern: MapPattern,
	fill: string,
	stroke: string,
): CanvasPattern | string {
	if (pattern === "none" || typeof document === "undefined") return fill;
	const key = `${pattern}|${fill}|${stroke}`;
	const cached = patternCache.get(key);
	if (cached) return cached;
	const size = 8;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const c = canvas.getContext("2d");
	if (!c) return fill;
	c.fillStyle = fill;
	c.fillRect(0, 0, size, size);
	c.strokeStyle = stroke;
	c.fillStyle = stroke;
	c.lineWidth = 1;
	if (pattern === "hatch" || pattern === "crosshatch") {
		c.beginPath();
		c.moveTo(0, size);
		c.lineTo(size, 0);
		if (pattern === "crosshatch") {
			c.moveTo(0, 0);
			c.lineTo(size, size);
		}
		c.stroke();
	} else if (pattern === "dots") {
		c.beginPath();
		c.arc(size / 2, size / 2, 1.2, 0, Math.PI * 2);
		c.fill();
	}
	const result = c.createPattern(canvas, "repeat") ?? fill;
	patternCache.set(key, result);
	return result;
}

function styleFor(area: MapArea | undefined, selected: boolean): Style {
	let fill: CanvasPattern | string;
	let stroke: string;
	let width: number;
	let lineDash: number[] | undefined;
	if (!area) {
		fill = NO_RECORDS_STYLE.fill;
		stroke = NO_RECORDS_STYLE.stroke;
		width = NO_RECORDS_STYLE.strokeWidth;
	} else if (area.state === "shaded") {
		fill = area.color ?? NO_RECORDS_STYLE.fill;
		stroke = dataTokens.map.areaBoundary.stroke;
		width = dataTokens.map.areaBoundary.strokeWidth;
	} else {
		const enc = STATE_ENCODING[area.state];
		fill = patternFill(enc.pattern, enc.fill, enc.stroke);
		stroke = enc.stroke;
		width = enc.strokeWidth;
		lineDash = dash(enc.dashArray);
	}
	if (area?.quality.plausibility) {
		stroke = PLAUSIBILITY_MARKER.stroke;
		width = PLAUSIBILITY_MARKER.strokeWidth;
		lineDash = undefined;
	}
	const styles = new Style({
		fill: new Fill({ color: fill }),
		stroke: new Stroke({ color: stroke, width, lineDash }),
		zIndex: selected ? 2 : area ? 1 : 0,
	});
	if (selected) {
		// D-3D-1: a raised outline on the selected area; depth carries no data.
		return new Style({
			fill: styles.getFill() ?? undefined,
			stroke: new Stroke({
				color: dataTokens.map.selectedOutline.stroke,
				width: dataTokens.map.selectedOutline.strokeWidth,
			}),
			zIndex: 3,
		});
	}
	return styles;
}

const RING_GAP_PX = 2;
const RING_WIDTH_PX = 2;
const RING_TRACK = "#d1d5db";
const SLOT_STROKE = "#9ca3af";

/**
 * Draws one area's symbol on its anchor point (Alex 2026-10-17, map symbol
 * research s4 and s5): a bubble whose area carries the value, with a thin
 * ring whose filled arc is the share of records reporting (n of N) and a
 * break mark when drawn at the cap; or rounded bars on one shared scale,
 * where a part not reported is an empty dashed slot, never a short bar.
 * Off-ramp areas have no symbol, so a missing figure never reads as small.
 */
export function symbolStyle(area: MapArea, color: string): Style | undefined {
	const sym = area.symbol;
	if (!sym) return undefined;
	const flagged = Boolean(area.quality.plausibility);
	if (sym.kind === "bubble") {
		const r = bubbleRadiusPx(sym.areaRatio);
		return new Style({
			zIndex: Math.round(1000 - r * 10),
			renderer: (coords, state) => {
				const c = state.context;
				const pr = state.pixelRatio;
				const [x, y] = coords as number[];
				c.save();
				c.beginPath();
				c.arc(x, y, r * pr, 0, Math.PI * 2);
				c.globalAlpha = 0.75;
				c.fillStyle = color;
				c.fill();
				c.globalAlpha = 1;
				c.lineWidth = (flagged ? PLAUSIBILITY_MARKER.strokeWidth : 1) * pr;
				c.strokeStyle = flagged ? PLAUSIBILITY_MARKER.stroke : "#ffffff";
				c.stroke();
				if (sym.ring.of > 0) {
					const rr = (r + RING_GAP_PX + RING_WIDTH_PX / 2) * pr;
					c.lineWidth = RING_WIDTH_PX * pr;
					c.beginPath();
					c.arc(x, y, rr, 0, Math.PI * 2);
					c.strokeStyle = RING_TRACK;
					c.stroke();
					const share = Math.min(sym.ring.n / sym.ring.of, 1);
					if (share > 0) {
						c.beginPath();
						c.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
						c.strokeStyle = color;
						c.stroke();
					}
				}
				if (sym.outlier) {
					c.beginPath();
					c.moveTo(x - r * 0.5 * pr, y + 3 * pr);
					c.lineTo(x + r * 0.5 * pr, y - 3 * pr);
					c.lineWidth = 2 * pr;
					c.strokeStyle = "#ffffff";
					c.stroke();
				}
				c.restore();
			},
		});
	}
	const longest = Math.max(
		0,
		...sym.bars.map((b) => (b.ratio === null ? 0 : b.ratio)),
	);
	return new Style({
		zIndex: Math.round(1000 - longest * 999),
		renderer: (coords, state) => {
			const c = state.context;
			const pr = state.pixelRatio;
			const [x, y] = coords as number[];
			const gap = 2;
			const w = BAR_WIDTH_PX;
			const total = sym.bars.length * (w + gap) - gap;
			c.save();
			sym.bars.forEach((b, i) => {
				const left = x + (-total / 2 + i * (w + gap)) * pr;
				if (b.ratio === null) {
					const h = 10;
					c.beginPath();
					// Rounded at the value end only, on a flat baseline (Alex).
					c.roundRect(left, y - h * pr, w * pr, h * pr, [
						(w / 2) * pr,
						(w / 2) * pr,
						0,
						0,
					]);
					c.setLineDash([2 * pr, 2 * pr]);
					c.lineWidth = pr;
					c.strokeStyle = SLOT_STROKE;
					c.stroke();
					c.setLineDash([]);
					return;
				}
				const h = barLengthPx(b.ratio);
				c.beginPath();
				// Rounded at the value end only, on a flat baseline (Alex).
				c.roundRect(left, y - h * pr, w * pr, h * pr, [
					(w / 2) * pr,
					(w / 2) * pr,
					0,
					0,
				]);
				c.globalAlpha = 1 - i * 0.3;
				c.fillStyle = color;
				c.fill();
				c.globalAlpha = 1;
				c.lineWidth = pr;
				c.strokeStyle = b.flagged ? PLAUSIBILITY_MARKER.stroke : "#ffffff";
				c.stroke();
			});
			c.restore();
		},
	});
}

export function GeoMap({
	boundaries,
	areas,
	selectedId,
	onSelect,
	onHover,
	focusId,
	height = "480px",
	basemaps = [],
	basemapId = null,
	onBasemapStatus,
	homeSignal = 0,
	symbolColor = null,
	label,
	describedBy,
}: GeoMapProps) {
	const target = useRef<HTMLDivElement>(null);
	const mapRef = useRef<OlMap | null>(null);
	const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	const onHoverRef = useRef(onHover);
	onHoverRef.current = onHover;
	const onStatusRef = useRef(onBasemapStatus);
	onStatusRef.current = onBasemapStatus;
	const baseRef = useRef(new Map<BasemapLayerId, TileLayer<XYZ>>());
	const shownRef = useRef<BasemapLayerId | null>(null);
	const symbolLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

	const byId = useMemo(() => new Map(areas.map((a) => [a.areaId, a])), [areas]);

	/** Reports "unavailable" when a basemap's tiles fail before any loads. */
	function watchTiles(source: XYZ) {
		let loaded = 0;
		source.on("tileloadend", () => {
			loaded++;
			onStatusRef.current?.("ok");
		});
		source.on("tileloaderror", () => {
			if (loaded === 0) onStatusRef.current?.("unavailable");
		});
	}

	useEffect(() => {
		if (!target.current) return;
		const layer = new VectorLayer({ source: new VectorSource() });
		const bases = new Map<BasemapLayerId, TileLayer<XYZ>>();
		for (const b of basemaps) {
			// Google's URL needs a session; its source is set when first picked.
			const source = b.google
				? null
				: new XYZ({
						url: b.url,
						attributions: b.attribution,
						attributionsCollapsible: false,
						minZoom: b.minZoom,
						maxZoom: b.maxZoom,
						tileSize: b.tileSize,
						// Self-hosted tiles stay CORS-clean for export; third-party
						// tiles never print or export.
						crossOrigin: b.thirdParty ? undefined : "anonymous",
					});
			const tl = new TileLayer<XYZ>({
				source: source ?? undefined,
				visible: false,
				zIndex: 0,
			});
			if (source) watchTiles(source);
			bases.set(b.id, tl);
		}
		layer.setZIndex(1);
		// Symbols are never decluttered: hiding a feature would hide data.
		const symbols = new VectorLayer({ source: new VectorSource(), zIndex: 2 });
		symbolLayerRef.current = symbols;
		const map = new OlMap({
			target: target.current,
			layers: [...bases.values(), layer, symbols],
			controls: defaultControls().extend([new ScaleLine({ units: "metric" })]),
			// The wheel scrolls the page; Ctrl or Cmd plus the wheel zooms the map.
			interactions: defaultInteractions({ mouseWheelZoom: false }).extend([
				new MouseWheelZoom({ condition: platformModifierKeyOnly }),
			]),
			view: new View({ center: [0, 0], zoom: 2 }),
		});
		map.on("singleclick", (e) => {
			const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f);
			const id = hit ? (hit.get("divisionId") as string) : null;
			onSelectRef.current(id);
		});
		let hovered: string | null = null;
		map.on("pointermove", (e) => {
			if (e.dragging) return;
			const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f);
			const id = hit ? (hit.get("divisionId") as string) : null;
			map.getTargetElement().style.cursor = id ? "pointer" : "";
			if (id !== hovered) {
				hovered = id;
				onHoverRef.current?.(id);
			}
		});
		map.getViewport().addEventListener("pointerleave", () => {
			hovered = null;
			onHoverRef.current?.(null);
		});
		// Paper is another size: redraw the canvas before and after printing.
		// Third-party tiles never print: the first self-hosted layer stands
		// in while printing, and the reader's choice comes back after.
		const beforePrint = () => {
			const onPaper = printableBasemap(basemaps, shownRef.current);
			for (const [id, tl] of bases) tl.setVisible(id === onPaper);
			map.updateSize();
		};
		const afterPrint = () => {
			for (const [id, tl] of bases) tl.setVisible(id === shownRef.current);
			map.updateSize();
		};
		window.addEventListener("beforeprint", beforePrint);
		window.addEventListener("afterprint", afterPrint);
		mapRef.current = map;
		layerRef.current = layer;
		baseRef.current = bases;
		return () => {
			window.removeEventListener("beforeprint", beforePrint);
			window.removeEventListener("afterprint", afterPrint);
			map.setTarget(undefined);
			mapRef.current = null;
			layerRef.current = null;
			baseRef.current = new Map();
		};
		// The map is built once; the basemap URL comes from server config.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		shownRef.current = basemapId;
		for (const [id, tl] of baseRef.current) tl.setVisible(id === basemapId);
		const picked = basemaps.find((b) => b.id === basemapId);
		const tl = basemapId ? baseRef.current.get(basemapId) : undefined;
		const map = mapRef.current;
		if (!picked?.google || !tl || !map || tl.getSource()) return;
		// Google: one session per page view, created only when the reader
		// picks Google; the copyright line follows the view (Map Tiles API).
		const g = picked.google;
		let live = true;
		fetch(g.createSessionUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				mapType: "roadmap",
				language: g.language,
				region: g.region,
			}),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((res: { session: string }) => {
				if (!live) return;
				const source = new XYZ({
					url: picked.url.replace("{session}", encodeURIComponent(res.session)),
					attributions: picked.attribution,
					attributionsCollapsible: false,
					minZoom: picked.minZoom,
					maxZoom: picked.maxZoom,
					tileSize: picked.tileSize,
				});
				watchTiles(source);
				tl.setSource(source);
				const copyright = () => {
					const [w, s, e, n] = transformExtent(
						map.getView().calculateExtent(map.getSize()),
						"EPSG:3857",
						"EPSG:4326",
					);
					const z = Math.round(map.getView().getZoom() ?? 0);
					const q = `&session=${encodeURIComponent(res.session)}&zoom=${z}&north=${n}&south=${s}&east=${e}&west=${w}`;
					fetch(g.viewportUrl + q)
						.then((r) => (r.ok ? r.json() : null))
						.then((v: { copyright?: string } | null) =>
							source.setAttributions(
								v?.copyright
									? `${picked.attribution} ${v.copyright}`
									: picked.attribution,
							),
						)
						.catch(() => {});
				};
				map.on("moveend", copyright);
				copyright();
			})
			.catch(() => live && onStatusRef.current?.("unavailable"));
		return () => {
			live = false;
		};
		// basemaps come from server config and do not change on the page.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [basemapId]);

	useEffect(() => {
		const layer = layerRef.current;
		const map = mapRef.current;
		if (!layer || !map) return;
		const source = layer.getSource();
		if (!source) return;
		source.clear();
		const features = new GeoJSON().readFeatures(boundaries, {
			dataProjection: "EPSG:4326",
			featureProjection: "EPSG:3857",
		});
		source.addFeatures(features);
		const symbolSource = symbolLayerRef.current?.getSource();
		symbolSource?.clear();
		for (const f of boundaries.features as {
			properties?: { divisionId?: string; labelPoint?: [number, number] };
		}[]) {
			const pt = f.properties?.labelPoint;
			if (!pt || !f.properties?.divisionId) continue;
			const sf = new Feature({ geometry: new Point(fromLonLat(pt)) });
			sf.set("divisionId", f.properties.divisionId);
			symbolSource?.addFeature(sf);
		}
		const extent = source.getExtent();
		if (features.length && extent && extent.every(Number.isFinite)) {
			map.getView().fit(extent, { padding: [16, 16, 16, 16], maxZoom: 9 });
		}
	}, [boundaries]);

	useEffect(() => {
		if (!homeSignal) return;
		const map = mapRef.current;
		const extent = layerRef.current?.getSource()?.getExtent();
		if (map && extent && extent.every(Number.isFinite)) {
			map
				.getView()
				.fit(extent, { padding: [16, 16, 16, 16], maxZoom: 9, duration: 250 });
		}
	}, [homeSignal]);

	useEffect(() => {
		const map = mapRef.current;
		const source = layerRef.current?.getSource();
		if (!map || !source || !focusId) return;
		const feature = source
			.getFeatures()
			.find((f) => f.get("divisionId") === focusId);
		const extent = feature?.getGeometry()?.getExtent();
		if (extent && extent.every(Number.isFinite)) {
			map.getView().fit(extent, {
				padding: [48, 48, 48, 48],
				maxZoom: 9,
				duration: 250,
			});
		}
	}, [focusId]);

	useEffect(() => {
		const symbols = symbolLayerRef.current;
		if (!symbols) return;
		symbols.setVisible(Boolean(symbolColor));
		symbols.setStyle((feature: FeatureLike) => {
			const area = byId.get(feature.get("divisionId") as string);
			return area && symbolColor ? symbolStyle(area, symbolColor) : undefined;
		});
	}, [byId, symbolColor]);

	useEffect(() => {
		const layer = layerRef.current;
		if (!layer) return;
		layer.setStyle((feature: FeatureLike) => {
			const id = feature.get("divisionId") as string;
			return styleFor(byId.get(id), id === selectedId);
		});
	}, [byId, selectedId]);

	return (
		<div
			ref={target}
			role="img"
			aria-label={label}
			aria-describedby={describedBy}
			className="geo-map print:[&_.ol-zoom]:hidden print:[&_.ol-rotate]:hidden"
			style={{
				width: "100%",
				height,
				background: dataTokens.map.canvas.background,
			}}
		/>
	);
}
