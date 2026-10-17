// What the shared filter bar offers on each view of the Analysis dashboard
// (D1 brief v0.2, section 2; filter bar contract v0.1). Interim
// definitions written by Frontend; Analytics owns them and may replace
// them. Pure module, safe on server and client.
//
// - Hazardous events and Disaster events: HIPs type chips in their identity
//   colours (NFR-094), no measure select (counts of events).
// - Disaster impact: no chips. The panels show every human effect; the
//   measure select picks the one that ranks and maps (chosenMeasure). The
//   loaders do not filter by humanEffects, so effect chips would look like
//   filters that change nothing (Analytics, 2026-10-17).
// - Sectors: sector chips from the sectors in the payload.
import type { HazardTree } from "~/frontend/geoportal/GeoFilterBar";
import type { ChipSet } from "~/frontend/geoportal/filterBarState";
import { IMPACT_HEADLINE_MEASURES } from "~/utils/dashboard/impactPanels";
import { geoMeasureInfo, type GeoLabel } from "~/utils/geoMeasures";
import { hazardColourVar } from "~/utils/hazardIdentity";
import type { DashboardView } from "./views";

export type NestedHazardTree = {
	types: (HazardTree["types"][number] & {
		clusters: (HazardTree["clusters"][number] & { hazards: HazardTree["hazards"] })[];
	})[];
};

/**
 * getHazardTree nests clusters in types and hazards in clusters; the bar
 * reads three flat lists (HazardTree), so the tree is flattened here.
 */
export function flattenHazardTree(tree: NestedHazardTree): HazardTree {
	const node = (n: { id: string; name: string; recordCountSubtree: number | string }) => ({
		id: n.id,
		name: n.name,
		recordCountSubtree: Number(n.recordCountSubtree),
	});
	return {
		types: tree.types.map(node),
		clusters: tree.types.flatMap((ty) => (ty.clusters ?? []).map((c) => ({ ...node(c), typeId: ty.id }))),
		hazards: tree.types.flatMap((ty) =>
			(ty.clusters ?? []).flatMap((c) => (c.hazards ?? []).map((h) => ({ ...node(h), clusterId: c.id, code: h.code }))),
		),
	};
}

/** The sub-category buttons of a view. */
export function chipsFor(
	view: DashboardView,
	opts: { hazardTree: HazardTree | null; sectors?: { id: string; label: string }[] },
): ChipSet | null {
	if (view === "hazardous_event" || view === "disaster_event") {
		if (!opts.hazardTree?.types.length) return null;
		return {
			kind: "hip_type",
			options: opts.hazardTree.types.map((ty) => ({
				id: ty.id,
				label: ty.name,
				colorToken: hazardColourVar(ty.id),
				// The tree counts records, not events: no number on an event chip.
				count: null,
			})),
		};
	}
	if (view === "disaster_impact") return null;
	return opts.sectors?.length ? { kind: "sector", options: opts.sectors } : null;
}

/** The measure select of a view; null hides it. */
export function measuresFor(view: DashboardView): { id: string; label: GeoLabel }[] | null {
	if (view !== "disaster_impact") return null;
	return IMPACT_HEADLINE_MEASURES.map((m) => ({ id: m, label: geoMeasureInfo(m).label }));
}
