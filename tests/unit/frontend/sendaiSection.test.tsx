import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "~/frontend/analytics/dashboard/DashboardShell";
import { SFM_HEADING_ID, SendaiSectionView, SendaiToggle, downloadPanels, focusSendaiHeading, sendaiSectionPanels } from "~/frontend/analytics/dashboard/panels/sendai/sendaiSection";
import { SENDAI_VIEWS, hasSendai, searchFor, sfmFromSearch } from "~/frontend/analytics/dashboard/views";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { SendaiSection } from "~/utils/dashboard/sendaiPanels";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const c = (value: number | null, valueState: PanelCell["valueState"], reported: number, total: number): PanelCell => ({
	value, valueState, recordsReported: valueState === "reported" ? reported : 0, recordsZeroConfirmed: valueState === "zero_confirmed" ? reported : 0,
	recordsNotReported: total - reported, recordsTotal: total, recordsFlagged: 0,
});
const meta = { method: "Sum over records in scope", notApplied: [] };
// Shaped like getSendaiSection's answer (Analytics 3d65dd3e); figures invented for the test.
const D: SendaiSection = {
	nationalOnly: true,
	provisional: true,
	coverage: { recordsWith: 412, recordsTotal: 534 },
	s0: {
		indicators: [
			{ code: "A-2", label: "Deaths", cell: c(615, "reported", 243, 534) },
			{ code: "A-3", label: "Missing persons", cell: c(0, "zero_confirmed", 7, 534) },
			{ code: "B-2", label: "Injured or ill", cell: c(null, "not_reported", 0, 534) },
		],
		inputs: [
			{ inputTo: "B-3", label: "Dwellings damaged", cell: c(2950, "reported", 272, 534) },
			{ inputTo: "B-4", label: "Dwellings destroyed", cell: c(1830, "reported", 242, 534) },
		],
		directlyAffected: c(120400, "reported", 254, 534),
		refused: [{ code: "A-1, B-1", reason: "No population denominator (TR-154)" }],
	},
	a1: {
		years: [
			{ year: 2022, deaths: c(110, "reported", 30, 60), missing: c(4, "reported", 3, 60) },
			{ year: 2023, deaths: c(null, "not_reported", 0, 55), missing: c(null, "not_reported", 0, 55) },
		],
		reference: { from: 2005, to: 2015, years: 11, deaths: c(60, "reported", 100, 300) },
	},
	a2: { rows: [{ hipTypeId: "1042", label: "Meteorological and Hydrological", deaths: c(560, "reported", 210, 480), missing: c(null, "not_reported", 0, 480) }] },
	b1: { injured: [{ year: 2022, cell: c(40, "reported", 10, 60) }, { year: 2023, cell: c(null, "not_reported", 0, 55) }, { year: 2024, cell: c(12, "reported", 4, 50) }], affectedDirect: [{ year: 2022, cell: c(900, "reported", 20, 60) }] },
	b2: { rows: [{ year: 2022, destroyed: c(100, "reported", 20, 60), damaged: c(null, "not_reported", 0, 60) }] },
	c1: { gap: { code: "G-06", reason: "Not shown: monetary convention pending" }, untypedMoneyRecords: 50212, units: [{ label: "Dwellings", status: "held", records: 300 }, { label: "Crops (ha)", status: "source field, not loaded", records: 0 }] },
	c2: { sectors: [{ sectorId: "s1", label: "Housing" }], rows: [{ decade: 2010, cells: [c(64, "reported", 64, 300)] }] },
	d1: { gap: { code: "G-22", reason: "Not yet available: facility counts are held in source fields and not loaded until validated" }, sourceFields: [{ field: "nhospitales", label: "Health facilities", records: 4553 }] },
	d2: { gap: { code: "G-08", reason: "Not yet available: no disruption rows" } },
	meta: { s0: meta, a1: meta, a2: meta, b1: meta, b2: meta, c1: meta, c2: meta, d1: meta, d2: meta },
};
const opts = { source: "DELTA Angola", scope: "Angola", country: "Angola" };
const section = (d: SendaiSection) =>
	text(renderToString(<SendaiSectionView ctx={ctx} d={d} panels={sendaiSectionPanels(ctx, d, opts)} country="Angola" />));

describe("Sendai section (SFM requirements v0.1)", () => {
	it("has nine slots in fixed order with their own ids (FR-AN-030)", () => {
		const panels = sendaiSectionPanels(ctx, D, opts);
		expect(panels.map((p) => p.id)).toEqual(["sfm-s0", "sfm-a1", "sfm-a2", "sfm-b1", "sfm-b2", "sfm-c1", "sfm-c2", "sfm-d1", "sfm-d2"]);
		const html = section(D);
		const order = [...html.matchAll(/id="(sfm-(?:s0|[a-d][12]))"/g)].map((m) => m[1]);
		expect(order).toEqual(["sfm-s0", "sfm-a1", "sfm-a2", "sfm-b1", "sfm-b2", "sfm-c1", "sfm-c2", "sfm-d1", "sfm-d2"]);
	});

	it("states the notice once on screen, keeps it in every download, with basis and coverage (FR-AN-026, 027)", () => {
		const html = section(D);
		for (const p of sendaiSectionPanels(ctx, D, opts)) {
			expect(p.exportData!.notes.join(" "), p.id).toContain("not the official Sendai Framework Monitor submission of Angola");
		}
		expect(html.match(/These figures are not the official Sendai Framework Monitor submission of Angola\./g)).toHaveLength(1);
		expect(html).toContain("Provisional. Based on 412 of 534 records.");
		expect(html).toContain("Target A: mortality");
		expect(html).toContain("Target D: critical infrastructure and basic services");
	});

	it("keeps a gap in its slot with reason and code (FR-AN-025)", () => {
		const html = section(D);
		expect(html).toContain("Not shown: monetary convention pending");
		expect(html).toContain("(G-06)");
		expect(html).toContain("50,212 records carry an untyped money value");
		expect(html).toContain("(G-22)");
		expect(html).toContain("Health facilities: held in source field nhospitales for 4,553 records");
		expect(html).toContain("(G-08)");
	});

	it("S0 shows codes nationally, states per row, and directly affected with no code", () => {
		const html = section(D);
		expect(html).toMatch(/A-2<\/th><td[^>]*>Deaths/);
		expect(html).toContain("Zero, confirmed");
		expect(html).toContain("Dwellings damaged, input to B-3");
		expect(html).toMatch(/\(no code\)<\/th><td[^>]*>Directly affected, as recorded/);
		expect(html).toContain("No population denominator (TR-154)");
	});

	it("drops every code under a place filter and says so (TR-060, FR-AN-009)", () => {
		const sub: SendaiSection = {
			...D,
			nationalOnly: false,
			s0: {
				...D.s0,
				indicators: D.s0.indicators.map((i) => ({ ...i, code: null })),
				inputs: D.s0.inputs.map((i) => ({ ...i, inputTo: null })),
				refused: D.s0.refused.map((r) => ({ ...r, code: null })),
			},
		};
		const html = section(sub);
		expect(html).toContain("Sub-national figures. Not a Sendai indicator value (TR-060).");
		expect(html).not.toMatch(/\b[A-D]-\d\b/);
		const rows = sendaiSectionPanels(ctx, sub, opts).flatMap((p) => p.exportData!.rows.map((r) => `${r.label} ${r.series ?? ""}`));
		expect(rows.join(" ")).not.toMatch(/\b[A-D]-\d\b/);
	});

	it("A1 draws a not-reported year as a gap and labels the reference as an annual average", () => {
		const html = section(D);
		expect(html).toContain("2023 Deaths: No data");
		expect(html).toContain("2005 to 2015 annual average of deaths (11 years)");
	});
});

describe("Sendai toggle (FR-AN-020 to 023)", () => {
	it("is a pressed-state button", () => {
		const html = text(renderToString(<SendaiToggle ctx={ctx} on onChange={() => {}} />));
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("Sendai Framework Monitoring");
	});

	it("lives in sfm=1, outside delta.query/1, and survives a view change", () => {
		const params = new URLSearchParams("sfm=1&dim=disaster_event&from=2015");
		expect(sfmFromSearch(params)).toBe(true);
		expect(parseDeltaQuery(params).issues).toEqual([]);
		const next = searchFor(parseDeltaQuery(params).query, "disaster_impact", true);
		expect(next.get("sfm")).toBe("1");
		expect(next.get("from")).toBe("2015");
		expect(searchFor(parseDeltaQuery(params).query, "disaster_impact", false).get("sfm")).toBeNull();
	});

	it("belongs to Disaster events and Disaster impact only (Alex, 2026-10-18)", () => {
		expect(SENDAI_VIEWS).toEqual(["disaster_event", "disaster_impact"]);
		expect(hasSendai("disaster_event")).toBe(true);
		expect(hasSendai("disaster_impact")).toBe(true);
		expect(hasSendai("hazardous_event")).toBe(false);
		expect(hasSendai("sectors")).toBe(false);
		// Moving to a view without the section drops sfm=1 from the URL.
		const q = parseDeltaQuery(new URLSearchParams("sfm=1&dim=disaster_impact")).query;
		expect(searchFor(q, "hazardous_event", true).get("sfm")).toBeNull();
		expect(searchFor(q, "sectors", true).get("sfm")).toBeNull();
		expect(searchFor(q, "disaster_event", true).get("sfm")).toBe("1");
	});

	const shell = (sfmOn: boolean) => {
		const Stub = createRoutesStub([{ path: "/", Component: () => (
			<DashboardShell ctx={ctx} view="disaster_impact" onViewChange={() => {}} summary="Angola" provisional={false}
				sfmOn={sfmOn} sendai={<p>SENDAI SECTION</p>} filterBar={<p>FILTERS</p>} map={<p>MAP</p>}
				panels={[{ id: "x", n: 1, title: "X", render: () => <p>VIEW PANEL</p> }]} about={<p>ABOUT</p>} />
		) }]);
		return text(renderToString(<Stub />));
	};

	it("toggle off: filters, then the view's map and panels, then the Sendai section, then About the data (FR-AN-024)", () => {
		const html = shell(false);
		// React Aria's server render puts a hidden copy of the Tabs children
		// first; the last occurrence of each marker is the visible one.
		const at = (s: string) => html.lastIndexOf(s);
		for (const s of ["FILTERS", "MAP", "VIEW PANEL", "SENDAI SECTION", "ABOUT"]) expect(at(s), s).toBeGreaterThan(-1);
		expect(at("FILTERS")).toBeLessThan(at("MAP"));
		expect(at("MAP")).toBeLessThan(at("VIEW PANEL"));
		expect(at("VIEW PANEL")).toBeLessThan(at("SENDAI SECTION"));
		expect(at("SENDAI SECTION")).toBeLessThan(at("ABOUT"));
		expect(html).not.toContain("The Sendai view reads disaster records of all dimensions");
	});

	it("toggle on: the Sendai section sits directly under the filter bar (FR-AN-024)", () => {
		const html = shell(true);
		const filters = html.lastIndexOf("FILTERS");
		const sendai = html.lastIndexOf("SENDAI SECTION");
		expect(filters).toBeGreaterThan(-1);
		expect(filters).toBeLessThan(sendai);
		expect(html.slice(filters, sendai)).not.toMatch(/role="tabpanel"|MAP|VIEW PANEL/);
	});

	it("the Sendai heading is focusable by script only", () => {
		const html = section(D);
		expect(html).toMatch(new RegExp(`<h2 id="${SFM_HEADING_ID}" tabindex="-1"`));
	});

	it("toggle on moves focus to the Sendai heading and scrolls it into view", () => {
		const calls: string[] = [];
		const heading = {
			focus: (o?: FocusOptions) => calls.push(`focus preventScroll=${o?.preventScroll}`),
			scrollIntoView: (o?: ScrollIntoViewOptions) => calls.push(`scroll ${o?.block}`),
		};
		const doc = { getElementById: (id: string) => (id === "sfm-heading" ? heading : null) } as unknown as Document;
		expect(focusSendaiHeading(doc)).toBe(true);
		expect(calls).toEqual(["focus preventScroll=true", "scroll start"]);
		expect(focusSendaiHeading({ getElementById: () => null } as unknown as Document)).toBe(false);
	});

	it("the CSV follows the screen: view panels then Sendai slots when off, only Sendai slots when on", () => {
		const p = (id: string) => ({ id, n: 1, title: id });
		const sendai = [p("sfm-s0"), p("sfm-a1")];
		const view = [p("impact-1"), p("impact-2")];
		expect(downloadPanels(sendai, view, false).map((x) => x.id)).toEqual(["impact-1", "impact-2", "sfm-s0", "sfm-a1"]);
		expect(downloadPanels(sendai, view, true).map((x) => x.id)).toEqual(["sfm-s0", "sfm-a1"]);
	});

	it("toggle on: tabs disabled with the note, no view panels or map; the Sendai section stays", () => {
		const Stub = createRoutesStub([{ path: "/", Component: () => (
			<DashboardShell ctx={ctx} view="disaster_impact" onViewChange={() => {}} summary="Angola" provisional={false}
				sfmOn sendai={<p>SENDAI SECTION</p>} filterBar={<p>FILTERS</p>} map={<p>MAP</p>}
				panels={[{ id: "x", n: 1, title: "X", render: () => <p>VIEW PANEL</p> }]} />
		) }]);
		const html = text(renderToString(<Stub />));
		expect(html).toContain("The Sendai view reads disaster records of all dimensions");
		expect(html).toContain("FILTERS");
		expect(html).toContain("SENDAI SECTION");
		expect(html).not.toContain("MAP");
		expect(html).not.toContain("VIEW PANEL");
		expect(html.match(/aria-disabled="true"/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
	});
});
