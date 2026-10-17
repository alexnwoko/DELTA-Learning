import { describe, expect, it } from "vitest";
import {
	chartCsv,
	chartFileName,
	csvCell,
	dashboardCsv,
	exportNotes,
	standaloneChartSvg,
	type ChartExportMeta,
	type ChartExportRow,
} from "~/frontend/charts/chartExport";

const AT = new Date("2026-10-16T12:00:00Z");
const META: ChartExportMeta = {
	title: "Deaths by hazard",
	source: "DELTA Angola",
	scope: "Angola, 2015-2024",
	method: "Sum of reported records",
	grade: "B",
	basis: "published",
	generatedAt: AT,
};
const ROWS: ChartExportRow[] = [
	{ label: "Flood", value: 120, valueState: "reported", recordsFlagged: 2 },
	{ label: "Drought", value: 0, valueState: "zero_confirmed" },
	{ label: "Landslide", value: null, valueState: "not_reported" },
];

const csvRows = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n");

describe("chartCsv (TR-245, NFR-131)", () => {
	it("never writes a missing figure as zero (TR-076)", () => {
		const [, flood, drought, landslide] = csvRows(chartCsv(ROWS, META));
		expect(flood.startsWith("Flood,,120,reported,")).toBe(true);
		expect(drought.startsWith("Drought,,0,zero_confirmed,")).toBe(true);
		expect(landslide.startsWith("Landslide,,,not_reported,")).toBe(true);
	});

	it("carries method, grade, basis, source, scope and flagged count on every row", () => {
		const [header, flood] = csvRows(chartCsv(ROWS, META));
		expect(header).toBe(
			"label,series,value,value_state,unit,records_flagged,method,grade,basis,source,scope,notes,title,generated",
		);
		expect(flood).toBe(
			'Flood,,120,reported,,2,Sum of reported records,B,Published records,DELTA Angola,"Angola, 2015-2024",,Deaths by hazard,2026-10-16',
		);
	});

	it("leaves an unknown flagged count empty, not zero (TR-076)", () => {
		const [, , drought] = csvRows(chartCsv(ROWS, META));
		expect(drought.split(",")[5]).toBe("");
		const [, flood] = csvRows(chartCsv(ROWS, META));
		expect(flood.split(",")[5]).toBe("2");
	});

	it("carries the screen's extra notes, such as coverage, in every format", () => {
		const meta = { ...META, notes: ["12 of 40 records carry a sex breakdown"] };
		expect(csvRows(chartCsv(ROWS, meta))[1]).toContain(",12 of 40 records carry a sex breakdown,");
		expect(exportNotes(meta, ROWS)).toContain("12 of 40 records carry a sex breakdown");
	});

	it("labels a provisional export as not for publication (AB-01)", () => {
		const [, flood] = csvRows(chartCsv(ROWS, { ...META, basis: "provisional" }));
		expect(flood).toContain("PROVISIONAL: includes unpublished records; not for publication");
	});

	it("starts with a UTF-8 byte order mark and keeps non-Latin labels", () => {
		const csv = chartCsv([{ label: "Сел", value: 3, valueState: "reported" }], META);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv).toContain("\r\nСел,,3,reported,");
	});
});

describe("csvCell", () => {
	it("quotes commas, quotes and line breaks", () => {
		expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
		expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
	});

	it("neutralises text a spreadsheet would run as a formula", () => {
		expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
		expect(csvCell("+1")).toBe("'+1");
		expect(csvCell("@sum")).toBe("'@sum");
	});

	it("keeps numbers and writes null, undefined and NaN as empty", () => {
		expect(csvCell(-5)).toBe("-5");
		expect(csvCell(null)).toBe("");
		expect(csvCell(undefined)).toBe("");
		expect(csvCell(Number.NaN)).toBe("");
	});
});

describe("exportNotes", () => {
	it("lists source, basis, scope, method and grade, caveat, blanks and date", () => {
		expect(exportNotes(META, ROWS)).toEqual([
			"Source: DELTA Angola",
			"Basis: Published records",
			"Scope: Angola, 2015-2024",
			"Method: Sum of reported records; Grade: B",
			"2 record(s) behind these figures are flagged for review",
			"Blank values are not reported, not zero",
			"Generated 2026-10-16",
		]);
	});
});

describe("chartFileName", () => {
	it("slugs the title and adds the date", () => {
		expect(chartFileName("Deaths by hazard (2015–2024)", "csv", AT)).toBe(
			"deaths-by-hazard-2015-2024_2026-10-16.csv",
		);
		expect(chartFileName("Пострадавшие", "png", AT)).toBe("пострадавшие_2026-10-16.png");
		expect(chartFileName("***", "svg", AT)).toBe("chart_2026-10-16.svg");
	});
});

describe("standaloneChartSvg", () => {
	const chart = '<svg class="recharts-surface" width="400" height="200" viewBox="0 0 400 200"><rect/></svg>';

	it("wraps the chart with a title and every note in the footer", () => {
		const svg = standaloneChartSvg(chart, { width: 400, height: 200 }, META, ROWS);
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(svg).toContain("<title>Deaths by hazard</title>");
		for (const note of exportNotes(META, ROWS)) expect(svg).toContain(note);
		expect(svg).toContain('<svg x="16" y="44" class="recharts-surface" width="400" height="200"');
	});

	it("escapes markup in titles and notes", () => {
		const svg = standaloneChartSvg(chart, { width: 400, height: 200 }, { ...META, title: "<b>x</b> & y" }, ROWS);
		expect(svg).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
		expect(svg).not.toContain("<b>x</b>");
	});
});

describe("dashboardCsv (D1, ruling D6)", () => {
	const { title: _t, ...meta } = META;
	const csv = dashboardCsv("Angola · 2015 to 2024 · Basis: published", [
		{ title: "Deaths by hazard", rows: ROWS, meta },
		{ title: "Coverage", rows: [{ label: "Reported", value: 235, valueState: "reported", unit: "records" }], meta },
	]);

	it("opens with the scope line, then a panel column before the chart columns", () => {
		const [scope, header] = csvRows(csv);
		expect(scope).toBe("scope,Angola · 2015 to 2024 · Basis: published");
		expect(header).toBe(
			"panel,label,series,value,value_state,unit,records_flagged,method,grade,basis,source,scope,notes,title,generated",
		);
	});

	it("keeps each row's value state and each panel's title, a missing figure blank", () => {
		const lines = csvRows(csv).slice(2);
		expect(lines).toHaveLength(4);
		expect(lines[2].startsWith("Deaths by hazard,Landslide,,,not_reported,")).toBe(true);
		expect(lines[3].startsWith("Coverage,Reported,,235,reported,records,")).toBe(true);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
	});

	it("matches the single-panel CSV row for row after the panel column", () => {
		const single = csvRows(chartCsv(ROWS, META)).slice(1);
		const combined = csvRows(csv).slice(2, 5).map((l) => l.slice("Deaths by hazard,".length));
		expect(combined).toEqual(single);
	});
});
