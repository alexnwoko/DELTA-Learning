import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { HAZARD_ICONS, MEASURE_ICONS, MISSING_ICONS, OCHA_ICONS, TARGET_ICONS, panelIcon } from "~/frontend/charts/dashboardIcons";
import type { ViewContext } from "~/frontend/context";
import { IMPACT_PANELS_FIXTURE } from "~/utils/dashboard/impactPanels";
import { IMPACT_PANELS_5TO16_FIXTURE } from "~/utils/dashboard/impactPanels5to16";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const ROOT = process.cwd();
const icon = (n: string) => join(ROOT, "public/assets/icons/ocha", `${n}.svg`);

describe("dashboard icons (Alex, 2026-10-18)", () => {
	it("every icon the mapping uses is a self-hosted, script-free SVG", () => {
		const used = new Set<string>([
			...Object.values(MEASURE_ICONS),
			...Object.values(TARGET_ICONS),
			...Object.values(HAZARD_ICONS).filter(Boolean),
			...Object.values(MISSING_ICONS).map((m) => m.standIn).filter(Boolean),
		] as string[]);
		for (const n of [...used, ...OCHA_ICONS]) {
			expect(existsSync(icon(n)), n).toBe(true);
			const svg = readFileSync(icon(n), "utf8");
			expect(svg.startsWith("<svg") || svg.trimStart().startsWith("<svg"), n).toBe(true);
			expect(svg, n).not.toMatch(/<script|onload|param\(/);
		}
	});

	it("gives every Disaster impact panel an icon left of its title", () => {
		const panels = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", { data: IMPACT_PANELS_5TO16_FIXTURE, country: "Angola" });
		const html = renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={false} />);
		for (const p of panels) expect(html, p.id).toContain(`data-icon="${panelIcon(p.id)}"`);
		// The icon sits inside the title heading, before the words.
		expect(html).toMatch(/<h3[^>]*><span[^>]*><span aria-hidden="true" data-icon="affected-population"/);
	});

	it("shows icons in the not-yet-available strip too", () => {
		const panels = eventDashboardPanels(ctx, { empty: { reason: "x" } } as never, { source: "s", scope: "s", provisional: false });
		const html = renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />);
		expect(html).toContain('data-icon="alert"');
	});

	it("lists every title OCHA has no icon for, with what is needed", () => {
		expect(Object.keys(MISSING_ICONS).length).toBeGreaterThan(0);
		for (const [k, m] of Object.entries(MISSING_ICONS)) expect(m.needed.length, k).toBeGreaterThan(3);
	});
});
