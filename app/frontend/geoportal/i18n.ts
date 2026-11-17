// Translation for the geoportal components. The page passes its ViewContext
// translator; tests and stories use plainT, which returns the English text.
// Every user-visible string carries a geoportal.* key (TR-090).
import type { GeoLabel } from "~/utils/geoMeasures";

export type GeoT = (
	label: GeoLabel,
	replacements?: Record<string, string | number> | null,
) => string;

export const plainT: GeoT = (label, replacements) => {
	let s = label.msg;
	for (const [k, v] of Object.entries(replacements ?? {})) {
		s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
	}
	return s;
};

/** Formats a number for the reader's locale. */
export const fmt = (n: number) => n.toLocaleString();

/** Boundary version line (TR-168, GP-6); says so when none is recorded. */
export function boundaryText(
	version: string | null | undefined,
	t: GeoT,
): string {
	return !version || version === "unknown"
		? t({
				code: "geoportal.legend.boundaries_unknown",
				msg: "Boundary version not recorded",
			})
		: t(
				{ code: "geoportal.legend.boundaries", msg: "Boundaries: {version}" },
				{ version },
			);
}
