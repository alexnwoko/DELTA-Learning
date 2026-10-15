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
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";

import {
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	type MapArea,
	type MapPattern,
} from "~/utils/mapState";

/** Areas with no record in scope: not a value state, so drawn on its own. */
export const NO_RECORDS_STYLE = {
	fill: "#f9fafb",
	stroke: "#d1d5db",
	strokeWidth: 0.8,
	label: "No records in scope",
} as const;

export interface GeoMapProps {
	/** GeoJSON FeatureCollection from G1 boundaries. */
	boundaries: { features: unknown[] };
	areas: readonly MapArea[];
	selectedId: string | null;
	onSelect: (divisionId: string | null) => void;
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
		stroke = "#ffffff";
		width = 0.8;
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
			stroke: new Stroke({ color: "#111827", width: 2.5 }),
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
	label,
	describedBy,
}: GeoMapProps) {
	const target = useRef<HTMLDivElement>(null);
	const mapRef = useRef<OlMap | null>(null);
	const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;

	const byId = useMemo(() => new Map(areas.map((a) => [a.areaId, a])), [areas]);

	useEffect(() => {
		if (!target.current) return;
		const layer = new VectorLayer({ source: new VectorSource() });
		const map = new OlMap({
			target: target.current,
			layers: [layer],
			view: new View({ center: [0, 0], zoom: 2 }),
		});
		map.on("singleclick", (e) => {
			const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f);
			const id = hit ? (hit.get("divisionId") as string) : null;
			onSelectRef.current(id);
		});
		mapRef.current = map;
		layerRef.current = layer;
		return () => {
			map.setTarget(undefined);
			mapRef.current = null;
			layerRef.current = null;
		};
	}, []);

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
			className="geo-map"
			style={{ width: "100%", height: "480px", background: "#ffffff" }}
		/>
	);
}
