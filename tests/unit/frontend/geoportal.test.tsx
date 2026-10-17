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
		expect(html).toContain(
			'Zero, confirmed <span class="text-brand-text-muted">(1 area)',
		);
		expect(html).toContain(
			'No data <span class="text-brand-text-muted">(1 area)',
		);
		expect(html).toContain(
			'Insufficient reporting <span class="text-brand-text-muted">(1 area)',
		);
		expect(html).toContain(
			'Nothing in scope <span class="text-brand-text-muted">(3 areas)',
		);
		expect(html).toContain(
			'flagged for review <span class="text-brand-text-muted">(1 area)',
		);
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
		expect(html).toContain("Nothing in scope");
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
		expect(html).toContain("Dimension");
		expect(html).toContain('aria-labelledby="geo-dim-label"');
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

describe("geoportal vocabulary (Alex ruling 2026-10-16: Disaster impact only)", () => {
	it("never shows 'Disaster record' or 'impact record' in the controls, legend or table", () => {
		const s = state();
		const html = [
			renderToString(
				<GeoFilterBar
					query={{ ...DEFAULT_QUERY, measure: "records" as const }}
					level={1}
					levels={[1]}
					canReview={true}
					onChange={() => {}}
				/>,
			),
			renderToString(
				<GeoLegend legend={s.legend} title="x" noRecordsAreas={1} />,
			),
			renderToString(
				<GeoTable
					id="t"
					label="x"
					rows={[{ id: "a", name: "A", area: s.areas[0] }]}
					selectedId={null}
					onSelect={() => {}}
				/>,
			),
		].join(" ");
		expect(html).not.toMatch(/disaster records?|impact records?/i);
		expect(html).toContain("Disaster impacts (count)");
	});
});

import { rankRows } from "~/frontend/geoportal/GeoTable";
import { GeoDossier, type DossierData } from "~/frontend/geoportal/GeoDossier";
import { GeoReadout } from "~/frontend/geoportal/GeoReadout";
import { refusalText } from "~/frontend/geoportal/refusals";
import { plainT } from "~/frontend/geoportal/i18n";
import { GEO_MEASURE_INFO, GEO_MEASURES } from "~/utils/geoMeasures";

describe("ranked area list (review R07)", () => {
	it("ranks areas with a value, lists the others after them and never ranks them as 0", () => {
		const byId = new Map(state().areas.map((a) => [a.areaId, a]));
		const rows = ["a", "b", "c", "d", "e"].map((id) => ({
			id,
			name: id.toUpperCase(),
			area: byId.get(id),
		}));
		const ranked = rankRows(
			[...rows, { id: "z", name: "Z", area: undefined }],
			{ column: "value", direction: "descending" },
		);
		expect(ranked.map((r) => [r.row.id, r.rank])).toEqual([
			["a", 1],
			["e", 2],
			// b is a confirmed zero, c no data, d insufficient: listed, unranked.
			...ranked.slice(2).map((r) => [r.row.id, null]),
		]);
		expect(
			ranked
				.slice(2)
				.map((r) => r.row.id)
				.sort(),
		).toEqual(["b", "c", "d", "z"]);
	});

	it("keeps ranks by value when sorted by name", () => {
		const byId = new Map(state().areas.map((a) => [a.areaId, a]));
		const ranked = rankRows(
			[
				{ id: "a", name: "Zulu", area: byId.get("a") },
				{ id: "e", name: "Alpha", area: byId.get("e") },
			],
			{ column: "name", direction: "ascending" },
		);
		expect(ranked.map((r) => [r.row.name, r.rank])).toEqual([
			["Alpha", 2],
			["Zulu", 1],
		]);
	});
});

const dossierData = (patch: Partial<DossierData> = {}): DossierData => ({
	division: { id: "n", name: "Nampula", level: 1, parent: null },
	recurrence: {
		recordCount: 1212,
		firstYear: 2018,
		lastYear: 2022,
		undatedRecordCount: 3,
		periodsWithNoReporting: ["2019-2020"],
		gradeDistribution: { A: 0, B: 1212, C: 0, D: 0 },
		note: "note",
	},
	hazardMix: [{ hipTypeId: "1", recordCount: 1200 }],
	byYear: [
		{ year: 2018, recordCount: 10 },
		{ year: 2021, recordCount: 5 },
		{ year: 2022, recordCount: 7 },
	],
	cumulative: {
		deaths: {
			value: 2574,
			value_state: "reported",
			records_reported: 276,
			records_total: 1212,
		},
		affected_direct: {
			value: null,
			value_state: "not_reported",
			records_reported: 0,
			records_total: 1212,
		},
		displaced: {
			value: 0,
			value_state: "zero_confirmed",
			records_reported: 4,
			records_total: 1212,
		},
	},
	meta: { boundaryVersion: "cod-ab-2023", provisional: true },
	...patch,
});

describe("place dossier (review R06)", () => {
	it("shows units, the state name for missing figures and never a bare 0", () => {
		const html = renderToString(
			<GeoDossier
				data={dossierData()}
				hazardTypeNames={{ "1": "Meteorological" }}
			/>,
		);
		expect(html).toContain(
			'Disaster impacts <span class="text-brand-text-muted">[count]',
		);
		expect(html).toContain("1,212");
		expect(html).toContain("2,574");
		expect(html).toContain("[people]");
		expect(html).toContain("No data");
		expect(html).toContain("0 (confirmed)");
		expect(html).toContain("Meteorological");
		expect(html).toContain("Boundaries: cod-ab-2023");
		expect(html).toContain("3 without a date");
	});

	it("draws silent years as gaps and names them for screen readers", () => {
		const html = renderToString(
			<GeoDossier data={dossierData()} hazardTypeNames={{}} />,
		);
		expect(html).toContain("No reporting: 2019-2020");
		expect(html).toContain(
			'aria-label="Disaster impacts by year, 2018 to 2022. No reporting: 2019-2020"',
		);
		expect((html.match(/url\(#geo-gap\)/g) ?? []).length).toBe(2);
	});
});

describe("hover readout (review R04)", () => {
	it("gives the value with its unit, or the state name, and who reported it", () => {
		const byId = new Map(state().areas.map((a) => [a.areaId, a]));
		const shaded = renderToString(
			<GeoReadout
				name="Alpha"
				area={byId.get("a")}
				unit="people"
				reportedNoun="disaster impacts"
				selected={false}
			/>,
		);
		expect(shaded).toContain("12 people");
		expect(shaded).toContain("Reported by 5 of 6 disaster impacts");
		expect(shaded).toContain("Select for place details");
		const missing = renderToString(
			<GeoReadout
				name="Gamma"
				area={byId.get("c")}
				unit="people"
				reportedNoun="disaster impacts"
				selected={true}
			/>,
		);
		expect(missing).toContain("No data");
		expect(missing).not.toContain("0 people");
	});
});

describe("question bar (review R05)", () => {
	const tree = {
		types: [
			{ id: "1", name: "Meteorological", recordCountSubtree: 900 },
			{ id: "2", name: "Biological", recordCountSubtree: 0 },
		],
		clusters: [
			{ id: "11", typeId: "1", name: "Wind", recordCountSubtree: 900 },
		],
		hazards: [
			{
				id: "111",
				clusterId: "11",
				code: "MH0300",
				name: "Cyclone",
				recordCountSubtree: 900,
			},
		],
	};
	const base = {
		level: 1,
		levels: [1],
		canReview: false,
		onChange: () => {},
		hazardTree: tree,
		thisYear: 2026,
	};

	it("groups the controls and offers period presets", () => {
		const html = renderToString(
			<GeoFilterBar
				{...base}
				query={{ ...DEFAULT_QUERY, measure: "deaths" as const }}
			/>,
		);
		for (const g of ["What", "Where", "When", "Hazard"]) {
			expect(html).toContain(`<legend class="sr-only">${g}</legend>`);
		}
		expect(html).toContain("All years");
		expect(html).toContain("Hazard type");
	});

	it("opens the cluster and hazard steps for a chosen hazard", () => {
		const html = renderToString(
			<GeoFilterBar
				{...base}
				query={{
					...DEFAULT_QUERY,
					measure: "deaths" as const,
					where: { hazard: { hazardId: "111" } },
				}}
			/>,
		);
		expect(html).toContain("Cluster");
		expect(html).toContain("MH0300 Cyclone (900)");
	});
});

describe("refusal wording (review gap 6)", () => {
	it("explains every known refusal without its code", () => {
		for (const code of [
			"MONETARY_CONVENTIONS_PENDING",
			"MEASURE_NOT_AVAILABLE",
			"MULTI_SERIES_CHOROPLETH",
			"ATT_D_EXCLUDED_FROM_OFFICIAL",
			"PRECISION_BELOW_CEILING",
			"CROSS_VERSION_AGGREGATION_REFUSED",
			"GRAIN_CARDINALITY_EXCEEDED",
			"INTENSIVE_QUANTITY_NOT_SUMMABLE",
		]) {
			const r = refusalText(code, { message: code, resolution: code }, plainT);
			expect(r.title).not.toContain(code);
			expect(r.next.length).toBeGreaterThan(0);
		}
	});
});

describe("shared measure table (review R12)", () => {
	it("gives every geo measure a label, a unit and a family, with no 'record' wording", () => {
		for (const m of GEO_MEASURES) {
			const info = GEO_MEASURE_INFO[m];
			expect(info.label.code).toMatch(/^geoportal\.measure\./);
			expect(`${info.label.msg} ${info.unit.msg}`).not.toMatch(/record/i);
		}
	});
});

import { densityPer1000Km2 } from "~/frontend/geoportal/geoCells";

describe("density rounding for reading", () => {
	it("rounds density per 1,000 km2 and keeps no-area as null", () => {
		expect(densityPer1000Km2(103894, 75389.123)).toBe(1378);
		expect(densityPer1000Km2(1500, 129410)).toBe(11.6);
		expect(densityPer1000Km2(3, 129410)).toBe(0.023);
		expect(densityPer1000Km2(0, 129410)).toBe(0);
		expect(densityPer1000Km2(5, 0)).toBeNull();
	});
});

import {
	applyChips,
	applyPlace,
	lockedFacets,
	periodPresets,
	placeKey,
	querySummary,
	selectedChips,
	withPlace,
	type ChipSet,
} from "~/frontend/geoportal/filterBarState";

describe("shared filter bar state (contract v0.1)", () => {
	const q = { ...DEFAULT_QUERY, measure: "deaths" as const };
	const effects: ChipSet = {
		kind: "effect",
		options: [
			{ id: "deaths", label: { code: "x.deaths", msg: "Deaths" } },
			{ id: "injured", label: { code: "x.injured", msg: "Injured" } },
			{ id: "missing", label: { code: "x.missing", msg: "Missing" } },
		],
	};
	const types: ChipSet = {
		kind: "hip_type",
		options: [
			{ id: "1037", label: "Meteorological", colorToken: "var(--a)", count: 5 },
			{ id: "1038", label: "Geological", colorToken: "var(--b)", count: 0 },
			{ id: "1039", label: "Biological", colorToken: "var(--c)", count: null },
		],
	};

	it("keeps one place facet: a division clears the region and the reverse", () => {
		const withRegion = withPlace(q, { regionId: "r1" });
		expect(withRegion.where.region).toEqual({ regionId: "r1" });
		const withDivision = withPlace(withRegion, { divisionId: "d1" });
		expect(withDivision.where.geo).toEqual({ divisionId: "d1" });
		expect(withDivision.where.region).toBeUndefined();
		const back = applyPlace(withDivision, "r:r2");
		expect(back.where.geo).toBeUndefined();
		expect(placeKey(back)).toBe("r:r2");
		const all = applyPlace(back, "all");
		expect(all.where.geo).toBeUndefined();
		expect(all.where.region).toBeUndefined();
		expect(placeKey(all)).toBe("all");
	});

	it("writes effect chips in option order and removes an empty set", () => {
		const on = applyChips(q, effects, ["missing", "deaths"]);
		expect(on.where.humanEffects).toEqual(["deaths", "missing"]);
		expect(selectedChips(on, effects)).toEqual(["deaths", "missing"]);
		const off = applyChips(on, effects, []);
		expect("humanEffects" in off.where).toBe(false);
	});

	it("keeps one HIPs type chip and clears cluster and hazard", () => {
		const start = {
			...q,
			where: { ...q.where, hazard: { clusterId: "c1", hazardId: "h1" } },
		};
		const on = applyChips(start, types, ["1037"]);
		expect(on.where.hazard).toEqual({ typeId: "1037" });
		expect("hazard" in applyChips(on, types, []).where).toBe(false);
	});

	it("counts presets back from this year inclusive, after All years", () => {
		expect(periodPresets([1, 3, 5, 10], 2026)).toEqual([
			{ id: "all", years: 0, from: "", to: "" },
			{ id: "1", years: 1, from: "2026", to: "2026" },
			{ id: "3", years: 3, from: "2024", to: "2026" },
			{ id: "5", years: 5, from: "2022", to: "2026" },
			{ id: "10", years: 10, from: "2017", to: "2026" },
		]);
	});

	it("names each locked facet", () => {
		expect(
			lockedFacets({
				dimension: "disaster_impact",
				where: { region: { regionId: "r1" }, time: { from: "2020" } },
			}),
		).toEqual(["dimension", "place", "period"]);
		expect(lockedFacets(undefined)).toEqual([]);
	});

	it("states the actual years, the hazard and the basis in the summary", () => {
		const s = querySummary(
			{
				...q,
				where: {
					...q.where,
					time: { from: "2015-03", to: "2024" },
					hazard: { typeId: "1037" },
				},
				scope: { ...q.scope, basis: "provisional" },
			},
			{
				scopeLabel: "Angola",
				hazardTree: {
					types: [{ id: "1037", name: "Meteorological" }],
					clusters: [],
					hazards: [],
				},
			},
			plainT,
		);
		expect(s).toBe(
			"Angola · 2015 to 2024 · Hazard: Meteorological · Basis: provisional",
		);
		expect(querySummary(q, {}, plainT)).toBe(
			"All years · Hazard: all · Basis: published",
		);
	});

	it("renders D1's bar: no dimension toggle or level, chips, Area and status chips", () => {
		const html = renderToString(
			<GeoFilterBar
				query={withPlace(q, { regionId: "r1" })}
				level={1}
				levels={[1]}
				canReview={false}
				onChange={() => {}}
				dimensionControl="none"
				levelControl={false}
				presets={[1, 3, 5, 10]}
				chips={types}
				place={{
					regions: [{ regionId: "r1", name: "North", kind: "planning" }],
				}}
				locked={{ where: { time: { from: "2020" } } }}
				notApplied={["sector: not in the read model"]}
			/>,
		);
		expect(html).not.toContain("geo-dim-label");
		expect(html).not.toContain("Map level");
		expect(html).toContain("Area");
		expect(html).toContain("North");
		expect(html).toContain("Meteorological (5)");
		expect(html).toContain("Biological");
		expect(html).not.toContain("Biological (0)");
		expect(html).toContain("Last 1 year");
		expect(html).toContain("Fixed by this page: period");
		expect(html).toContain("Not applied: sector: not in the read model");
	});
});

import { barCells } from "~/frontend/geoportal/geoCells";
import { symbolStyle } from "~/frontend/geoportal/GeoMap";

describe("bubbles and rounded bars (Alex 2026-10-17)", () => {
	const destroyed = [
		cell("p1", {
			value: 100,
			value_state: "reported",
			plausibility_flagged_records: 2,
		}),
		cell("p2", { value: 40, value_state: "reported" }),
		cell("p3", {}),
	];
	const damaged = [
		cell("p1", {
			value: 300,
			value_state: "reported",
			plausibility_flagged_records: 2,
		}),
		cell("p2", {}),
		cell("p3", {}),
	];
	const parts = barCells([
		{ key: "houses_destroyed", label: "Houses destroyed", cells: destroyed },
		{ key: "houses_damaged", label: "Houses damaged", cells: damaged },
	]);

	it("never adds the parts and keeps a missing part as not reported", () => {
		const p1 = parts.find((c) => c.areaId === "p1")!;
		expect(p1.value).toBe(300); // the largest part, not 400
		expect(p1.recordsFlagged).toBe(2); // one record flagged on both parts
		const p2 = parts.find((c) => c.areaId === "p2")!;
		expect(p2.parts?.map((p) => p.value)).toEqual([40, null]);
		expect(p2.parts?.[1].valueState).toBe("not_reported");
		const p3 = parts.find((c) => c.areaId === "p3")!;
		expect(p3.valueState).toBe("not_reported");
	});

	it("draws bars only where a part is reported, with an empty slot for the missing part", () => {
		const s = resolveMapState(parts, {
			symbol: "bars",
			family: measureFamily("houses_destroyed"),
			scope: { tenant: null, audience: "signed-in" },
		});
		const byId = new Map(s.areas.map((a) => [a.areaId, a]));
		const p2 = byId.get("p2")?.symbol;
		expect(p2?.kind).toBe("bars");
		expect(p2?.kind === "bars" && p2.bars.map((b) => b.ratio)).toEqual([
			40 / 300,
			null,
		]);
		expect(byId.get("p3")?.symbol).toBeNull();
		expect(symbolStyle(byId.get("p3")!, "#f00")).toBeUndefined();
		expect(symbolStyle(byId.get("p2")!, "#f00")?.getRenderer()).toBeTypeOf(
			"function",
		);
		const html = renderToString(
			<GeoLegend legend={s.legend} title="Housing" noRecordsAreas={0} />,
		);
		expect(html).toContain("Houses destroyed");
		expect(html).toContain("A dashed slot is not reported");
		const readout = renderToString(
			<GeoReadout
				name="P2"
				area={byId.get("p2")}
				unit="houses"
				reportedNoun="disaster impacts"
				selected={true}
			/>,
		);
		expect(readout).toContain("Houses destroyed: 40 houses");
		expect(readout).toContain("Houses damaged: not reported");
	});

	it("draws bubbles with a coverage ring and nothing for a missing figure", () => {
		const s = resolveMapState(cells.map(toMapCell), {
			symbol: "bubble",
			family: measureFamily("deaths"),
			scope: { tenant: null, audience: "signed-in" },
		});
		const byId = new Map(s.areas.map((a) => [a.areaId, a]));
		const a = byId.get("a")?.symbol;
		expect(a?.kind).toBe("bubble");
		expect(byId.get("c")?.symbol).toBeNull();
		expect(symbolStyle(byId.get("c")!, "#00f")).toBeUndefined();
		const html = renderToString(
			<GeoLegend legend={s.legend} title="Deaths" noRecordsAreas={0} />,
		);
		expect(html).toContain("Bubble area is proportional to the value");
		expect(html).toContain("Ring: share of records that report this figure");
		expect(html).toContain("<circle");
	});
});

import { resolveLayeredMapState } from "~/utils/mapState";

describe("Alex's default: deaths shading with housing bars on top", () => {
	it("shades by deaths and draws housing bars, each with its own unit", () => {
		const deaths = [
			cell("p1", {
				value: 12,
				value_state: "reported",
				records_reported: 1,
				records_total: 1,
			}),
			cell("p2", {}),
		].map(toMapCell);
		const bars = barCells([
			{
				key: "houses_destroyed",
				label: "Houses destroyed",
				cells: [
					cell("p1", {}),
					cell("p2", { value: 40, value_state: "reported" }),
				],
			},
			{
				key: "houses_damaged",
				label: "Houses damaged",
				cells: [
					cell("p1", {}),
					cell("p2", { value: 10, value_state: "reported" }),
				],
			},
		]).map((c) => ({ areaId: c.areaId, parts: c.parts ?? [] }));
		const s = resolveLayeredMapState(deaths, bars, {
			family: measureFamily("deaths"),
			barsFamily: measureFamily("houses_destroyed"),
			scope: { tenant: null, audience: "signed-in" },
		});
		const byId = new Map(s.areas.map((a) => [a.areaId, a]));
		// Deaths not reported in p2: no shading, but its housing bars still stand.
		expect(byId.get("p2")?.state).toBe("not_reported");
		expect(byId.get("p2")?.symbol?.kind).toBe("bars");
		expect(byId.get("p1")?.symbol).toBeNull();
		const legend = renderToString(
			<GeoLegend
				legend={s.legend}
				title="Deaths"
				noRecordsAreas={0}
				note="Sub-national figures. Not a Sendai indicator value."
			/>,
		);
		expect(legend).toContain("Houses damaged");
		expect(legend).toContain("Not a Sendai indicator value");
		const readout = renderToString(
			<GeoReadout
				name="P2"
				area={byId.get("p2")}
				unit="people"
				partsUnit="houses"
				reportedNoun="disaster impacts"
				selected={true}
			/>,
		);
		expect(readout).toContain("Houses destroyed: 40 houses");
		expect(readout).not.toContain("40 people");
	});
});

import { flattenHazardTree } from "~/frontend/geoportal/GeoFilterBar";

describe("hazard tree from G6 (nested) to the bar's flat lists", () => {
	const nested = {
		types: [
			{
				id: "1042",
				name: "Meteorological and Hydrological",
				recordCountSubtree: 858,
				clusters: [
					{
						id: "c1",
						name: "Flood",
						recordCountSubtree: 600,
						hazards: [
							{
								id: "h1",
								name: "Flash flood",
								code: "MH0600",
								recordCountSubtree: 400,
							},
						],
					},
				],
			},
		],
	};

	it("keeps each node's parent id", () => {
		const flat = flattenHazardTree(nested)!;
		expect(flat.types).toEqual([
			{
				id: "1042",
				name: "Meteorological and Hydrological",
				recordCountSubtree: 858,
			},
		]);
		expect(flat.clusters).toEqual([
			{ id: "c1", name: "Flood", recordCountSubtree: 600, typeId: "1042" },
		]);
		expect(flat.hazards).toEqual([
			{
				id: "h1",
				name: "Flash flood",
				recordCountSubtree: 400,
				clusterId: "c1",
				code: "MH0600",
			},
		]);
		expect(flattenHazardTree(null)).toBeNull();
	});

	it("renders the cluster and hazard selects when a hazard is chosen", () => {
		const html = renderToString(
			<GeoFilterBar
				query={{
					...DEFAULT_QUERY,
					measure: "deaths",
					where: { ...DEFAULT_QUERY.where, hazard: { hazardId: "h1" } },
				}}
				level={1}
				levels={[1]}
				canReview={false}
				onChange={() => {}}
				hazardTree={flattenHazardTree(nested)}
			/>,
		);
		expect(html).toContain("Cluster");
		expect(html).toContain("MH0600");
	});
});

import { GeoSendai } from "~/frontend/geoportal/GeoSendai";

describe("Sendai Framework block in the place panel (I-5)", () => {
	const cumulative = {
		deaths: {
			value: 103894,
			value_state: "reported",
			records_reported: 103,
			records_total: 917,
		},
		missing: {
			value: null,
			value_state: "not_reported",
			records_reported: 0,
			records_total: 917,
		},
		injured: {
			value: 0,
			value_state: "zero_confirmed",
			records_reported: 4,
			records_total: 917,
		},
	};
	const html = (level: number) =>
		renderToString(
			<GeoSendai
				cumulative={cumulative}
				level={level}
				analysisHref="/en/analytics?division=abc"
			/>,
		);

	it("keeps each figure in its own state and never shows a missing one as zero", () => {
		const h = html(1);
		expect(h).toContain("103,894");
		expect(h).toContain("(reported by 103 of 917)");
		expect(h).toContain("No data"); // the shared label for not_reported, never 0
		expect(h).toContain("0 (confirmed)");
		expect(h).toContain("Directly affected");
	});

	it("labels the source, refuses Target C and marks sub-national figures", () => {
		const h = html(1);
		expect(h).toContain("not the official Sendai Framework submission");
		expect(h).toContain("MONETARY_CONVENTIONS_PENDING");
		expect(h).toContain("Sub-national figures. Not a Sendai indicator value.");
		expect(html(0)).not.toContain("Sub-national figures");
		expect(h).toContain('href="/en/analytics?division=abc"');
	});
});

import { placeLevels, yearOptions } from "~/frontend/geoportal/filterBarState";

describe("filter bar row layout for the Analysis page (Alex 2026-10-17)", () => {
	const divisions = [
		{ id: "p1", name: "Gaza", level: 1, parentId: null },
		{ id: "d1", name: "Chokwe", level: 2, parentId: "p1" },
		{ id: "d9", name: "Elsewhere", level: 2, parentId: "p2" },
	];

	it("offers years newest first and shows a level-2 place under its parent", () => {
		expect(yearOptions({ min: 2020, max: 2023 })).toEqual([
			2023, 2022, 2021, 2020,
		]);
		const q = { ...DEFAULT_QUERY };
		expect(placeLevels(withPlace(q, { divisionId: "d1" }), divisions)).toEqual({
			first: "d:p1",
			second: "d:d1",
		});
		expect(placeLevels(withPlace(q, { divisionId: "p1" }), divisions)).toEqual({
			first: "d:p1",
			second: null,
		});
		expect(placeLevels(withPlace(q, { regionId: "r1" }), divisions)).toEqual({
			first: "r:r1",
			second: null,
		});
		expect(placeLevels(q, divisions)).toEqual({ first: "all", second: null });
	});

	it("renders the row in the mock-up's order, with the page's button at the end", () => {
		const html = renderToString(
			<GeoFilterBar
				layout="row"
				query={withPlace(
					{ ...DEFAULT_QUERY, measure: "deaths" },
					{ divisionId: "d1" },
				)}
				level={1}
				levels={[1, 2]}
				canReview={false}
				onChange={() => {}}
				dimensionControl="none"
				measures={null}
				levelControl={false}
				years={{ min: 2000, max: 2024 }}
				hazardTree={{ types: [], clusters: [], hazards: [] }}
				place={{ divisions }}
				end={<button type="button">Sendai Framework Monitoring</button>}
			/>,
		);
		const order = [
			"From year",
			"To year",
			"HIPs type",
			"HIPs cluster",
			"Hazard",
			"Place, level 1",
			"Level 2",
			"Sendai Framework Monitoring",
		];
		const positions = order.map((label) => html.indexOf(label));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		expect(html).not.toContain("Last 10 years"); // no presets in the row
		expect(html).not.toContain("Map level");
	});
});
