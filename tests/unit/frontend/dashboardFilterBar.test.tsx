import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chipsFor, flattenHazardTree, measuresFor, type NestedHazardTree } from "~/frontend/analytics/dashboard/filterDefinitions";
import { GeoFilterBar } from "~/frontend/geoportal/GeoFilterBar";
import { plainT } from "~/frontend/geoportal/i18n";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

const text = (html: string) => html.replace(/<!-- -->/g, "");
// Shaped like getHazardTree's answer: clusters in types, hazards in clusters.
const NESTED: NestedHazardTree = {
	types: [
		{ id: "1042", name: "Meteorological and Hydrological", recordCountSubtree: 120, clusters: [
			{ id: "c1", typeId: "1042", name: "Flood", recordCountSubtree: 100, hazards: [
				{ id: "h1", clusterId: "c1", code: "MH0600", name: "Flash flood", recordCountSubtree: 60 },
			] },
		] },
		{ id: "1041", name: "Geological", recordCountSubtree: 0, clusters: [] },
	],
};

describe("hazard tree for the bar", () => {
	it("flattens types, clusters and hazards with their parent ids", () => {
		const tree = flattenHazardTree(NESTED);
		expect(tree.types.map((x) => x.id)).toEqual(["1042", "1041"]);
		expect(tree.clusters).toEqual([{ id: "c1", name: "Flood", recordCountSubtree: 100, typeId: "1042" }]);
		expect(tree.hazards).toEqual([{ id: "h1", name: "Flash flood", recordCountSubtree: 60, clusterId: "c1", code: "MH0600" }]);
	});
});

describe("filters per view (D1 brief section 2)", () => {
	const tree = flattenHazardTree(NESTED);

	it("event views: HIPs type chips in identity colours, no counts, no measure select", () => {
		for (const v of ["hazardous_event", "disaster_event"] as const) {
			const chips = chipsFor(v, { hazardTree: tree });
			expect(chips?.kind).toBe("hip_type");
			if (chips?.kind !== "hip_type") throw new Error("kind");
			expect(chips.options[0].colorToken).toBe("var(--delta-data-hazard-meteorological-hydrological)");
			expect(chips.options.every((o) => o.count === null)).toBe(true);
			expect(measuresFor(v)).toBeNull();
		}
	});

	it("Disaster impact: the six human-effect chips and the headline measures", () => {
		const chips = chipsFor("disaster_impact", { hazardTree: tree });
		expect(chips?.kind).toBe("effect");
		expect(chips?.options.map((o) => o.id)).toEqual(["deaths", "injured", "missing", "affected_direct", "affected_indirect", "displaced"]);
		expect(measuresFor("disaster_impact")?.map((m) => m.id)).toEqual(["deaths", "missing", "injured", "affected_direct", "displaced"]);
	});

	it("Sectors: sector chips from the payload, none without sectors", () => {
		expect(chipsFor("sectors", { hazardTree: tree, sectors: [{ id: "s1", label: "Agriculture" }] })).toEqual({
			kind: "sector",
			options: [{ id: "s1", label: "Agriculture" }],
		});
		expect(chipsFor("sectors", { hazardTree: tree })).toBeNull();
	});
});

describe("the shared bar as the dashboard sets it up", () => {
	const html = text(
		renderToString(
			<GeoFilterBar
				query={DEFAULT_QUERY}
				level={1}
				levels={[1]}
				canReview={false}
				onChange={() => {}}
				hazardTree={flattenHazardTree(NESTED)}
				dimensionControl="none"
				measures={measuresFor("disaster_impact")}
				chips={chipsFor("disaster_impact", { hazardTree: null })}
				place={{ divisions: [{ id: "d1", name: "Luanda", level: 1, parentId: null }], regions: [] }}
				levelControl={false}
				presets={[1, 3, 5, 10]}
				notApplied={["region"]}
				summary={false}
				t={plainT}
			/>,
		),
	);

	it("shows no dimension toggle, no map level and no second basis control", () => {
		expect(html).not.toMatch(/Hazardous events<\/[^>]*>.*Disaster impact/s);
		expect(html).not.toContain("Map level");
		expect(html).not.toMatch(/>\s*Provisional\s*</);
	});

	it("offers the effect chips, the Area control and the 1, 3, 5 and 10 year presets", () => {
		expect(html).toContain("Directly affected");
		expect(html).toContain("Area");
		for (const n of [1, 3, 5, 10]) expect(html).toMatch(new RegExp(`\\b${n}\\b`));
		expect(html).toContain("region");
	});
});
