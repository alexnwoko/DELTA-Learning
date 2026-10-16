import { describe, it, expect } from "vitest";
import { renderToString as renderRaw } from "react-dom/server";
import type { ReactElement } from "react";

/** Server render without React's text separators, so assertions read plainly. */
const renderToString = (el: ReactElement) =>
	renderRaw(el).replaceAll("<!-- -->", "");

import type { GeoCell } from "~/backend.server/models/geo/queries";
import { measureFamily, toMapCell } from "~/frontend/geoportal/geoCells";
import { GeoLegend } from "~/frontend/geoportal/GeoLegend";
import { GeoTable } from "~/frontend/geoportal/GeoTable";
import { GeoFilterBar } from "~/frontend/geoportal/GeoFilterBar";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";
import { resolveMapState } from "~/utils/mapState";

// Geoportal client (increment I-2): the legend, the table alternative and the
// filter bar render every value state the way the shared resolver defines it,
// never a null as zero (TR-169, TR-176, TR-249).

function cell(id: string, patch: Partial<GeoCell>): GeoCell {
	return {
		division_id: id,
		value: null,
		value_state: "not_reported",
		records_reported: 0,
		records_zero_confirmed: 0,
		records_not_reported: 1,
		records_not_applicable: 0,
		records_total: 1,
		coverage: 0,
		plausibility_flagged_records: 0,
		gradeDistribution: { A: 0, B: 1, C: 0, D: 0 },
		geo_precision: { L2: 1 },
		...patch,
	};
}

const cells: GeoCell[] = [
	cell("a", {
		value: 12,
		value_state: "reported",
		records_reported: 5,
		records_zero_confirmed: 1,
		records_not_reported: 1,
		records_total: 6,
		coverage: 5 / 6,
		gradeDistribution: { A: 1, B: 4, C: 1, D: 0 },
	}),
	cell("b", {
		value: 0,
		value_state: "zero_confirmed",
		records_reported: 2,
		records_zero_confirmed: 2,
		records_not_reported: 0,
		records_total: 2,
	}),
	cell("c", {}),
	cell("d", {
		value: null,
		value_state: "insufficient_reporting",
		records_reported: 1,
		records_zero_confirmed: 1,
		records_not_reported: 4,
		records_total: 5,
	}),
	cell("e", {
		value: 7,
		value_state: "reported",
		records_reported: 1,
		records_not_reported: 0,
		plausibility_flagged_records: 1,
	}),
];

function state() {
	return resolveMapState(cells.map(toMapCell), {
		family: measureFamily("deaths"),
		scope: { tenant: null, audience: "signed-in" },
	});
}

describe("geoportal cell adapter", () => {
	it("takes confirmed zeros out of records_reported for the resolver", () => {
		const m = toMapCell(cells[0]);
		expect(m.recordsReported).toBe(4);
		expect(m.recordsZeroConfirmed).toBe(1);
		expect(m.recordsTotal).toBe(6);
		expect(m.geoPrecision).toBe("GEO-L2 (1)");
	});

	it("maps each measure to its ramp family", () => {
		expect(measureFamily("deaths")).toBe("people");
		expect(measureFamily("houses_damaged")).toBe("housing");
		expect(measureFamily("events")).toBe("events");
		expect(measureFamily("records")).toBe("events");
	});

	it("never turns a null into zero", () => {
		const s = state();
		const c = s.areas.find((a) => a.areaId === "c");
		expect(c?.value).toBeNull();
		expect(c?.state).toBe("not_reported");
	});
});

describe("GeoLegend", () => {
	it("lists every state on the map, areas with no records, and flagged areas", () => {
		const html = renderToString(
			<GeoLegend legend={state().legend} title="Deaths" noRecordsAreas={3} />,
		);
		expect(html).toContain("Zero, confirmed (1)");
		expect(html).toContain("No data (1)");
		expect(html).toContain("Insufficient reporting (1)");
		expect(html).toContain("No records in scope (3)");
		expect(html).toContain("Includes records flagged for review (1)");
	});
});

describe("GeoTable", () => {
	it("shows the same state as the map for every area, with counts and grades", () => {
		const byId = new Map(state().areas.map((a) => [a.areaId, a]));
		const html = renderToString(
			<GeoTable
				id="t"
				label="Deaths: table"
				rows={[
					{ id: "a", name: "Alpha", area: byId.get("a") },
					{ id: "c", name: "Gamma", area: byId.get("c") },
					{ id: "z", name: "Zeta", area: undefined },
				]}
				selectedId={null}
				onSelect={() => {}}
			/>,
		);
		expect(html).toContain('aria-label="Deaths: table"');
		expect(html).toContain("Alpha");
		expect(html).toContain("12");
		expect(html).toContain("5 of 6");
		expect(html).toContain("A 1, B 4, C 1");
		expect(html).toContain("No data");
		expect(html).toContain("No records in scope");
	});
});

describe("GeoFilterBar", () => {
	const props = {
		query: { ...DEFAULT_QUERY, measure: "deaths" as const },
		level: 1,
		levels: [1, 2],
		onChange: () => {},
	};

	it("offers the three dimensions, the dimension's measures and the levels", () => {
		const html = renderToString(<GeoFilterBar {...props} canReview={false} />);
		expect(html).toContain("Hazardous events");
		expect(html).toContain("Disaster events");
		expect(html).toContain("Disaster impact");
		expect(html).toContain('aria-label="Dimension"');
		expect(html).toContain("Deaths");
		expect(html).toContain("Admin level 1");
	});

	it("offers the provisional basis to reviewers only", () => {
		expect(
			renderToString(<GeoFilterBar {...props} canReview={false} />),
		).not.toContain("Provisional");
		expect(
			renderToString(<GeoFilterBar {...props} canReview={true} />),
		).toContain("Provisional");
	});

	it("shows the provisional box as ticked when the basis is provisional", () => {
		const on = renderToString(
			<GeoFilterBar
				{...props}
				query={{
					...props.query,
					scope: { ...props.query.scope, basis: "provisional" },
				}}
				canReview={true}
			/>,
		);
		const off = renderToString(<GeoFilterBar {...props} canReview={true} />);
		expect(on).toContain("✓");
		expect(off).not.toContain("✓");
	});
});

describe("GeoTable number formatting", () => {
	it("formats record counts and grades with separators", () => {
		const big = cell("n", {
			value: 1212,
			value_state: "reported",
			records_reported: 1212,
			records_not_reported: 0,
			records_total: 1212,
			coverage: 1,
			gradeDistribution: { A: 0, B: 1212, C: 0, D: 0 },
		});
		const s = resolveMapState([toMapCell(big)], {
			family: measureFamily("records"),
			scope: { tenant: null, audience: "signed-in" },
		});
		const html = renderToString(
			<GeoTable
				id="t"
				label="x"
				rows={[{ id: "n", name: "Nampula", area: s.areas[0] }]}
				selectedId={null}
				onSelect={() => {}}
			/>,
		);
		expect(html).toContain("1,212 of 1,212");
		expect(html).toContain("B 1,212");
	});
});
