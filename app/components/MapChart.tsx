import {
	useEffect,
	useState,
	useImperativeHandle,
	forwardRef,
	useRef,
	useCallback,
} from "react";
import type { ValueState } from "~/utils/valueState";
import { ViewContext } from "~/frontend/context";
import { formatNumberWithoutDecimals } from "~/utils/currency";
import {
	type MapArea,
	type MapCell,
	type MapPattern,
	type MapScopeQuery,
	type MapStateResult,
	type MeasureFamily,
	type NotAppliedInput,
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	rampIndex,
	resolveMapState,
} from "~/utils/mapState";

export type MapChartRef = {
	getDataSource: () => DataSourceType;
	setDataSource: (newData: DataSourceType) => void;
	setLegendTitle: (newTitle: string) => void;
	setLegendMaxColor: (newColor: string) => void;
	setMeasureFamily: (family: MeasureFamily | undefined) => void;
};

/** One area as passed by a screen. Counts come from the envelope cell. */
export type MapChartArea = {
	total: number;
	name: string;
	geojson: any;
	colorPercentage?: number;
	description?: string;
	/** When set, drives the map state (TR-076); otherwise 0 means no data. */
	valueState?: ValueState;
	recordsReported?: number;
	recordsZeroConfirmed?: number;
	recordsTotal?: number;
	recordsFlagged?: number;
	flaggedContribution?: number | null;
	sharedRecords?: number;
	gradeDistribution?: MapCell["gradeDistribution"];
	geoPrecision?: string | null;
};

type MapChartProps = {
	ctx: ViewContext;
	id?: string;
	dataSource: MapChartArea[];
	legendMaxColor?: string;
	legendTitle?: string;
	/**
	 * Measure family for the ramp (V-2). Without it the classes are steps of
	 * legendMaxColor, as before.
	 */
	measureFamily?: MeasureFamily;
	/** The query behind the figures, for the scope label (E2 rule 1, C23). */
	scope?: MapScopeQuery;
	/** Filters this measure could not apply (E2 rule 2). */
	notApplied?: readonly (string | NotAppliedInput)[];
	/**
	 * Raster tile URL for an optional basemap. None by default: the
	 * divisions carry the map, and no external tile service is called
	 * (geoportal requirements VIS-F01, no API keys in the client). Set this
	 * only to a self-hosted tile service.
	 */
	basemapUrl?: string;
};

type DataSourceType = MapChartArea[];

// Map states come from the shared resolver (~/utils/mapState), so this map
// and the geoportal cannot disagree: a value is shaded by quantile class; a
// confirmed zero is white with a dashed outline; no data is grey; the other
// states carry their own pattern and outline. Grey and white never mean the
// same thing.

/** Class steps of legendMaxColor when no measure family is given. */
const CLASS_OPACITY = [0.2, 0.4, 0.6, 0.8, 1.0];

/** Public views see published records only unless a scope says otherwise. */
const DEFAULT_SCOPE: MapScopeQuery = { tenant: null, audience: "public" };

/**
 * Envelope cell for one area. A screen that passes no value state has only
 * a total, where 0 means no record reported: it becomes not_reported with a
 * null value, never a drawn zero.
 */
function toCell(area: MapChartArea, index: number): MapCell {
	const valueState: ValueState =
		area.valueState ?? (area.total > 0 ? "reported" : "not_reported");
	const value =
		valueState === "reported" || valueState === "zero_confirmed"
			? area.total
			: null;
	return {
		areaId: String(index),
		value,
		valueState,
		recordsReported: area.recordsReported ?? 0,
		recordsZeroConfirmed: area.recordsZeroConfirmed ?? 0,
		recordsTotal: area.recordsTotal ?? 0,
		recordsFlagged: area.recordsFlagged,
		flaggedContribution: area.flaggedContribution,
		sharedRecords: area.sharedRecords,
		gradeDistribution: area.gradeDistribution,
		geoPrecision: area.geoPrecision,
	};
}

const PATTERN_ID = (pattern: MapPattern) => `delta-map-${pattern}`;

/** SVG pattern bodies, drawn in the state's stroke colour. */
function patternSvg(pattern: MapPattern, fill: string, stroke: string) {
	const bg = `<rect width="6" height="6" fill="${fill}"/>`;
	switch (pattern) {
		case "hatch":
			return `${bg}<path d="M0,6 L6,0 M-1,1 L1,-1 M5,7 L7,5" stroke="${stroke}" stroke-width="1"/>`;
		case "dots":
			return `${bg}<circle cx="3" cy="3" r="1" fill="${stroke}"/>`;
		case "crosshatch":
			return `${bg}<path d="M0,6 L6,0 M0,0 L6,6" stroke="${stroke}" stroke-width="0.8"/>`;
		default:
			return bg;
	}
}

/** One <defs> block with a pattern per patterned state. */
function patternDefs(): string {
	return Object.values(STATE_ENCODING)
		.filter((e) => e.pattern !== "none")
		.map(
			(e) =>
				`<pattern id="${PATTERN_ID(e.pattern)}" patternUnits="userSpaceOnUse" width="6" height="6">${patternSvg(e.pattern, e.fill, e.stroke)}</pattern>`,
		)
		.join("");
}

function ensurePatternDefs(map: any) {
	const svg: SVGSVGElement | null =
		map?.getPanes?.().overlayPane?.querySelector("svg") ?? null;
	if (!svg || svg.querySelector("#delta-map-defs")) return;
	const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
	defs.setAttribute("id", "delta-map-defs");
	defs.innerHTML = patternDefs();
	svg.insertBefore(defs, svg.firstChild);
}

function areaStyle(
	area: MapArea,
	maxColor: string,
	classCount: number,
	family?: MeasureFamily,
) {
	if (area.state === "shaded") {
		const marker = area.quality.plausibility ? PLAUSIBILITY_MARKER : null;
		const step =
			area.classIndex === null
				? CLASS_OPACITY[3]
				: CLASS_OPACITY[rampIndex(area.classIndex, classCount)];
		return {
			color: marker ? marker.stroke : family ? "#374151" : maxColor,
			fillColor: family ? (area.color as string) : maxColor,
			weight: marker ? marker.strokeWidth : 1.2,
			opacity: 1,
			fillOpacity: family ? 1 : step,
		};
	}
	const enc = STATE_ENCODING[area.state];
	return {
		color: enc.stroke,
		fillColor:
			enc.pattern === "none" ? enc.fill : `url(#${PATTERN_ID(enc.pattern)})`,
		weight: enc.strokeWidth,
		opacity: 1,
		dashArray: enc.dashArray ?? undefined,
		fillOpacity: 1,
	};
}

/** Legend swatch as inline SVG, matching the area encoding. */
function Swatch(props: {
	fill: string;
	stroke: string;
	dashArray?: string | null;
	strokeWidth?: number;
	pattern?: MapPattern;
	opacity?: number;
}) {
	const pattern = props.pattern ?? "none";
	const id = `swatch-${pattern}`;
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			aria-hidden="true"
			style={{ marginRight: "8px", flexShrink: 0 }}
		>
			{pattern !== "none" && (
				<defs>
					<pattern
						id={id}
						patternUnits="userSpaceOnUse"
						width="6"
						height="6"
						dangerouslySetInnerHTML={{
							__html: patternSvg(pattern, props.fill, props.stroke),
						}}
					/>
				</defs>
			)}
			<rect
				x="1"
				y="1"
				width="14"
				height="14"
				fill={pattern !== "none" ? `url(#${id})` : props.fill}
				fillOpacity={props.opacity ?? 1}
				stroke={props.stroke}
				strokeWidth={props.strokeWidth ?? 1}
				strokeDasharray={props.dashArray ?? undefined}
			/>
		</svg>
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const glbMapperJS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const glbMapperCSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

const loadLeaflet = (setLeafletLoaded: (loaded: boolean) => void) => {
	if (typeof window === "undefined") return;
	if (!(window as any).L) {
		const leafletCSS = document.createElement("link");
		leafletCSS.rel = "stylesheet";
		leafletCSS.href = glbMapperCSS;
		document.head.appendChild(leafletCSS);

		const leafletJS = document.createElement("script");
		leafletJS.src = glbMapperJS;
		leafletJS.async = true;
		leafletJS.onload = () => {
			console.log("Leaflet loaded successfully.");
			setLeafletLoaded(true);
		};
		document.head.appendChild(leafletJS);
	} else {
		setLeafletLoaded(true);
	}
};

const adjustZoomBasedOnDistance = (map: any, geoJsonLayers: any[]) => {
	const L = (window as any).L;
	const boundsArray: any[] = [];

	geoJsonLayers.forEach((layer) => {
		if (layer && layer.getBounds && layer.getBounds().isValid()) {
			boundsArray.push(layer.getBounds());
		}
	});

	if (boundsArray.length > 0) {
		const bounds = L.latLngBounds(boundsArray.flat());
		if (bounds.isValid()) {
			map.fitBounds(bounds, { padding: [50, 50] });
		}
	} else {
		console.warn("No valid bounds to fit the map.");
		map.setView([11.3233, 124.92], 6);
	}
};

const MapChart = forwardRef<MapChartRef, MapChartProps>(
	(
		{
			ctx,
			id = null,
			dataSource = [],
			legendMaxColor = "#333333",
			legendTitle = "Legend",
			basemapUrl,
			measureFamily,
			scope,
			notApplied,
		},
		ref,
	) => {
		const [generatedId, setGeneratedId] = useState<string | null>(null);
		const [updatedDataSource, setUpdatedDataSource] = useState(dataSource);
		const [currentLegendTitle, setCurrentLegendTitle] = useState(legendTitle);
		const [currentLegendMaxColor, setCurrentLegendMaxColor] =
			useState(legendMaxColor);
		const [currentFamily, setCurrentFamily] = useState<
			MeasureFamily | undefined
		>(measureFamily);
		const [mapState, setMapState] = useState<MapStateResult | null>(null);

		useEffect(() => {
			if (!id) {
				setGeneratedId(
					`id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				);
			}
		}, [id]);

		useEffect(() => {
			setCurrentFamily(measureFamily);
		}, [measureFamily]);

		const componentId = (id || generatedId) as string;

		useImperativeHandle(ref, () => ({
			getDataSource: () => updatedDataSource,
			setDataSource: (newData: DataSourceType) => {
				setUpdatedDataSource(newData);
			},
			setLegendTitle: (newTitle: string) => {
				setCurrentLegendTitle(newTitle);
			},
			setLegendMaxColor: (newColor: string) => {
				setCurrentLegendMaxColor(newColor);
			},
			setMeasureFamily: (family: MeasureFamily | undefined) => {
				setCurrentFamily(family);
			},
		}));

		const [isClient, setIsClient] = useState(false);
		const [isLeafletLoaded, setLeafletLoaded] = useState(false);
		const [isMapRendered, setIsMapRendered] = useState(false);

		const mapRef = useRef<any>(null);

		const makeLegendDraggable = () => {
			const legend = document.getElementById(`${componentId}_map-legend`);
			if (!legend) return;

			let offsetX = 0,
				offsetY = 0,
				isDragging = false;
			const legendWidth = legend.offsetWidth;
			const legendHeight = legend.offsetHeight;
			const legendLeft = legend.offsetLeft;
			const legendTop = legend.offsetTop;

			legend.style.position = "absolute";
			legend.style.width = `${legendWidth}px`;
			legend.style.top = legendTop + "px";
			legend.style.left = legendLeft + "px";
			legend.style.right = "auto";
			legend.style.bottom = "auto";

			legend.onmousedown = (e) => {
				isDragging = true;
				offsetX = e.clientX - legend.offsetLeft;
				offsetY = e.clientY - legend.offsetTop;

				document.onmousemove = (e) => {
					if (!isDragging) return;

					let newLeft = e.clientX - offsetX;
					let newTop = e.clientY - offsetY;

					const maxLeft = window.innerWidth - legendWidth;
					const maxTop = window.innerHeight - legendHeight;

					newLeft = Math.max(0, Math.min(newLeft, maxLeft));
					newTop = Math.max(0, Math.min(newTop, maxTop));

					legend.style.left = `${newLeft}px`;
					legend.style.top = `${newTop}px`;
				};

				document.onmouseup = () => {
					isDragging = false;
					document.onmousemove = null;
					document.onmouseup = null;
				};
			};
		};

		useEffect(() => {
			setIsClient(true);
			loadLeaflet(setLeafletLoaded);
		}, []);

		const updateMapLayers = useCallback(
			(dataSource: DataSourceType) => {
				if (!isClient || !isLeafletLoaded || typeof window === "undefined")
					return;
				if (!dataSource || dataSource.length === 0) return;

				const L = (window as any).L;
				if (!L) {
					console.error("Leaflet is still not available.");
					return;
				}

				// One resolver for every map state, class and marker.
				const resolved = resolveMapState(dataSource.map(toCell), {
					family: currentFamily ?? "people",
					scope: scope ?? DEFAULT_SCOPE,
					notApplied,
				});
				setMapState(resolved);
				setUpdatedDataSource(dataSource);
				const classCount = Math.max(resolved.legend.classes.length, 1);

				setTimeout(() => {
					if (!mapRef.current) {
						console.log("Creating new Leaflet map...");
						// SVG renderer: the state patterns are SVG fills.
						mapRef.current = L.map(componentId, { preferCanvas: false });
						if (basemapUrl) {
							L.tileLayer(basemapUrl, { maxZoom: 20 }).addTo(mapRef.current);
						}
					} else {
						console.log("Clearing previous layers...");
						mapRef.current.eachLayer((layer: any) => {
							if (layer instanceof L.GeoJSON) {
								mapRef.current.removeLayer(layer);
							}
						});
					}

					const geoJsonLayers: any[] = [];

					dataSource.forEach((region, index) => {
						try {
							if (!region.geojson) {
								console.warn(`Skipping invalid GeoJSON:`, region);
								return;
							}
							const area = resolved.areas[index];

							const geojsonLayer = L.geoJSON(region.geojson, {
								style: () =>
									areaStyle(
										area,
										currentLegendMaxColor,
										classCount,
										currentFamily,
									),
							});

							if (geojsonLayer.getPopup()) {
								geojsonLayer.unbindPopup();
							}

							geojsonLayer.bindPopup(popupHtml(ctx, region, area));

							geojsonLayer.addTo(mapRef.current);
							geoJsonLayers.push(geojsonLayer);
						} catch (error) {
							console.error("Error parsing GeoJSON:", error);
						}
					});
					ensurePatternDefs(mapRef.current);

					setTimeout(() => {
						adjustZoomBasedOnDistance(mapRef.current, geoJsonLayers);
						setIsMapRendered(true);
						setTimeout(() => {
							makeLegendDraggable();
						}, 1000);

						const attributionElement = document.querySelector(
							".leaflet-control-attribution.leaflet-control a",
						);
						if (attributionElement) {
							attributionElement.remove();
						}
					}, 500);
				}, 500);
			},
			[
				isClient,
				isLeafletLoaded,
				currentLegendMaxColor,
				currentFamily,
				basemapUrl,
				componentId,
				scope,
				notApplied,
			],
		);

		useEffect(() => {
			updateMapLayers(dataSource);
		}, [dataSource, updateMapLayers]);

		const legend = mapState?.legend;
		const showLegend =
			isMapRendered &&
			!!legend &&
			(legend.mode !== "empty" || legend.states.length > 0);

		const legendRow = {
			marginBottom: "5px",
			display: "flex",
			alignItems: "center",
		} as const;

		return (
			<div style={{ position: "relative" }}>
				{mapState && (scope || mapState.notApplied.length > 0) && (
					<div style={{ fontSize: "13px", marginBottom: "6px" }}>
						{scope && (
							<p style={{ margin: "0 0 4px 0" }}>{mapState.scope.text}</p>
						)}
						{mapState.notApplied.map((strip) => (
							<p
								key={strip.filter}
								role="note"
								style={{
									margin: "0 0 4px 0",
									padding: "4px 8px",
									borderLeft: "3px solid #b45309",
									background: "#fff7ed",
								}}
							>
								{strip.text}
							</p>
						))}
					</div>
				)}
				<div
					id={componentId}
					style={{
						height: "500px",
						width: "100%",
						zIndex: "0",
						backgroundColor: "#f3f4f6",
					}}
				></div>

				{showLegend && legend && (
					<div
						id={`${componentId}_map-legend`}
						style={{
							position: "absolute",
							bottom: "10px",
							right: "10px",
							background: "white",
							padding: "10px",
							borderRadius: "5px",
							boxShadow: "0px 0px 10px rgba(0, 0, 0, 0.3)",
							fontSize: "14px",
							lineHeight: "1.5",
							whiteSpace: "nowrap",
						}}
					>
						<strong>{currentLegendTitle}</strong>
						<ul style={{ listStyle: "none", padding: 0, margin: "5px 0 0 0" }}>
							{legend.mode === "classes" &&
								legend.classes.map((c) => (
									<li key={`class-${c.index}`} style={legendRow}>
										<Swatch
											fill={currentFamily ? c.color : currentLegendMaxColor}
											opacity={
												currentFamily
													? 1
													: CLASS_OPACITY[
															rampIndex(c.index, legend.classes.length)
														]
											}
											stroke={currentFamily ? "#374151" : currentLegendMaxColor}
										/>
										{c.lower === c.upper
											? formatNumberWithoutDecimals(c.upper)
											: `${formatNumberWithoutDecimals(c.lower)} to ${formatNumberWithoutDecimals(c.upper)}`}
									</li>
								))}
							{legend.mode === "single_tone" && legend.singleTone && (
								<li style={{ ...legendRow, whiteSpace: "normal" }}>
									<Swatch
										fill={
											currentFamily
												? legend.singleTone.color
												: currentLegendMaxColor
										}
										opacity={currentFamily ? 1 : CLASS_OPACITY[3]}
										stroke={currentFamily ? "#374151" : currentLegendMaxColor}
									/>
									{legend.singleTone.reason === "too_few_areas"
										? ctx.t(
												{
													code: "analysis.map_single_tone_few_areas",
													desc: "Legend note when too few areas report a value to draw classes. {n} is the number of areas with a value, {min} the number needed.",
													msg: "One tone: only {n} areas reported a value ({min} needed for classes)",
												},
												{
													n: legend.singleTone.areasShaded,
													min: legend.singleTone.minimum,
												},
											)
										: ctx.t({
												code: "analysis.map_single_tone_one_value",
												msg: "One tone: every reporting area has the same value",
											})}
								</li>
							)}
							{legend.states.map(({ state }) => {
								const enc = STATE_ENCODING[state];
								return (
									<li key={state} style={legendRow}>
										<Swatch
											fill={enc.fill}
											stroke={enc.stroke}
											dashArray={enc.dashArray}
											strokeWidth={enc.strokeWidth}
											pattern={enc.pattern}
										/>
										{stateLabel(ctx, state)}
									</li>
								);
							})}
							{legend.flaggedAreas > 0 && (
								<li style={legendRow}>
									<Swatch
										fill="#ffffff"
										stroke={PLAUSIBILITY_MARKER.stroke}
										strokeWidth={PLAUSIBILITY_MARKER.strokeWidth}
									/>
									{ctx.t({
										code: "analysis.map_flagged_marker",
										msg: "Includes records flagged for review",
									})}
								</li>
							)}
							{legend.provisional && (
								<li style={legendRow}>
									{ctx.t({
										code: "analysis.provisional_not_for_citation",
										msg: "Provisional, not for citation",
									})}
								</li>
							)}
						</ul>
					</div>
				)}
			</div>
		);
	},
);

function stateLabel(
	ctx: ViewContext,
	state: Exclude<MapArea["state"], "shaded">,
): string {
	switch (state) {
		case "zero_confirmed":
			return ctx.t({ code: "analysis.zero_confirmed", msg: "Zero, confirmed" });
		case "not_reported":
			return ctx.t({ code: "common.no_data", msg: "No data" });
		case "insufficient_reporting":
			return ctx.t({
				code: "analysis.too_few_confirm_zero",
				msg: "Too few records confirm zero",
			});
		case "not_applicable":
			return ctx.t({
				code: "analysis.not_applicable",
				msg: "Not applicable",
			});
		case "suppressed":
			return ctx.t({ code: "analysis.withheld", msg: "Withheld" });
	}
}

/** Popup: the screen's description, then the resolver's tooltip parts. */
function popupHtml(
	ctx: ViewContext,
	region: MapChartArea,
	area: MapArea,
): string {
	const lines: string[] = [];
	// A withheld zero shows its state, not the screen's text with the 0.
	const withheld = area.reason === "zero_withheld_until_v5";
	if ((region.valueState || region.total > 0) && !withheld) {
		if (region.description) lines.push(escapeHtml(region.description));
	}
	if (area.state !== "shaded" && (!region.valueState || withheld)) {
		lines.push(escapeHtml(stateLabel(ctx, area.state)));
	}
	if (withheld) {
		lines.push(
			escapeHtml(
				ctx.t({
					code: "analysis.zero_withheld_public",
					msg: "Confirmed zeros are not shown publicly until the coverage rule is final",
				}),
			),
		);
	}
	const t = area.tooltip;
	if (region.recordsTotal !== undefined && t.reportedBy.of > 0) {
		lines.push(
			escapeHtml(
				ctx.t(
					{
						code: "analysis.reported_by_n_of_n",
						desc: "Map tooltip. {n} records reported the measure out of {total} in scope.",
						msg: "Reported by {n} of {total} records",
					},
					{ n: t.reportedBy.n, total: t.reportedBy.of },
				),
			),
		);
	}
	if (area.quality.plausibility) {
		lines.push(
			escapeHtml(
				ctx.t(
					{
						code: "analysis.map_flagged_records",
						desc: "Map tooltip caveat. {n} is the number of records flagged for review.",
						msg: "Caveat: includes {n} record(s) flagged for review",
					},
					{ n: area.quality.plausibility.flaggedRecords },
				),
			),
		);
	}
	if (t.precision) lines.push(escapeHtml(`Precision: ${t.precision}`));
	if (t.gradeDistribution) {
		lines.push(
			escapeHtml(
				`Attribution: ${t.gradeDistribution.map((g) => `ATT-${g.grade} ${g.records}`).join(", ")}`,
			),
		);
	}
	if (area.quality.provisional) {
		lines.push(
			escapeHtml(
				ctx.t({
					code: "analysis.provisional_not_for_citation",
					msg: "Provisional, not for citation",
				}),
			),
		);
	}
	return `
                <div style="
                  max-width: 300px; 
                  padding: 10px; 
                  font-size: 1.2em; 
                  text-align: left;">
                  <strong style="font-size: 1.2em; display: block;">${region.name}</strong>
                  ${lines.map((l) => `<p>${l}</p>`).join("")}
                </div>
              `;
}

export default MapChart;
