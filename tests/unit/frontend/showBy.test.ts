// "Show by" on the Analysis page (Alex, 2026-10-22; Analytics 4a79f16c):
// titles that name the division level follow the chosen level, and the
// level travels in the URL.
import { describe, expect, it } from "vitest";
import { searchFor } from "~/frontend/analytics/dashboard/views";
import { LEVEL_TEXTS, levelAwareContext } from "~/frontend/analytics/dashboard/showBy";
import type { ViewContext } from "~/frontend/context";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;

describe("Show by", () => {
	it("keeps level 1 wording and the same context", () => {
		expect(levelAwareContext(ctx, 1)).toBe(ctx);
	});

	it("names districts and local areas in the division titles", () => {
		const d = levelAwareContext(ctx, 2);
		expect(d.t({ code: "dashboard.impact_7", msg: "Ranked by divisions" })).toBe("Ranked by districts");
		expect(levelAwareContext(ctx, 3).t({ code: "dashboard.events_divisions", msg: "Ranked by divisions" })).toBe("Ranked by local areas");
		expect(d.t({ code: "dashboard.map_events_note", msg: "provinces" })).toContain("districts");
		// Other texts pass through, and the context keeps its language.
		expect(d.t({ code: "dashboard.impact_4", msg: "Hazard ranking by disaster impact" })).toBe("Hazard ranking by disaster impact");
		expect(d.lang).toBe("en");
	});

	it("covers every Ranked by divisions title", () => {
		expect(Object.keys(LEVEL_TEXTS)).toEqual(expect.arrayContaining(["dashboard.impact_7", "dashboard.events_divisions", "dashboard.sectors_divisions", "dashboard.hazard_events_7"]));
	});

	it("carries the level in the URL and back", () => {
		const q = { ...parseDeltaQuery(new URLSearchParams("from=2015")).query, showBy: 2 as const };
		const params = searchFor(q, "disaster_impact", false);
		expect(params.get("level")).toBe("2");
		expect(parseDeltaQuery(params).query.showBy).toBe(2);
	});
});
