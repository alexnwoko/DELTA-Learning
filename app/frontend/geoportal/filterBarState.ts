// Pure state rules of the shared filter bar (contract
// 70_Geospatial_and_Geoportal/Geoportal_Build_Spec/DELTA_Filter_Bar_Props_Contract.md,
// agreed by Analytics 2026-10-17). The bar reads a DeltaQuery and returns a
// new one; the page owns the URL. Kept apart from the component so every rule
// is unit-tested without a browser.
import type { DeltaQuery, QueryHumanEffect } from "~/utils/deltaQuery";
import type { GeoLabel } from "~/utils/geoMeasures";
import type { GeoT } from "~/frontend/geoportal/i18n";

export type ChipSet =
	| {
			kind: "hip_type";
			options: {
				id: string;
				label: string;
				/** Hazard identity colour (NFR-094): a CSS colour or var(), never a series ramp. */
				colorToken: string;
				/** null: not computed or not reported; shows no number, never 0. */
				count: number | null;
			}[];
	  }
	| { kind: "effect"; options: { id: QueryHumanEffect; label: GeoLabel }[] }
	| { kind: "sector"; options: { id: string; label: string }[] };

export interface PlaceOptions {
	divisions?: {
		id: string;
		name: string;
		level: number;
		parentId: string | null;
	}[];
	regions?: {
		regionId: string;
		name: string;
		kind: "planning" | "reference";
	}[];
}

export type LockedFilters = Partial<Pick<DeltaQuery, "dimension">> & {
	where?: Partial<DeltaQuery["where"]>;
};

/** Removes empty values so they are never written as empty strings. */
function cleanWhere(where: DeltaQuery["where"]): DeltaQuery["where"] {
	const w = { ...where };
	if (!w.humanEffects?.length) delete w.humanEffects;
	if (!w.sectors?.length) delete w.sectors;
	if (!w.hazard?.typeId && !w.hazard?.clusterId && !w.hazard?.hazardId) {
		delete w.hazard;
	}
	return w;
}

/** Which chips are on for the current query. */
export function selectedChips(query: DeltaQuery, chips: ChipSet): string[] {
	switch (chips.kind) {
		case "hip_type":
			return query.where.hazard?.typeId ? [query.where.hazard.typeId] : [];
		case "effect":
			return [...(query.where.humanEffects ?? [])];
		case "sector":
			return [...(query.where.sectors ?? [])];
	}
}

/**
 * Applies a chip selection. HIPs type is one at a time and clears cluster and
 * hazard; effects and sectors are several, and an empty set means all.
 */
export function applyChips(
	query: DeltaQuery,
	chips: ChipSet,
	selected: string[],
): DeltaQuery {
	const where = { ...query.where };
	if (chips.kind === "hip_type") {
		const typeId = selected[selected.length - 1];
		where.hazard = typeId ? { typeId } : undefined;
	} else if (chips.kind === "effect") {
		const allowed = new Set(chips.options.map((o) => o.id as string));
		where.humanEffects = chips.options
			.map((o) => o.id)
			.filter((id) => selected.includes(id) && allowed.has(id));
	} else {
		where.sectors = chips.options
			.map((o) => o.id)
			.filter((id) => selected.includes(id));
	}
	return { ...query, where: cleanWhere(where) };
}

export const PLACE_ALL = "all";

/** Key of the Area control: "all", "d:<divisionId>" or "r:<regionId>". */
export function placeKey(query: DeltaQuery): string {
	if (query.where.region) return `r:${query.where.region.regionId}`;
	if (query.where.geo?.divisionId) return `d:${query.where.geo.divisionId}`;
	return PLACE_ALL;
}

/**
 * One place facet at a time: a division deletes the region and a region
 * deletes the division, so nothing sends both (REGION_AND_DIVISION). Map
 * clicks (D1 map M0) call this too; null means all areas.
 */
export function withPlace(
	query: DeltaQuery,
	place: { divisionId: string } | { regionId: string } | null,
): DeltaQuery {
	const where = { ...query.where };
	delete where.geo;
	delete where.region;
	if (place && "divisionId" in place) {
		where.geo = { divisionId: place.divisionId };
	} else if (place && "regionId" in place) {
		where.region = { regionId: place.regionId };
	}
	return { ...query, where };
}

/** The Area control's key ("all", "d:<id>", "r:<id>") applied through withPlace. */
export function applyPlace(query: DeltaQuery, key: string): DeltaQuery {
	if (key.startsWith("d:"))
		return withPlace(query, { divisionId: key.slice(2) });
	if (key.startsWith("r:")) return withPlace(query, { regionId: key.slice(2) });
	return withPlace(query, null);
}

export interface PeriodPreset {
	id: string;
	/** Span in years; 0 is "All years". */
	years: number;
	from: string;
	to: string;
}

/** "All years" then "Last N years", counted back from thisYear inclusive. */
export function periodPresets(
	spans: readonly number[],
	thisYear: number,
): PeriodPreset[] {
	return [
		{ id: "all", years: 0, from: "", to: "" },
		...spans.map((n) => ({
			id: String(n),
			years: n,
			from: String(thisYear - n + 1),
			to: String(thisYear),
		})),
	];
}

/** Each locked facet, for the read-only chips. */
export function lockedFacets(locked: LockedFilters | undefined): string[] {
	if (!locked) return [];
	const out: string[] = [];
	if (locked.dimension) out.push("dimension");
	const w = locked.where ?? {};
	if (w.geo || w.region) out.push("place");
	if (w.hazard) out.push("hazard");
	if (w.time) out.push("period");
	if (w.humanEffects) out.push("effect");
	if (w.sectors) out.push("sector");
	if (w.disasterEventId) out.push("disasterEvent");
	if (w.hazardousEventId) out.push("hazardousEvent");
	return out;
}

/** The period as the summary line states it: actual years, never "last N". */
export function periodText(query: DeltaQuery): { from?: string; to?: string } {
	const t = query.where.time;
	return {
		...(t?.from && { from: t.from.slice(0, 4) }),
		...(t?.to && { to: t.to.slice(0, 4) }),
	};
}

export interface SummaryLabels {
	/** The instance, e.g. "Angola". */
	scopeLabel?: string;
	/** Names for the HIPs ids in the query. */
	hazardTree?: {
		types: { id: string; name: string }[];
		clusters: { id: string; name: string }[];
		hazards: { id: string; name: string }[];
	} | null;
}

/**
 * The one-line scope and basis ("Angola · 2015 to 2024 · Hazard: all ·
 * Basis: published"). The period states the actual years, never "last N"
 * (Analytics, 2026-10-17). Shared by the geoportal bar and the D1 page.
 */
export function querySummary(
	query: DeltaQuery,
	labels: SummaryLabels,
	t: GeoT,
): string {
	const p = periodText(query);
	const period =
		p.from && p.to
			? t({ code: "geoportal.summary.period", msg: "{from} to {to}" }, p)
			: p.from
				? t({ code: "geoportal.summary.from", msg: "from {from}" }, p)
				: p.to
					? t({ code: "geoportal.summary.to", msg: "up to {to}" }, p)
					: t({ code: "geoportal.when.all", msg: "All years" });
	const h = query.where.hazard;
	const tree = labels.hazardTree;
	const hazardName =
		(h?.hazardId && tree?.hazards.find((x) => x.id === h.hazardId)?.name) ||
		(h?.clusterId && tree?.clusters.find((x) => x.id === h.clusterId)?.name) ||
		(h?.typeId && tree?.types.find((x) => x.id === h.typeId)?.name) ||
		(h
			? t({ code: "geoportal.summary.hazard_selected", msg: "selected" })
			: t({ code: "geoportal.summary.hazard_all", msg: "all" }));
	const basis =
		query.scope.basis === "provisional"
			? t({ code: "geoportal.summary.basis_provisional", msg: "provisional" })
			: t({ code: "geoportal.summary.basis_published", msg: "published" });
	return [
		labels.scopeLabel,
		period,
		t(
			{ code: "geoportal.summary.hazard", msg: "Hazard: {name}" },
			{ name: hazardName },
		),
		t({ code: "geoportal.summary.basis", msg: "Basis: {basis}" }, { basis }),
	]
		.filter(Boolean)
		.join(" · ");
}
