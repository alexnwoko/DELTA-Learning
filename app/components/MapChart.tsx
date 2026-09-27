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

export type MapChartRef = {
	getDataSource: () => DataSourceType;
	setDataSource: (newData: DataSourceType) => void;
	setLegendTitle: (newTitle: string) => void;
	setLegendMaxColor: (newColor: string) => void;
};

type MapChartProps = {
	ctx: ViewContext;
	id?: string;
	dataSource: {
		total: number;
		name: string;
		geojson: any;
		colorPercentage?: number;
		description?: string;
		/** When set, drives the map state (TR-076); otherwise 0 means no data. */
		valueState?: ValueState;
	}[];
	legendMaxColor?: string;
	legendTitle?: string;
	mapMode?: "default" | "light" | "dark";
};

type DataSourceType = {
	total: number;
	name: string;
	geojson: any;
	colorPercentage?: number;
	description?: string;
	valueState?: ValueState;
}[];

// Map states: a value is shaded; a confirmed zero is white with a dashed
// outline; anything else (not reported, insufficient, no records) is grey.
// Grey and white never mean the same thing.
const NO_DATA_FILL = "#c9ced6";
const hasValue = (r: { total: number; valueState?: ValueState }) =>
	r.valueState ? r.valueState === "reported" : r.total !== 0;
const isZeroConfirmed = (r: { valueState?: ValueState }) =>
	r.valueState === "zero_confirmed";
const isNoData = (r: { total: number; valueState?: ValueState }) =>
	r.valueState
		? r.valueState !== "reported" && r.valueState !== "zero_confirmed"
		: r.total === 0;

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

const getOpacityForRange = (value: number, min: number, max: number) => {
	if (value === 0) return 0;
	if (max === min) return 1.0;
	const normalizedValue = (value - min) / (max - min);
	return 0.1 + normalizedValue * 0.9;
};

const getTileLayer = (mapMode: string) => {
	switch (mapMode) {
		case "light":
			return "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
		case "dark":
			return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
		default:
			return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
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
			mapMode = "light",
		},
		ref,
	) => {
		const [generatedId, setGeneratedId] = useState<string | null>(null);
		const [updatedDataSource, setUpdatedDataSource] = useState(dataSource);
		const [currentLegendTitle, setCurrentLegendTitle] = useState(legendTitle);
		const [currentLegendMaxColor, setCurrentLegendMaxColor] =
			useState(legendMaxColor);

		useEffect(() => {
			if (!id) {
				setGeneratedId(
					`id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				);
			}
		}, [id]);

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
		}));

		const [isClient, setIsClient] = useState(false);
		const [isLeafletLoaded, setLeafletLoaded] = useState(false);
		const [isMapRendered, setIsMapRendered] = useState(false);
		const [minTotal, setMinTotal] = useState(0);
		const [maxTotal, setMaxTotal] = useState(0);

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

				const shaded = dataSource
					.filter(hasValue)
					.map((region) => region.total);
				const minVal = shaded.length ? Math.min(...shaded) : 0;
				const maxVal = shaded.length ? Math.max(...shaded) : 0;

				setMinTotal(minVal);
				setMaxTotal(maxVal);

				const newData = dataSource.map((region) => ({
					...region,
					colorPercentage: hasValue(region)
						? getOpacityForRange(region.total, minVal, maxVal)
						: 0,
				}));

				setUpdatedDataSource(newData);

				setTimeout(() => {
					if (!mapRef.current) {
						console.log("Creating new Leaflet map...");
						mapRef.current = L.map(componentId, { preferCanvas: true });
						L.tileLayer(getTileLayer(mapMode), {
							attribution: "",
							subdomains: "abcd",
							maxZoom: 20,
						}).addTo(mapRef.current);
					} else {
						console.log("Clearing previous layers...");
						mapRef.current.eachLayer((layer: any) => {
							if (layer instanceof L.GeoJSON) {
								mapRef.current.removeLayer(layer);
							}
						});
					}

					const geoJsonLayers: any[] = [];

					newData.forEach((region: any) => {
						try {
							if (!region.geojson) {
								console.warn(`⚠️ Skipping invalid GeoJSON:`, region);
								return;
							}

							const geojsonLayer = L.geoJSON(region.geojson, {
								style: () =>
									isZeroConfirmed(region)
										? {
												color: currentLegendMaxColor,
												fillColor: "#ffffff",
												weight: 1.2,
												opacity: 1,
												dashArray: "4 3",
												fillOpacity: 1,
											}
										: region.valueState && isNoData(region)
											? {
													color: "#8a929c",
													fillColor: NO_DATA_FILL,
													weight: 1,
													opacity: 1,
													fillOpacity: 0.7,
												}
											: {
													color: currentLegendMaxColor,
													fillColor: currentLegendMaxColor,
													weight: 1.2,
													opacity: 1,
													fillOpacity: region.colorPercentage,
												},
							});

							if (geojsonLayer.getPopup()) {
								geojsonLayer.unbindPopup();
							}

							geojsonLayer.bindPopup(
								`
                <div style="
                  max-width: 300px; 
                  padding: 10px; 
                  font-size: 1.2em; 
                  text-align: left;">
                  <strong style="font-size: 1.2em; display: block;">${region.name}</strong>
                  ${region.valueState || region.total > 0 ? `<p>${region?.description || ""}</p>` : ""}
                </div>
              `,
							);

							geojsonLayer.addTo(mapRef.current);
							geoJsonLayers.push(geojsonLayer);
						} catch (error) {
							console.error("Error parsing GeoJSON:", error);
						}
					});

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
			[isClient, isLeafletLoaded, currentLegendMaxColor, mapMode, componentId],
		);

		useEffect(() => {
			updateMapLayers(dataSource);
		}, [dataSource, updateMapLayers]);

		// Compute unique legend items based on actual data
		const uniqueOpacities = Array.from(
			new Set(
				updatedDataSource
					.map((item) => item.colorPercentage)
					.filter(
						(opacity): opacity is number =>
							opacity !== undefined && opacity > 0,
					),
			),
		).sort((a, b) => a - b);

		const hasNoData = updatedDataSource.some(isNoData);
		const hasZeroConfirmed = updatedDataSource.some(isZeroConfirmed);
		const usesStates = updatedDataSource.some((item) => item.valueState);

		return (
			<div style={{ position: "relative" }}>
				<div
					id={componentId}
					style={{
						height: "500px",
						width: "100%",
						zIndex: "0",
						backgroundColor: "#b2d2dd",
					}}
				></div>

				{isMapRendered &&
					(hasNoData || hasZeroConfirmed || uniqueOpacities.length > 0) && (
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
							<ul
								style={{ listStyle: "none", padding: 0, margin: "5px 0 0 0" }}
							>
								{hasNoData && (
									<li
										style={{
											marginBottom: "5px",
											display: "flex",
											alignItems: "center",
										}}
									>
										<span
											style={{
												display: "inline-flex",
												width: "14px",
												height: "14px",
												justifyContent: "center",
												alignItems: "center",
												border: `1px solid ${currentLegendMaxColor}`,
												marginRight: "8px",
											}}
										>
											<div
												style={{
													width: "12px",
													height: "12px",
													backgroundColor: usesStates
														? NO_DATA_FILL
														: "#ffffff",
												}}
											></div>
										</span>
										{ctx.t({ code: "common.no_data", msg: "No data" })}
									</li>
								)}
								{hasZeroConfirmed && (
									<li
										style={{
											marginBottom: "5px",
											display: "flex",
											alignItems: "center",
										}}
									>
										<span
											style={{
												display: "inline-flex",
												width: "14px",
												height: "14px",
												border: `1px dashed ${currentLegendMaxColor}`,
												backgroundColor: "#ffffff",
												marginRight: "8px",
											}}
										></span>
										{ctx.t({
											code: "analysis.zero_confirmed",
											msg: "Zero, confirmed",
										})}
									</li>
								)}
								{uniqueOpacities.map((opacity, index) => {
									// Calculate the corresponding total value for this opacity
									const normalizedOpacity = (opacity - 0.1) / 0.9; // Reverse the opacity calculation
									const totalValue =
										minTotal + normalizedOpacity * (maxTotal - minTotal);
									return (
										<li
											key={index}
											style={{
												display: "flex",
												alignItems: "center",
												marginBottom: "5px",
											}}
										>
											<span
												style={{
													display: "inline-flex",
													width: "14px",
													height: "14px",
													justifyContent: "center",
													alignItems: "center",
													border: `1px solid ${currentLegendMaxColor}`,
													marginRight: "8px",
												}}
											>
												<div
													style={{
														width: "12px",
														height: "12px",
														backgroundColor: currentLegendMaxColor,
														opacity: opacity,
													}}
												></div>
											</span>
											{`<= ${formatNumberWithoutDecimals(Math.ceil(totalValue))}`}
										</li>
									);
								})}
							</ul>
						</div>
					)}
			</div>
		);
	},
);

export default MapChart;
