// Icons beside every data-point title on the Analysis dashboard (Alex,
// 2026-10-18). All come from the OCHA Humanitarian Icons v2.1 set
// (DELTA_Version_2/80_Frontend_and_Design_System/icons; "Source: OCHA"),
// self-hosted under public/assets/icons/ocha. A title whose concept has no
// OCHA icon uses a stand-in and is listed in MISSING_ICONS, so the gap is
// visible until a proper icon is chosen. Pure module.

/** The OCHA icon file names the dashboard uses (public/assets/icons/ocha/<name>.svg). */
export const OCHA_ICONS = [
	"about", "affected-population", "alert", "analysis", "calendar", "chart", "conflict", "damaged-affected",
	"data", "dead", "document", "earthquake", "environment", "epidemic", "financing", "flood", "gender",
	"health-facility-affected", "help", "house-affected", "house-destroyed", "infrastructure", "injured",
	"internally-displaced", "link", "location", "map", "menu", "missing", "monitoring", "multi-cluster-sector",
	"next-item", "notification", "observation-tower", "people-in-need", "power-outage", "report", "selected",
	"table", "technological-disaster", "top-ranking", "trending", "warning-error",
] as const;
export type OchaIcon = (typeof OCHA_ICONS)[number];

/**
 * Titles OCHA has no icon for: the stand-in shown today and what is
 * missing, so a proper icon can be sourced (FE-Inspiration-02, section 4).
 */
export const MISSING_ICONS: Record<string, { standIn: OchaIcon | null; needed: string }> = {
	"hazard:extraterrestrial": { standIn: null, needed: "Extraterrestrial hazard (meteor, space weather)" },
	"hazard:chemical": { standIn: null, needed: "Chemical hazard (flask or hazmat)" },
	"hazard:all": { standIn: null, needed: "All hazards (multi-hazard)" },
	"measure:evacuated": { standIn: "internally-displaced", needed: "Evacuated people (evacuation route)" },
	"measure:relocated": { standIn: "internally-displaced", needed: "Relocated people (relocation)" },
	"events-15": { standIn: "analysis", needed: "Compare events (side by side)" },
	"hazard-events-15": { standIn: "calendar", needed: "Duration (clock or stopwatch)" },
	"hazard-events-16": { standIn: "chart", needed: "Magnitude (gauge or intensity scale)" },
};

/** Panel and slot ids to their icon. */
const PANEL_ICONS: Record<string, OchaIcon> = {
	"impact-empty": "affected-population",
	"impact-1": "affected-population", "impact-2": "data", "impact-3": "trending", "impact-4": "top-ranking",
	"impact-5": "table", "impact-6": "analysis", "impact-7": "location", "impact-8": "multi-cluster-sector",
	"impact-9": "internally-displaced", "impact-10": "house-destroyed", "impact-11": "report",
	"impact-12": "monitoring", "impact-13": "calendar", "impact-14": "chart", "impact-15": "warning-error",
	"impact-16": "gender",
	"events-empty": "alert",
	"events-1": "alert", "events-2": "link", "events-3": "top-ranking", "events-4": "calendar",
	"events-5": "analysis", "events-6": "document", "events-7": "warning-error", "events-8": "notification",
	"events-9": "link", "events-10": "selected", "events-11": "table", "events-12": "monitoring",
	"events-13": "location", "events-14": "alert", "events-15": "analysis", "events-16": "multi-cluster-sector",
	"hazard-events-empty": "alert",
	"hazard-events-1": "alert", "hazard-events-2": "observation-tower", "hazard-events-3": "calendar",
	"hazard-events-4": "calendar", "hazard-events-5": "top-ranking", "hazard-events-6": "data",
	"hazard-events-7": "location", "hazard-events-8": "map", "hazard-events-9": "next-item",
	"hazard-events-10": "link", "hazard-events-11": "table", "hazard-events-12": "monitoring",
	"hazard-events-13": "menu", "hazard-events-14": "trending", "hazard-events-15": "calendar",
	"hazard-events-16": "chart",
	"sectors-empty": "multi-cluster-sector",
	"sectors-1": "multi-cluster-sector", "sectors-2": "multi-cluster-sector", "sectors-3": "damaged-affected",
	"sectors-4": "analysis", "sectors-5": "calendar", "sectors-6": "house-destroyed", "sectors-7": "infrastructure",
	"sfm-s0": "table", "sfm-a1": "dead", "sfm-a2": "missing", "sfm-b1": "injured", "sfm-b2": "house-affected",
	"sfm-c1": "financing", "sfm-c2": "multi-cluster-sector", "sfm-d1": "health-facility-affected",
	"sfm-d2": "power-outage",
};

/** The icon of a panel or slot; a generic chart icon for an id not mapped yet. */
export function panelIcon(id: string): OchaIcon {
	return PANEL_ICONS[id] ?? "chart";
}

/** Measures shown as tiles and legends. */
export const MEASURE_ICONS: Record<string, OchaIcon> = {
	deaths: "dead",
	missing: "missing",
	injured: "injured",
	affected_direct: "affected-population",
	affected_indirect: "people-in-need",
	displaced: "internally-displaced",
	evacuated: "internally-displaced",
	relocated: "internally-displaced",
	houses_destroyed: "house-destroyed",
	houses_damaged: "house-affected",
	money: "financing",
	records: "document",
};

/** Sendai target headings. */
export const TARGET_ICONS: Record<"A" | "B" | "C" | "D", OchaIcon> = {
	A: "dead",
	B: "affected-population",
	C: "financing",
	D: "infrastructure",
};

/** HIPs hazard types on the rail; null where OCHA has none (the rail keeps its own glyph). */
export const HAZARD_ICONS: Record<string, OchaIcon | null> = {
	meteorologicalHydrological: "flood",
	geological: "earthquake",
	biological: "epidemic",
	environmental: "environment",
	technological: "technological-disaster",
	societal: "conflict",
	chemical: null,
	extraterrestrial: null,
	unclassified: "help",
};

/** Section headings outside panels. */
export const SECTION_ICONS = { sendai: "monitoring", about: "about", map: "map" } as const satisfies Record<string, OchaIcon>;
