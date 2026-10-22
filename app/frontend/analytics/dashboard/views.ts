// The four views of the Analysis dashboard (Alex, 2026-10-17): one page,
// four buttons, always visible, in his order. Three are the DELTA
// dimensions of delta.query/1 (`dim`); Sectors is a page view (`view`),
// read from disaster records by sector, as `level` is a geo view parameter.
// Pure module: the URL is read and written here and nowhere else.
import { withPlace } from "~/frontend/geoportal/filterBarState";
import { parseDeltaQuery, serializeDeltaQuery, type DeltaQuery, type QueryDimension } from "~/utils/deltaQuery";

export type DashboardView = "sectors" | QueryDimension;

/** Alex's order: Sectors, Hazardous events, Disaster events, Disaster impact. */
export const DASHBOARD_VIEWS: readonly DashboardView[] = [
	"sectors",
	"hazardous_event",
	"disaster_event",
	"disaster_impact",
];

const VIEW_PARAM = "view";

/** The view a URL asks for; a dimension unless `view=sectors`. */
export function viewFromSearch(params: URLSearchParams, query: DeltaQuery): DashboardView {
	return params.get(VIEW_PARAM) === "sectors" ? "sectors" : query.dimension;
}

/**
 * The URL for a view, keeping every filter. Sectors reads disaster
 * records, so its query keeps the Disaster impact dimension underneath.
 */
export function searchForView(query: DeltaQuery, view: DashboardView): URLSearchParams {
	if (view === "sectors") {
		const params = serializeDeltaQuery({ ...query, dimension: "disaster_impact" });
		params.set(VIEW_PARAM, "sectors");
		return params;
	}
	return serializeDeltaQuery({ ...query, dimension: view });
}

const LEGACY: Record<string, DashboardView> = {
	sectors: "sectors",
	// The hazards page analysed impact by hazard: its figures are Disaster impact.
	hazards: "disaster_impact",
	"disaster-events": "disaster_event",
};

/**
 * Where an old analysis page now lives, keeping the filters its link
 * carried (hazard, period, place). null for a path that is not one of them.
 */
export function legacyAnalyticsTarget(page: string, params: URLSearchParams): string | null {
	const view = LEGACY[page];
	if (!view) return null;
	const { query } = parseDeltaQuery(params);
	const search = searchForView(query, view).toString();
	return search ? `/analytics?${search}` : "/analytics";
}

/**
 * A map click on a division: it becomes the place filter for the whole
 * page (one place facet at a time, so any region is cleared); clicking the
 * division already selected clears it.
 */
export function toggleDivision(query: DeltaQuery, divisionId: string): DeltaQuery {
	return withPlace(query, query.where.geo?.divisionId === divisionId ? null : { divisionId });
}

/** The Sendai Framework Monitoring toggle: a page parameter, outside delta.query/1 (FR-AN-021). */
export const SFM_PARAM = "sfm";

/**
 * Views that carry the Sendai Framework Monitoring section and its toggle:
 * Disaster events and Disaster impact only, not Hazardous events or Sectors
 * (Alex, 2026-10-18; FR-AN-020, FR-AN-024).
 */
export const SENDAI_VIEWS: readonly DashboardView[] = ["disaster_event", "disaster_impact"];

export function hasSendai(view: DashboardView): boolean {
	return SENDAI_VIEWS.includes(view);
}

export function sfmFromSearch(params: URLSearchParams): boolean {
	return params.get(SFM_PARAM) === "1";
}

/** A view's URL with the Sendai toggle kept as it is; dropped on a view without the section. */
export function searchFor(query: DeltaQuery, view: DashboardView, sfm: boolean): URLSearchParams {
	const params = searchForView(query, view);
	if (sfm && hasSendai(view)) params.set(SFM_PARAM, "1");
	return params;
}
