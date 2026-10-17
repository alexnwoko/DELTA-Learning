// Map M0 on the two event views (Alex, 2026-10-17: every dimension gets a
// map): a bubble per level-1 division sized by the number of events, on the
// same areas as the Disaster impact map. Counts come from the geoportal's
// one placement rule, so both surfaces agree. A division with no event
// reads "No events recorded" and has no bubble; events that could not be
// placed are counted under the map with their reasons.
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import MapChart, { type MapChartArea } from "~/components/MapChart";
import type { ViewContext } from "~/frontend/context";
import type { EventMapArea, EventMapPayload } from "~/utils/dashboard/eventMap";
import type { MapScopeQuery } from "~/utils/mapState";
import { RowBars } from "../blocks";
import { countCell } from "./eventPanels";

/** A payload area as a MapChart area: events size the bubble; none, no bubble. */
export function toEventMapArea(area: EventMapArea, words: { none: string; fromRecords: (n: number) => string }): MapChartArea {
	const has = area.events > 0;
	return {
		name: area.name,
		geojson: area.geojson,
		total: has ? area.events : null,
		valueState: has ? "reported" : "not_reported",
		labelPoint: area.labelPoint,
		description: has ? (area.fromRecords > 0 ? words.fromRecords(area.fromRecords) : undefined) : words.none,
	};
}

export function EventMap({ ctx, map, scope }: { ctx: ViewContext; map: EventMapPayload; scope: MapScopeQuery }) {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const none = t({ code: "dashboard.no_events_year", msg: "No events recorded" });
	const words = {
		none,
		fromRecords: (k: number) =>
			t({ code: "dashboard.map_from_records", msg: "{n} placed through their records" }, { n: n(k) }),
	};
	const drawn = map.areas.filter((a) => a.geojson !== null);
	const unmapped = map.areas.filter((a) => a.geojson === null && a.events > 0);
	const legend = t({ code: "dashboard.map_events", msg: "Number of events" });
	const reasons = Object.entries(map.unplacedReasons).filter(([, k]) => k > 0);

	return (
		<figure className="m-0 flex flex-col gap-2 p-3">
			<div className="h-[320px] min-h-[260px]">
				<MapChart
					ctx={ctx}
					id="dashboard-m0-events"
					dataSource={drawn.map((a) => toEventMapArea(a, words))}
					legendTitle={legend}
					measureFamily="events"
					symbol="bubble"
					scope={scope}
					notApplied={map.meta.notApplied}
				/>
			</div>
			<figcaption className="flex flex-col gap-1 text-sm text-brand-text-muted">
				<p className="m-0">
					{t({
						code: "dashboard.map_events_note",
						msg: "An event in several provinces counts in each, so provinces do not add up.",
					})}
				</p>
				{map.unplacedEvents > 0 && (
					<p className="m-0">
						{t(
							{ code: "dashboard.map_unplaced", msg: "{n} events in scope could not be placed on the map" },
							{ n: n(map.unplacedEvents) },
						)}
						{reasons.length > 0 && `: ${reasons.map(([r, k]) => `${r} (${n(k)})`).join("; ")}`}.
					</p>
				)}
				{unmapped.length > 0 && (
					<p className="m-0">
						<span className="font-semibold text-brand-text">
							{t({ code: "dashboard.map_not_on_map", msg: "Not on the map (no boundary held):" })}
						</span>{" "}
						{unmapped.map((a) => `${a.name} (${n(a.events)})`).join("; ")}
					</p>
				)}
				<p className="m-0">
					{t({ code: "dashboard.map_simplified", msg: "Boundaries simplified to about 500 m for display." })}
				</p>
			</figcaption>
			{/* The map's accessible alternative, printed open. */}
			<Disclosure data-print="expand">
				<Button
					slot="trigger"
					data-print="hide"
					className="text-sm text-brand-interactive underline data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
				>
					{t({ code: "dashboard.map_table", msg: "Map data as a table" })}
				</Button>
				<DisclosurePanel>
					<RowBars
						ctx={ctx}
						label={legend}
						notReportedText={none}
						rows={map.areas.map((a) => ({
							key: a.divisionId,
							label: a.name,
							bars: [{ cell: a.events > 0 ? countCell(a.events) : { ...countCell(0), value: null, valueState: "not_reported" } }],
						}))}
					/>
				</DisclosurePanel>
			</Disclosure>
		</figure>
	);
}

export default EventMap;
