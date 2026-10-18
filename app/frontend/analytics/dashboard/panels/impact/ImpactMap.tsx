// Map M0 on Disaster impact (Alex, 2026-10-17): each level-1 division is
// shaded by the number of deaths, and two rounded bars stand on it for
// dwellings destroyed and damaged, never added. MapChart draws it in its
// layered mode; this component turns the loader's payload into map areas
// and says in words what the map cannot show: divisions with no shape,
// records with no division, and records counted in several divisions.
// The figures are sub-national, so no Sendai indicator code appears
// (TR-060, FR-AN-009).
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import MapChart, { type MapChartArea } from "~/components/MapChart";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { ImpactMapArea, ImpactMapPayload } from "~/utils/dashboard/impactMap";
import type { MapScopeQuery } from "~/utils/mapState";
import type { DashboardMapLayers } from "../mapLayers";
import { cellText } from "../../panelCell";
import { ShadedTable } from "../blocks";

const known = (c: PanelCell) => c.valueState === "reported" || c.valueState === "zero_confirmed";

/** A payload area as a MapChart area: deaths shade it, dwellings stand on it as bars. */
export function toMapArea(area: ImpactMapArea, labels: { destroyed: string; damaged: string }): MapChartArea {
	const part = (key: string, label: string, c: PanelCell) => ({
		key,
		label,
		value: known(c) ? c.value : null,
		valueState: c.valueState,
		recordsFlagged: c.recordsFlagged,
	});
	return {
		name: area.name,
		geojson: area.geojson,
		total: known(area.deaths) ? area.deaths.value : null,
		valueState: area.deaths.valueState,
		recordsReported: area.deaths.recordsReported,
		recordsZeroConfirmed: area.deaths.recordsZeroConfirmed,
		recordsTotal: area.deaths.recordsTotal,
		recordsFlagged: area.deaths.recordsFlagged,
		labelPoint: area.labelPoint,
		parts: [
			part("destroyed", labels.destroyed, area.dwellingsDestroyed),
			part("damaged", labels.damaged, area.dwellingsDamaged),
		],
	};
}

export interface ImpactMapProps {
	ctx: ViewContext;
	map: ImpactMapPayload;
	scope: MapScopeQuery;
	/** Selecting an area sets the place filter for the whole page (brief section 2). */
	onSelectDivision?: (divisionId: string) => void;
	/** Basemap and country boundary layers, from the route loader. */
	layers?: DashboardMapLayers;
}

export function ImpactMap({ ctx, map, scope, onSelectDivision, layers }: ImpactMapProps) {
	const t = ctx.t;
	const labels = {
		destroyed: t({ code: "dashboard.map_dwellings_destroyed", msg: "Dwellings destroyed" }),
		damaged: t({ code: "dashboard.map_dwellings_damaged", msg: "Dwellings damaged" }),
	};
	const drawn = map.areas.filter((a) => a.geojson !== null);
	const unmapped = map.areas.filter((a) => a.geojson === null);
	const deathsLabel = t({ code: "dashboard.map_deaths", msg: "Number of deaths" });
	const n = (x: number) => x.toLocaleString(ctx.lang);

	return (
		<figure className="m-0 flex flex-col gap-2 p-3">
			<div className="h-[320px] min-h-[260px]">
				<MapChart
					ctx={ctx}
					id="dashboard-m0"
					dataSource={drawn.map((a) => toMapArea(a, labels))}
					legendTitle={deathsLabel}
					measureFamily="people"
					layered={{ barsFamily: "housing" }}
					scope={scope}
					// The map reports the index among the drawn areas.
					onAreaClick={onSelectDivision ? (i) => onSelectDivision(drawn[i].divisionId) : undefined}
					notApplied={map.meta.notApplied}
					basemaps={layers?.basemaps}
					boundaries={layers?.boundaries}
				/>
			</div>
			<figcaption className="flex flex-col gap-1 text-sm text-brand-text-muted">
				<p role="note" className="m-0 font-semibold text-brand-text">
					{t({ code: "dashboard.map_subnational", msg: "Sub-national figures. Not a Sendai indicator value." })}
				</p>
				<p className="m-0">
					{t(
						{
							code: "dashboard.map_reading",
							msg: "Shading: {deaths}. Bars: {destroyed} and {damaged}, side by side and never added.",
						},
						{ deaths: deathsLabel, destroyed: labels.destroyed, damaged: labels.damaged },
					)}
				</p>
				{map.recordsWithoutDivision > 0 && (
					<p className="m-0">
						{t(
							{ code: "dashboard.map_no_division", msg: "{n} records in scope have no division and are not on the map." },
							{ n: n(map.recordsWithoutDivision) },
						)}
					</p>
				)}
				{map.multiDivisionRecords > 0 && (
					<p className="m-0">
						{t(
							{
								code: "dashboard.map_multi_division",
								msg: "{n} records touch several divisions and count in each, so areas do not add up.",
							},
							{ n: n(map.multiDivisionRecords) },
						)}
					</p>
				)}
				{unmapped.length > 0 && (
					<p className="m-0">
						<span className="font-semibold text-brand-text">
							{t({ code: "dashboard.map_not_on_map", msg: "Not on the map (no boundary held):" })}
						</span>{" "}
						{unmapped
							.map((a) => `${a.name} (${deathsLabel}: ${cellText(ctx, a.deaths)}; ${labels.destroyed}: ${cellText(ctx, a.dwellingsDestroyed)}; ${labels.damaged}: ${cellText(ctx, a.dwellingsDamaged)})`)
							.join("; ")}
					</p>
				)}
				<p className="m-0">
					{t({
						code: "dashboard.map_simplified",
						msg: "Boundaries simplified to about 500 m for display.",
					})}
				</p>
			</figcaption>
			{/* The table is the map's accessible alternative and prints open. */}
			<Disclosure data-print="expand">
				<Button
					slot="trigger"
					data-print="hide"
					className="text-sm text-brand-interactive underline data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
				>
					{t({ code: "dashboard.map_table", msg: "Map data as a table" })}
				</Button>
				<DisclosurePanel>
					<ShadedTable
						ctx={ctx}
						caption={t({ code: "dashboard.map_table", msg: "Map data as a table" })}
						rowHeader={t({ code: "dashboard.division", msg: "Division" })}
						columns={[deathsLabel, labels.destroyed, labels.damaged]}
						rows={map.areas.map((a) => ({
							key: a.divisionId,
							label: a.name,
							cells: [a.deaths, a.dwellingsDestroyed, a.dwellingsDamaged],
						}))}
						normalise="column"
					/>
				</DisclosurePanel>
			</Disclosure>
		</figure>
	);
}

export default ImpactMap;
