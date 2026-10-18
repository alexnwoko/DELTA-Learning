import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { sectorDashboardPanels } from "~/frontend/analytics/dashboard/panels/sectors/sectorPanels";
import { collapsesGaps } from "~/frontend/analytics/dashboard/types";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { SectorPanels1to7, SectorRef } from "~/utils/dashboard/sectorPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const cell = (value: number | null, valueState: PanelCell["valueState"], reported: number, total: number): PanelCell => ({
	value, valueState, recordsReported: valueState === "reported" ? reported : 0, recordsZeroConfirmed: valueState === "zero_confirmed" ? reported : 0,
	recordsNotReported: total - reported, recordsTotal: total, recordsFlagged: 0,
});
const sec = (id: string, label: string, level = 2, parentId: string | null = "p"): SectorRef => ({ sectorId: id, label, level, parentId });
const meta = { method: "Records per sector", notApplied: [] };
const money = { code: "G-06" as const, reason: "Not shown: monetary convention pending" };
// Shaped like the loader's answer (a6ac6a7d); figures invented for the test.
const D: SectorPanels1to7 = {
	empty: null,
	headline: { recordsAnySector: cell(260, "reported", 260, 534), sectorsLinked: { linked: 3, level2Total: 41 }, dwellingsDamaged: cell(30211, "reported", 301, 534), dwellingsDestroyed: cell(8120, "reported", 210, 534), losses: cell(null, "not_reported", 0, 534), money },
	reporting: { groups: [{ level1: sec("p", "Productive", 1, null), rows: [{ sector: sec("s1", "Agriculture"), records: cell(64, "reported", 64, 534) }, { sector: sec("s2", "Fisheries"), records: cell(null, "not_reported", 0, 534) }] }] },
	effectTypes: { columns: ["damage_physical", "damage_money", "losses", "disruption"], rows: [{ sector: sec("s1", "Agriculture"), damagePhysical: cell(64, "reported", 64, 534), damageMoney: money, losses: cell(null, "not_reported", 0, 534), disruption: cell(null, "not_reported", 0, 534) }] },
	hazardBySector: { sectors: [sec("s1", "Agriculture"), sec("s3", "Housing")], rows: [{ hipTypeId: "1042", label: "Meteorological and Hydrological", cells: [cell(60, "reported", 60, 300), cell(null, "not_reported", 0, 300)] }] },
	byYear: { series: [{ sector: sec("s1", "Agriculture"), years: [{ year: 2020, records: cell(10, "reported", 10, 40) }, { year: 2021, records: cell(null, "not_reported", 0, 30) }] }], recordsWithoutYear: 5 },
	dwellings: { groupBy: "hipType", rows: [{ key: "1042", label: "Meteorological and Hydrological", damaged: cell(29000, "reported", 280, 300), destroyed: cell(7900, "reported", 200, 300) }] },
	sendai: { nationalOnly: true, rows: [
		{ code: "C-2", indicator: "Direct agricultural loss", heldLabel: "Records reporting agricultural damage", held: cell(64, "reported", 64, 534), status: "COUNT", gap: null },
		{ code: "C-3", indicator: "Direct economic loss to productive assets", heldLabel: "Money", held: null, status: "MONEY", gap: money },
		{ code: "D-5", indicator: "Disruptions to basic services", heldLabel: "Disruption", held: null, status: "NOT_HELD", gap: { code: "G-08", reason: "No disruption rows" } },
	] },
	rankedDivisions: { rows: [{ divisionId: "d1", name: "Luanda", cell: cell(40, "reported", 40, 120) }], rest: null, multiDivisionRecords: 3 },
	completeness: { recordsTotal: 534, rows: [{ sector: sec("s1", "Agriculture"), damage: { yes: 64, no: 120 }, losses: { yes: 0, no: 0 }, disruption: { yes: 0, no: 0 } }] },
	meta: { headline: meta, reporting: meta, effectTypes: meta, hazardBySector: meta, byYear: meta, dwellings: meta, sendai: meta, rankedDivisions: meta, completeness: meta },
};
const opts = { source: "DELTA Angola", scope: "Angola", provisional: false, country: "Angola" };
const panels = sectorDashboardPanels(ctx, D, opts);
const html = (n: number, p = panels) => text(renderToString(<>{p.find((x) => x.n === n)!.render!()}</>));

describe("Sectors view panels 1 to 7", () => {
	it("draw seven panels, each framed even without data (Sectors keeps frames)", () => {
		expect(panels.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(collapsesGaps("sectors")).toBe(false);
	});

	it("1: keeps losses and money apart from damage, money as G-06", () => {
		const h = html(1);
		expect(h).toContain("3");
		expect(h).toContain("of 41 level-2 sectors");
		expect(h).toContain("Records reporting losses");
		expect(h).toContain("Not shown: monetary convention pending");
		expect(h).toContain("G-06");
	});

	it("2: an unlinked sector reads 'No records linked', never a zero bar", () => {
		const h = html(2);
		expect(h).toContain("Productive");
		expect(h).toContain("No records linked");
		expect(h).not.toMatch(/Fisheries[^]*?>0</);
	});

	it("3: damage in money shows only its gap code", () => {
		const h = html(3);
		expect(h).toContain("G-06");
		expect(panels[2].exportData!.rows.find((r) => r.series === "Damage (money)")!.value).toBeNull();
	});

	it("5 and 6: count what is left out; two dwelling bars, never added", () => {
		expect(panels[4].exportData!.notes).toContain("5 sector-linked records have no start year and are left out.");
		const h = html(6);
		expect(h).toContain("7,900");
		expect(h).toContain("29,000");
		expect(h).not.toContain(String(7900 + 29000));
	});

	it("7: names the country in the notice, shows codes nationally, drops them under a place filter", () => {
		const h = html(7);
		expect(h).toContain("not the official Sendai Framework Monitor submission of Angola");
		expect(h).toContain("C-2");
		expect(h).toContain("Not shown: monetary convention pending (G-06)");
		const sub = sectorDashboardPanels(ctx, { ...D, sendai: { nationalOnly: false, rows: D.sendai.rows.map((r) => ({ ...r, code: null })) } }, opts);
		const hs = html(7, sub);
		expect(hs).not.toMatch(/\b[CD]-\d\b/);
		expect(sub[6].exportData!.notes).toContain("Sub-national view: indicator codes are not shown (TR-060).");
	});

	it("export every panel to the page CSV with value states", () => {
		const csv = dashboardPanelsCsv(panels, "Angola", "DELTA Angola", "published", new Date("2026-10-17T00:00:00Z"));
		expect(csv).toContain("Records by sector,Fisheries,Productive,,not_reported,records,");
		expect(csv).toContain("Towards Sendai Targets C and D,C-2 Direct agricultural loss,");
	});
});
