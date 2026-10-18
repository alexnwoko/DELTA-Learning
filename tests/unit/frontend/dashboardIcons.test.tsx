import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { DELTA_ICONS, DRAWN_FOR, HAZARD_ICONS, MEASURE_ICONS, OCHA_ICONS, TARGET_ICONS, iconUrl, panelIcon } from "~/frontend/charts/dashboardIcons";
import type { ViewContext } from "~/frontend/context";
import { IMPACT_PANELS_FIXTURE } from "~/utils/dashboard/impactPanels";
import { IMPACT_PANELS_5TO16_FIXTURE } from "~/utils/dashboard/impactPanels5to16";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const ROOT = process.cwd();
const icon = (n: string) => join(ROOT, "public", iconUrl(n as never));

describe("dashboard icons (Alex, 2026-10-18)", () => {
	it("every icon the mapping uses is a self-hosted, script-free SVG", () => {
		const used = new Set<string>([
			...Object.values(MEASURE_ICONS),
			...Object.values(TARGET_ICONS),
			...Object.values(HAZARD_ICONS),
			...Object.values(DRAWN_FOR),
		] as string[]);
		for (const n of [...used, ...OCHA_ICONS, ...DELTA_ICONS]) {
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

	it("covers every title OCHA lacks with a drawn icon, so none uses a stand-in", () => {
		expect(Object.keys(DRAWN_FOR)).toHaveLength(8);
		expect(panelIcon("events-15")).toBe("compare");
		expect(panelIcon("hazard-events-15")).toBe("duration");
		expect(panelIcon("hazard-events-16")).toBe("magnitude");
		expect(MEASURE_ICONS.evacuated).toBe("evacuated");
		expect(HAZARD_ICONS.chemical).toBe("chemical");
	});

	it("draws panel title icons 50% larger (27 px in a 48 px box) and in the dashboard blue", () => {
		const panels = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", { data: IMPACT_PANELS_5TO16_FIXTURE, country: "Angola" });
		const html = renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={false} />);
		expect(html).toMatch(/h-12 w-12[^>]*><span aria-hidden="true" data-icon="affected-population"[^>]*width:27px;height:27px;background-color:var\(--delta-data-icon\)/);
		expect(html).not.toMatch(/data-icon="[a-z-]+"[^>]*background-color:var\(--delta-(brand|data-hazard)/);
	});
});

describe("dashboard icon blue (data.icon)", () => {
	it.each(["neutral", "delta"])("reaches 3:1 on the %s surfaces (WCAG 1.4.11)", (brand) => {
		const lum = (hex: string) => {
			const [r, g, b] = [1, 3, 5]
				.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
				.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const ratio = (a: string, b: string) => {
			const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
			return (x + 0.05) / (y + 0.05);
		};
		const blue = JSON.parse(readFileSync(join(ROOT, "design-tokens/data/data.json"), "utf8")).data.icon.$value;
		const tokens = JSON.parse(readFileSync(join(ROOT, `design-tokens/brand/${brand}.json`), "utf8")).brand;
		for (const s of ["surface", "surface-subtle"]) expect(ratio(blue, tokens[s].$value), s).toBeGreaterThanOrEqual(3);
	});
});
