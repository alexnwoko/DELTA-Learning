// The D1 map for the two event views: events per level-1 division as
// bubbles, counted by the geoportal's eventCountsByDivision so both surfaces
// agree. Needs the geo read model refreshed for the tenant (geo:refresh).

import { showByLevel } from "~/utils/deltaQuery";
import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { eventCountsByDivision } from "~/backend.server/models/geo/queries";
import {
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import { levelOneAreas } from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { EventMapPayload } from "~/utils/dashboard/eventMap";

async function computeGetEventMap(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	dimension: "disaster_event" | "hazardous_event",
): Promise<EventMapPayload> {
	const { notApplied } = impactFiltersFromQuery(query, ctx);
	const [counts, areas] = await Promise.all([
		eventCountsByDivision(ctx.countryAccountsId, {
			query: { ...query, dimension },
			level: showByLevel(query),
			audience: ctx.audience,
			notApplied: [],
		}),
		levelOneAreas(ctx.countryAccountsId, undefined, showByLevel(query)),
	]);
	return {
		dimension,
		areas: areas.ids
			.map((id) => {
				const c = counts.byDivision.get(id);
				return {
					divisionId: id,
					name: areas.names.get(id) as string,
					geojson: areas.shapeBy.get(id) ?? null,
					labelPoint: areas.points.get(id) ?? null,
					events: c?.events ?? 0,
					fromRecords: c?.fromRecords ?? 0,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name)),
		unplacedEvents: counts.unplacedEvents,
		unplacedReasons: counts.reasons,
		legend: {
			symbol: "Number of events",
			note: "An event in several provinces counts in each, so provinces do not add up.",
		},
		meta: {
			method:
				"Events per level-1 division from the geoportal's event placement (geo.event_atom): an event's own division link, or else the divisions of its member records; each event counted once per division",
			// eventCountsByDivision applies the place (division or region).
			notApplied: notApplied.filter(
				(n) =>
					n !== "disasterEvent" && n !== "hazardousEvent" && n !== "region",
			),
		},
	};
}

/** getEventMap, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience, query and dimension. */
export function getEventMap(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	dimension: "disaster_event" | "hazardous_event",
): Promise<EventMapPayload> {
	return cachedDashboard("getEventMap", [ctx, query, dimension], () =>
		computeGetEventMap(query, ctx, dimension),
	);
}
