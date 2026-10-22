// Largest first (Alex, 2026-10-22): category bars and tables read from the
// biggest value down; catch-all rows stay last; ordered categories keep
// their order; a row with no value never sorts as 0.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RowBars, ShadedTable, sortByValueDesc } from "~/frontend/analytics/dashboard/panels/blocks";
import type { ViewContext } from "~/frontend/context";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const cell = (value: number | null) => ({ value, valueState: value === null ? ("not_reported" as const) : ("reported" as const), recordsReported: 1, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: 1, recordsFlagged: 0 });
const text = (h: string) => h.replace(/<!-- -->/g, "");
const order = (html: string, labels: string[]) => labels.map((l) => html.indexOf(`>${l}<`));
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

describe("largest first", () => {
	it("sorts by value, then no-value rows, then the catch-alls in their own order", () => {
		const rows = [
			{ key: "none", v: 999 },
			{ key: "a", v: 5 },
			{ key: "b", v: null },
			{ key: "c", v: 50 },
			{ key: "rest", v: 1000 },
			{ key: "d", v: 20 },
		];
		expect(sortByValueDesc(rows, (r) => r.v).map((r) => r.key)).toEqual(["c", "d", "a", "b", "none", "rest"]);
	});

	it("keeps equal values in their given order", () => {
		expect(sortByValueDesc([{ key: "x", v: 3 }, { key: "y", v: 3 }], (r) => r.v).map((r) => r.key)).toEqual(["x", "y"]);
	});

	it("RowBars draws largest first by the lead bar, and keeps ordered categories when asked", () => {
		const rows = [
			{ key: "flood", label: "Flood", bars: [{ cell: cell(10) }, { cell: cell(900) }] },
			{ key: "storm", label: "Storm", bars: [{ cell: cell(40) }, { cell: cell(1) }] },
			{ key: "none", label: "Hazard not coded", bars: [{ cell: cell(500) }] },
		];
		const sorted = text(renderToString(<RowBars ctx={ctx} label="x" rows={rows} />));
		expect(ascending(order(sorted, ["Storm", "Flood", "Hazard not coded"]))).toBe(true);
		const bins = [
			{ key: "1", label: "1 record", bars: [{ cell: cell(3) }] },
			{ key: "2-5", label: "2-5 records", bars: [{ cell: cell(30) }] },
		];
		const given = text(renderToString(<RowBars ctx={ctx} label="x" order="given" rows={bins} />));
		expect(ascending(order(given, ["1 record", "2-5 records"]))).toBe(true);
	});

	it("ShadedTable sorts rows by total, by the first column, or not at all; columns never move", () => {
		const rows = [
			{ key: "a", label: "Alpha", cells: [cell(1), cell(100)] },
			{ key: "b", label: "Beta", cells: [cell(50), cell(2)] },
		];
		const byTotal = text(renderToString(<ShadedTable ctx={ctx} caption="c" rowHeader="h" columns={["Deaths", "Houses"]} rows={rows} normalise="column" />));
		expect(ascending(order(byTotal, ["Alpha", "Beta"]))).toBe(true);
		const byFirst = text(renderToString(<ShadedTable ctx={ctx} caption="c" rowHeader="h" columns={["Deaths", "Houses"]} rows={rows} normalise="column" order="first" />));
		expect(ascending(order(byFirst, ["Beta", "Alpha"]))).toBe(true);
		expect(ascending(order(byFirst, ["Deaths", "Houses"]))).toBe(true);
		const decades = [
			{ key: "1990", label: "1990s", cells: [cell(1)] },
			{ key: "2000", label: "2000s", cells: [cell(9)] },
		];
		const given = text(renderToString(<ShadedTable ctx={ctx} caption="c" rowHeader="h" columns={["x"]} rows={decades} normalise="table" order="given" />));
		expect(ascending(order(given, ["1990s", "2000s"]))).toBe(true);
	});
});
