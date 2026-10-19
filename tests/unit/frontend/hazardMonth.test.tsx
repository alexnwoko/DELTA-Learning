// Hazard by month heatmap (Alex, 2026-10-19): specific hazards under their
// cluster, 12 months plus "Month unknown", a row total, sort by the switch,
// rare months ringed, blank months never 0, source default days named.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hazardMonthExport, hazardMonthPanel, orderRows, TOP_ROWS } from "~/frontend/analytics/dashboard/panels/hazardMonth";
import type { ViewContext } from "~/frontend/context";
import type { HazardMonth, HazardMonthRow } from "~/utils/dashboard/hazardMonth";
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
const row = (key: string, label: string, cluster: string, all: number, p: number | null, over: Parameters<typeof cells>[0], unplaced = { placeholder: 0, noMonth: 0 }): HazardMonthRow => ({
	key, level: "hazard", label, hipHazardId: key, hipClusterId: cluster, clusterLabel: cluster, hipTypeId: "t1",
	total: all - unplaced.placeholder - unplaced.noMonth, allOccurrences: all,
	people: p === null ? people(null, "not_reported") : people(p, "reported"), unplaced, cells: cells(over),
});
const D: HazardMonth = {
	unit: "disaster_record",
	measure: "affected_direct" as never,
	rows: [
		row("fl", "Flooding", "Water-related", 40, 5000, { 7: { count: 30, people: people(5000, "reported") }, 8: { count: 10, people: people(null, "not_reported") } }),
		row("dr", "Drought", "Precipitation-related", 4269, 5950000, { 3: { count: 965, people: people(5950000, "reported") } }, { placeholder: 3304, noMonth: 0 }),
		row("tc", "Tropical cyclone", "Wind-related", 1, 90000, { 1: { count: 1, people: people(90000, "reported"), rare: true } }),
	],
	withoutMonth: 5,
	placeholderDates: 7445,
	placeholderDays: [{ day: "09-07", occurrences: 7445 }],
	years: { from: 1990, to: 2024 },
	meta: { method: "Rare: at most 2 occurrences and 5 times the median.", notApplied: [] },
};
const common = { source: "DELTA Ethiopia", scope: "Ethiopia", provisional: false };

describe("Hazard by month heatmap", () => {
	const panel = hazardMonthPanel(ctx, D, "impact-hazard-month", 28, common);
	const html = renderToString(<>{panel.render!()}</>).replace(/<!-- -->/g, "");

	it("opens on occurrences, with a switch to People directly affected", () => {
		expect(html).toContain("Number of records");
		expect(html).toContain("People directly affected");
		expect(html).toMatch(/aria-checked="true"/);
	});

	it("keeps a drought dated only by a source default visible in Month unknown", () => {
		expect(html).toContain("Month unknown");
		expect(html).toContain(">3,304</td>");
		expect(html.indexOf("Drought")).toBeLessThan(html.indexOf("Flooding"));
	});

	it("puts each hazard under its cluster heading, with a row total", () => {
		expect(html).toMatch(/aria-expanded="true"[^>]*>.*Precipitation-related/);
		expect(html).toContain("4,269");
	});

	it("rings a rare severe month and leaves empty months blank, never 0", () => {
		expect(html).toContain("outline:2px solid");
		expect(html).not.toContain(">0</td>");
	});

	it("sorts by people when the switch is on people", () => {
		expect(orderRows(D.rows, "people").map((r) => r.key)).toEqual(["dr", "tc", "fl"]);
		expect(orderRows(D.rows, "count").map((r) => r.key)).toEqual(["dr", "fl", "tc"]);
	});

	it("keeps the top 20 by people, leaving out hazards with no people figure, and says Top 20", () => {
		const many = { ...D, rows: [
			...Array.from({ length: TOP_ROWS + 3 }, (_, i) => row(`h${i}`, `Hazard ${i}`, `Cluster ${i}`, 10, 1000 - i, { 1: { count: 1, people: people(1000 - i, "reported") } })),
			row("np", "No people", "Cluster np", 999, null, { 2: { count: 999, people: people(null, "not_reported") } }),
		] };
		const h = renderToString(<>{hazardMonthPanel(ctx, many, "x", 1, common).render!()}</>).replace(/<!-- -->/g, "");
		expect(h).toContain("Top 20");
		expect(h).toContain(">Hazard 19</th>");
		expect(h).not.toContain(">Hazard 20</th>");
		expect(h).not.toContain(">No people</th>");
		expect(h).not.toContain("Show all");
	});


	it("names each source default day in the notes, and exports month unknown and totals", () => {
		const exp = hazardMonthExport(ctx, D);
		expect(exp.notes).toContain("7,445 records dated September 7, a source default: month unknown.");
		expect(exp.rows.some((r) => r.label === "Drought, Month unknown" && r.value === 3304)).toBe(true);
		expect(exp.rows.some((r) => r.label === "Drought, Total" && r.value === 4269)).toBe(true);
		expect(exp.rows.find((r) => r.label === "Flooding, Aug" && r.series !== "Records")!.valueState).toBe("not_reported");
	});
});
