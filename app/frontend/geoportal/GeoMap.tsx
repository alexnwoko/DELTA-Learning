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
import {
	defaults as defaultInteractions,
	MouseWheelZoom,
} from "ol/interaction";
import { platformModifierKeyOnly } from "ol/events/condition";
import "ol/ol.css";
import type { FeatureLike } from "ol/Feature";

import {
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	type MapArea,
	type MapPattern,
} from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/geoCells";
import { dataTokens } from "~/utils/designTokens.generated";
import type { BasemapConfig } from "~/utils/basemap";

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
	 * Self-hosted basemap (I-3, TR-166). Drawn only when `basemapOn`; off by
	 * default. Null when the server has no basemap installed.
	 */
	basemap?: BasemapConfig;
	basemapOn?: boolean;
	/** Reports "unavailable" when basemap tiles fail to load (NFR-042). */
	onBasemapStatus?: (status: "ok" | "unavailable") => void;
	/** Each change of this number fits the map back to all areas. */
	homeSignal?: number;
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

export function GeoMap({
	boundaries,
	areas,
	selectedId,
	onSelect,
	onHover,
	focusId,
	height = "480px",
	basemap = null,
	basemapOn = false,
	onBasemapStatus,
	homeSignal = 0,
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
	const baseRef = useRef<TileLayer<XYZ> | null>(null);

	const byId = useMemo(() => new Map(areas.map((a) => [a.areaId, a])), [areas]);

	useEffect(() => {
		if (!target.current) return;
		const layer = new VectorLayer({ source: new VectorSource() });
		const base = basemap
			? new TileLayer({
					source: new XYZ({
						url: basemap.url,
						attributions: basemap.attribution,
						attributionsCollapsible: false,
						minZoom: basemap.minZoom,
						maxZoom: basemap.maxZoom,
						crossOrigin: "anonymous",
					}),
					visible: false,
					zIndex: 0,
				})
			: null;
		if (base) {
			let loaded = 0;
			const source = base.getSource();
			source?.on("tileloadend", () => {
				loaded++;
				onStatusRef.current?.("ok");
			});
			source?.on("tileloaderror", () => {
				if (loaded === 0) onStatusRef.current?.("unavailable");
			});
		}
		layer.setZIndex(1);
		const map = new OlMap({
			target: target.current,
			layers: base ? [base, layer] : [layer],
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
		const resize = () => map.updateSize();
		window.addEventListener("beforeprint", resize);
		window.addEventListener("afterprint", resize);
		mapRef.current = map;
		layerRef.current = layer;
		baseRef.current = base;
		return () => {
			window.removeEventListener("beforeprint", resize);
			window.removeEventListener("afterprint", resize);
			map.setTarget(undefined);
			mapRef.current = null;
			layerRef.current = null;
			baseRef.current = null;
		};
		// The map is built once; the basemap URL comes from server config.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		baseRef.current?.setVisible(basemapOn);
	}, [basemapOn]);

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
