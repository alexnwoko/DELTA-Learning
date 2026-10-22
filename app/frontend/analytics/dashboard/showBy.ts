// "Show by" on the Analysis page (Alex, 2026-10-22; Analytics 4a79f16c,
// Geoportal e81323b3): the admin level the division breakdowns and maps are
// computed at. At level 1 the titles read as before ("Ranked by
// divisions"); at levels 2 and 3 they name the area type, "Ranked by
// districts", so a reader always knows what a row is. The panels keep their
// own code; the level variant has a code of its own for translation.
import type { ViewContext } from "~/frontend/context";
import type { ShowByLevel } from "~/utils/deltaQuery";

type Msg = { code: string; msg: string };

/** Panel texts that name the division level, with their level 2 and 3 wording. */
export const LEVEL_TEXTS: Record<string, Record<2 | 3, string>> = {
	"dashboard.impact_7": { 2: "Ranked by districts", 3: "Ranked by local areas" },
	"dashboard.events_divisions": { 2: "Ranked by districts", 3: "Ranked by local areas" },
	"dashboard.sectors_divisions": { 2: "Ranked by districts", 3: "Ranked by local areas" },
	"dashboard.hazard_events_7": { 2: "Ranked by districts", 3: "Ranked by local areas" },
	"dashboard.map_events_note": {
		2: "An event in several districts counts in each, so districts do not add up.",
		3: "An event in several local areas counts in each, so local areas do not add up.",
	},
};

/** The translator with the level's wording; at level 1 the context itself. */
export function levelAwareContext(ctx: ViewContext, level: ShowByLevel): ViewContext {
	if (level === 1) return ctx;
	const t = ((m: Msg, r?: Record<string, unknown>) => {
		const text = LEVEL_TEXTS[m.code]?.[level];
		return text ? ctx.t({ code: `${m.code}.level${level}`, msg: text }, r) : ctx.t(m, r);
	}) as ViewContext["t"];
	return Object.assign(Object.create(Object.getPrototypeOf(ctx)) as ViewContext, ctx, { t });
}
