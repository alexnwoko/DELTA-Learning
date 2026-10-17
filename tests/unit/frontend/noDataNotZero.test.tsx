// Alex, 2026-10-17: "no data should be equal to zero" means no data is never shown as 0.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { coverageText } from "~/frontend/analytics/dashboard/panelCell";
import { eventContextNotes, eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { sectorDashboardPanels } from "~/frontend/analytics/dashboard/panels/sectors/sectorPanels";
import type { ViewContext } from "~/frontend/context";
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import { IMPACT_PANELS_FIXTURE, type PanelCell } from "~/utils/dashboard/impactPanels";
import type { SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const empty: PanelCell = { value: null, valueState: "not_reported", recordsReported: 0, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: 0, recordsFlagged: 0 };
const grid = (panels: ReturnType<typeof eventDashboardPanels>) => text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />));

describe("no data is never shown as 0", () => {
	it("coverage with no record in scope says so, never '0 of 0'", () => {
		expect(coverageText(ctx, empty)).toBe("No records in scope");
	});

	it("Disaster events with nothing in scope: one frame with the reason, no tiles", () => {
		const panels = eventDashboardPanels(ctx, { empty: { reason: "No disaster events in scope for these filters." } } as unknown as EventPanels1to7, {
			source: "DELTA Angola", scope: "Angola", provisional: false,
		});
		expect(panels).toHaveLength(1);
		const html = grid(panels);
		expect(html).toContain("No disaster events in scope for these filters.");
		expect(html).not.toMatch(/>0</);
		expect(html).not.toContain("()");
	});

	it("the ungrouped-records note has no share to state with no record in scope", () => {
		const d = { headline: { byRule: { glide: 0, serial: 0, entered: 0 } }, linkage: { notLinked: 0, recordsInScope: 0 } } as unknown as EventPanels1to7;
		expect(eventContextNotes(ctx.t, d)[1]).toBe("No records in scope");
	});

	it("Sectors with nothing in scope: one frame with the reason", () => {
		const panels = sectorDashboardPanels(ctx, { empty: { reason: "No records in scope for these filters." } } as unknown as SectorPanels1to7, {
			source: "DELTA Angola", scope: "Angola", provisional: false, country: "Angola",
		});
		expect(panels).toHaveLength(1);
		expect(grid(panels)).toContain("No records in scope for these filters.");
	});

	it("Disaster impact with no record in scope: one frame, not tiles of 'No data' and '0 of 0'", () => {
		const none = { ...IMPACT_PANELS_FIXTURE, coverage: { ...IMPACT_PANELS_FIXTURE.coverage, recordsReported: 0, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsFlagged: 0, recordsTotal: 0 } };
		const panels = impactDashboardPanels(ctx, none, "DELTA Angola");
		expect(panels.map((p) => p.id)).toEqual(["impact-empty"]);
		expect(grid(panels)).toContain("No records in scope for these filters.");
	});

	it("a missing figure exports as a blank cell with its state, never 0", async () => {
		const { chartCsv } = await import("~/frontend/charts/chartExport");
		const csv = chartCsv([{ label: "Floods", value: null, valueState: "not_reported" }], { title: "x", source: "s", basis: "published", generatedAt: new Date("2026-10-17T00:00:00Z") });
		expect(csv).toContain("\r\nFloods,,,not_reported,");
	});
});
