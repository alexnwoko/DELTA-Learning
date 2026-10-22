// Hazard identity colours (NFR-094). A HIPs hazard type keeps one colour on
// every chip, glyph and legend; it is never a series colour from a data
// ramp. Colours come from the data.hazard tokens (design-tokens/data).
// Pure module, safe for server and client code.
import { dataTokens } from "~/utils/designTokens.generated";

export type HazardIdentity = keyof typeof dataTokens.hazard;

/** hip_class ids of the HIPs 2025 types (migration 20251216090451). */
export const HIP_TYPE_IDENTITY: Readonly<Record<string, HazardIdentity>> = {
	"1037": "biological",
	"1038": "chemical",
	"1039": "environmental",
	"1040": "extraterrestrial",
	"1041": "geological",
	"1042": "meteorologicalHydrological",
	"1043": "societal",
	"1044": "technological",
};

/** The identity of a HIPs type id; an unknown or missing id is "unclassified". */
export function hazardIdentity(typeId: string | null | undefined): HazardIdentity {
	return (typeId && HIP_TYPE_IDENTITY[typeId]) || "unclassified";
}

/** The colour value, for SVG and canvas drawing (charts, OpenLayers). */
export function hazardColour(typeId: string | null | undefined): string {
	return dataTokens.hazard[hazardIdentity(typeId)];
}

/**
 * The CSS custom property, for styled components such as filter chips, so a
 * token rebuild restyles them without a code change.
 */
export function hazardColourVar(typeId: string | null | undefined): string {
	const kebab = hazardIdentity(typeId).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
	return `var(--delta-data-hazard-${kebab})`;
}
