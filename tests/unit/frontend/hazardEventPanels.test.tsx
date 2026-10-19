import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { hazardEventDashboardPanels, visibleOngoing, yearSpan } from "~/frontend/analytics/dashboard/panels/hazards/hazardEventPanels";
import type { ViewContext } from "~/frontend/context";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const opts = { source: "DELTA Testland", scope: "Testland", provisional: false };
// Shaped like the loader's answer (d9cfce9d); figures invented for the test.
const D: HazardEventPanels1to7 = {
	empty: null,
	headline: { events: 40, ongoingOrForecasted: 3, linkedToDisasterEvent: 12, withFootprint: 5, codedAtHazardLevel: 30 },
	ongoing: { rows: [
		{ eventId: "h1", hazardLabel: "Riverine flood", status: "ongoing", startDate: "2026-10-01", divisions: 2, dataSource: "NMHS", lastUpdate: null },
		{ eventId: "h2", hazardLabel: "Tropical cyclone", status: "forecasted", startDate: null, divisions: 1, dataSource: null, lastUpdate: null },
	] },
	byYear: { years: [{ year: 2023, events: 10 }, { year: 2025, events: 12 }], eventsWithoutYear: 1 },
	season: { cells: [{ year: 2025, month: 3, events: 4 }], eventsWithoutMonth: 6 },
	byHazard: { rows: [{ hipTypeId: "1042", label: "Meteorological and Hydrological", events: 30 }, { hipTypeId: "none", label: "Hazard not coded", events: 10 }] },
	depth: { rows: [{ hipTypeId: "1042", label: "Meteorological and Hydrological", typeOnly: 5, cluster: 10, specificHazard: 15 }] },
	divisions: { rows: [{ divisionId: "d1", name: "Luanda", events: 9 }], divisionsWithoutEvents: 17, multiDivisionEvents: 4 },
	meta: { method: "Count of hazardous events", notApplied: [] },
};

describe("Hazardous events, G-01", () => {
	const empty: HazardEventPanels1to7 = {
		...D,
		empty: { code: "G-01", reason: "No hazardous events recorded. Migrated data holds none; only events entered in DELTA appear here." },
	};
	it("shows the reason across the view, then all 16 panels as grey placeholders with no figures", () => {
		const panels = hazardEventDashboardPanels(ctx, empty, { ...opts, signedIn: true });
		// The notice first, then the placeholders in the agreed layout (FE-Proposal-02); the rest under Show more.
		expect(panels.map((p) => p.n)).toEqual([0, 1, 7, 5, 3, 8, 9, 2, 4, 6, 12, 10, 11, 13, 14, 15, 16]);
		expect(panels[0]).toMatchObject({ wide: true, gap: { code: "G-01" } });
		expect(panels.slice(1).every((p) => p.gap?.ghost && !p.render && !p.exportData)).toBe(true);
		const raw = renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />);
		const html = text(raw);
		expect(html).toContain("No hazardous events recorded. Migrated data holds none");
		expect(html).toContain("(G-01)");
		expect(html).toContain("needs hazardous-event records");
		expect(raw.match(/data-panel-state="ghost"/g)).toHaveLength(16);
		expect(raw).toContain('aria-hidden="true"');
		expect(html).not.toContain("Not yet available");
		// Placeholders carry no figure: no digit in their text, no count.
		for (const p of panels.slice(1)) {
			expect(p.title + p.gap!.text).not.toMatch(/\d/);
			expect(p.gap!.count).toBeUndefined();
		}
	});
});

describe("Hazardous events panels 1 to 7", () => {
	const panels = hazardEventDashboardPanels(ctx, D, { ...opts, signedIn: false });
	const html = (n: number) => text(renderToString(<>{panels.find((p) => p.n === n)!.render!()}</>));

	it("draw 1 to 7; 8 to 15 being built and 16 held at G-19", () => {
		expect(panels.filter((p) => p.render).map((p) => p.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(panels.find((p) => p.n === 16)!.gap!.code).toBe("G-19");
	});

	it("1: shares read as n of the events in scope", () => {
		expect(html(1)).toContain("12 of 40 hazardous events");
	});

	it("2: says 'Recorded status', never 'warning', and hides forecasted rows from the public", () => {
		expect(visibleOngoing(D, false).map((r) => r.eventId)).toEqual(["h1"]);
		expect(visibleOngoing(D, true).map((r) => r.eventId)).toEqual(["h1", "h2"]);
		const h = html(2);
		expect(h).toContain("Recorded status");
		expect(h).toContain("Recorded as ongoing");
		expect(h).not.toContain("Tropical cyclone");
		expect(h).not.toMatch(/>\s*Warning/i);
		expect(panels.find((p) => p.n === 2)!.exportData!.notes).toContain("DELTA Resilience issues no warnings.");
		const signedIn = hazardEventDashboardPanels(ctx, D, { ...opts, signedIn: true });
		expect(text(renderToString(<>{signedIn.find((p) => p.n === 2)!.render!()}</>))).toContain("Recorded as forecasted (recorded status, not a forecast)");
	});

	it("3: a year with no event is a gap", () => {
		const years = yearSpan(D.byYear.years);
		expect(years.map((y) => y.year)).toEqual([2023, 2024, 2025]);
		expect(years[1].cell.valueState).toBe("not_reported");
		expect(html(3)).toContain("2024: No events recorded");
	});

	it("4 and 7: count what they leave out, never as zero bars", () => {
		expect(panels.find((p) => p.n === 4)!.exportData!.notes).toContain("6 hazardous events have no month and are left out.");
		expect(panels.find((p) => p.n === 7)!.exportData!.notes).toContain("17 divisions: no events recorded.");
		expect(panels.find((p) => p.n === 7)!.exportData!.notes).toContain("4 hazardous events touch several divisions and count in each.");
		expect(html(7)).not.toContain(">0<");
	});

	it("5: keeps 'Hazard not coded' as its own row", () => {
		expect(html(5)).toContain("Hazard not coded");
	});
});

describe("Hazardous events layout (FE-Proposal-02, Alex 2026-10-18)", () => {
	it("follows the agreed rows, the rest under Show more", () => {
		const laid = hazardEventDashboardPanels(ctx, D, { ...opts, signedIn: true });
		expect(laid.filter((p) => !p.more).map((p) => p.id)).toEqual([
			"hazard-events-1", "hazard-events-7", "hazard-events-5", "hazard-events-3", "hazard-events-8",
			"hazard-events-9", "hazard-events-2", "hazard-events-4", "hazard-events-6", "hazard-events-12",
		]);
		expect(laid.find((p) => p.id === "hazard-events-7")!.title).toBe("Ranked by divisions");
	});
});

describe("placeholder description (Alex, 2026-10-19)", () => {
	it("is small print on a grey placeholder, and normal size on a plain gap", async () => {
		const { PanelGrid } = await import("~/frontend/analytics/dashboard/PanelGrid");
		const panels = [
			{ id: "hazard-events-3", n: 3, title: "Ghost", gap: { text: "What it will show.", ghost: "columns" as const } },
			{ id: "hazard-events-11", n: 11, title: "Gap", gap: { text: "Being built." } },
		];
		const html = renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={false} />);
		expect(html).toMatch(/<p class="m-0 text-xs text-brand-text-muted">What it will show\./);
		expect(html).toMatch(/<p class="m-0 text-sm text-brand-text-muted">Being built\./);
	});
});
