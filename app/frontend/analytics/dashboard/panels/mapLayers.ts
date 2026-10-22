// What every Analysis map draws under its data (Alex, 2026-10-18): the
// basemap list, the first one on by default (TR-166 amended), and the
// country outline with area names in light grey. The route loader builds
// both once; ImpactMap and EventMap pass them to MapChart unchanged.
import type { ComponentProps } from "react";
import type MapChart from "~/components/MapChart";

type MapChartProps = ComponentProps<typeof MapChart>;

export interface DashboardMapLayers {
	basemaps?: MapChartProps["basemaps"];
	boundaries?: MapChartProps["boundaries"];
}
