// Hazard by month (Alex, 2026-10-19): clusters by calendar month, years
// pooled, switching between occurrences and people affected; rare severe
// months ringed; blank months never read as 0.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hazardMonthExport, hazardMonthPanel } from "~/frontend/analytics/dashboard/panels/hazardMonth";
import type { ViewContext } from "~/frontend/context";
import type { HazardMonth } from "~/utils/dashboard/hazardMonth";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const people = (value: number | null, state: PanelCell["valueState"]): PanelCell =>
	({ value, valueState: state, recordsReported: 1, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: 1, recordsFlagged: 0 }) as PanelCell;
const cells = (over: Record<number, { count: number; people: PanelCell; rare?: boolean }>) =>
	Array.from({ length: 12 }, (_, i) => {
		const o = over[i + 1];
		return { month: i + 1, count: o?.count ?? 0, people: o?.people ?? people(null, "not_reported"), rare: o?.rare ?? false };
	});
const D: HazardMonth = {
	unit: "disaster_record",
	measure: "affected_direct" as never,
	rows: [
		{ hipClusterId: "c1", label: "Flood", hipTypeId: "t1", total: 40, cells: cells({ 2: { count: 30, people: people(5000, "reported") }, 3: { count: 10, people: people(null, "not_reported") } }) },
		{ hipClusterId: "c2", label: "Tropical cyclone", hipTypeId: "t1", total: 1, cells: cells({ 1: { count: 1, people: people(90000, "reported"), rare: true } }) },
	],
	withoutMonth: 5,
	placeholderDates: 72,
	years: { from: 1990, to: 2024 },
	meta: { method: "Rare: at most 2 occurrences and 5 times the median.", notApplied: [] },
};
const common = { source: "DELTA Angola", scope: "Angola", provisional: false };

describe("Hazard by month", () => {
	const panel = hazardMonthPanel(ctx, D, "impact-hazard-month", 28, common);
	const html = renderToString(<>{panel.render!()}</>).replace(/<!-- -->/g, "");

	it("opens on occurrences, with a two-way switch to people", () => {
		expect(html).toContain("Number of records");
		expect(html).toMatch(/aria-checked="true"/);
		expect(html).toContain(">30</td>");
	});

	it("rings a rare severe month and says so for screen readers", () => {
		expect(html).toContain("outline:2px solid");
		expect(html).toContain("rare and severe");
	});

	it("leaves months with none blank, never 0", () => {
		expect(html).not.toContain(">0</td>");
	});

	it("sorts clusters by total, largest first", () => {
		expect(html.indexOf("Flood")).toBeLessThan(html.indexOf("Tropical cyclone"));
	});

	it("exports both counts for every month, with the placeholder dates counted in the notes", () => {
		const exp = hazardMonthExport(ctx, D);
		// Only months with occurrences: Flood Feb and Mar, Tropical cyclone Jan, each with both counts.
		expect(exp.rows).toHaveLength(3 * 2);
		expect(exp.notes).toContain("72 sit on a placeholder date and are left out, not counted in any month.");
		expect(exp.notes).toContain("5 have no start month and are left out.");
		expect(exp.notes).toContain("1990 to 2024, all years together.");
		expect(exp.rows.find((r) => r.label === "Flood, Mar" && r.series !== "Records")!.valueState).toBe("not_reported");
	});
});
