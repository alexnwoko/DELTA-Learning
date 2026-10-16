import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataTokens } from "~/utils/designTokens.generated";
import { FAMILY_RAMPS, PLAUSIBILITY_MARKER, STATE_ENCODING } from "~/utils/mapState";
import { loadMangrove, resolveMangrove } from "../../../design-tokens/scripts/mangroveResolve.mjs";

const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const camel = (s: string) => s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());

describe("data-layer tokens (FE-Tokens-01)", () => {
	// One source: until Analytics switches mapState.ts to the generated module,
	// the two must agree value for value (no colour changes in ADR-19 item 0).
	it("match STATE_ENCODING in mapState.ts", () => {
		for (const [state, enc] of Object.entries(STATE_ENCODING)) {
			const token = dataTokens.state[camel(state) as keyof typeof dataTokens.state];
			expect(token, state).toEqual({
				fill: enc.fill,
				stroke: enc.stroke,
				strokeWidth: enc.strokeWidth,
				dash: enc.dashArray ?? "none",
				pattern: enc.pattern,
			});
		}
		expect(Object.keys(dataTokens.state)).toHaveLength(Object.keys(STATE_ENCODING).length);
	});

	it("match FAMILY_RAMPS and PLAUSIBILITY_MARKER in mapState.ts", () => {
		expect(dataTokens.ramp).toEqual(FAMILY_RAMPS);
		expect(dataTokens.map.plausibilityMarker).toEqual({
			stroke: PLAUSIBILITY_MARKER.stroke,
			strokeWidth: PLAUSIBILITY_MARKER.strokeWidth,
		});
	});

	it("carry Geoportal's map states with today's GeoMap.tsx values", () => {
		expect(dataTokens.map.noRecords).toEqual({ fill: "#f9fafb", stroke: "#d1d5db", strokeWidth: 0.8 });
		expect(dataTokens.map.areaBoundary).toEqual({ stroke: "#ffffff", strokeWidth: 0.8 });
		expect(dataTokens.map.selectedOutline).toEqual({ stroke: "#111827", strokeWidth: 2.5 });
	});

	it("carry the MapChart map states with today's MapChart.tsx values", () => {
		expect("shadedOutline" in dataTokens.map, "retired: one map look (Alex, 2026-10-16)").toBe(false);
		expect(dataTokens.map.notAppliedNote).toEqual({ border: "#b45309", borderWidth: 3, background: "#fff7ed" });
		expect(dataTokens.map.canvas).toEqual({ background: "#f3f4f6" });
	});

	it("carry the review-flag chip (C30)", () => {
		expect(dataTokens.flag.reviewChip).toEqual({ background: "#fef3c7", text: "#78350f" });
	});

	it("keep no-records and not-reported as separate tokens (TR-076)", () => {
		expect(dataTokens.map.noRecords).toBeDefined();
		expect(dataTokens.state.notReported).toBeDefined();
		const source = readJson("design-tokens/data/data.json");
		expect(source.data.map["no-records"].$description).toMatch(/never merge/i);
		expect(source.data.state["not-reported"].$description).toMatch(/never merge/i);
	});

	it("generated outputs agree with the DTCG source (run yarn build:tokens)", () => {
		const source = readJson("design-tokens/data/data.json").data;
		const css = readFileSync(join(ROOT, "app/styles/tokens/data.css"), "utf8");
		const walk = (node: any, path: string[]) => {
			if (node && typeof node === "object" && "$value" in node) {
				expect(css, path.join(".")).toContain(`--delta-data-${path.join("-")}: ${node.$value};`);
				let generated: any = dataTokens;
				const [group, ...rest] = path;
				generated = generated[group];
				if (group === "ramp") {
					expect(generated[rest[0]][Number(rest[1]) - 1], path.join(".")).toBe(node.$value);
				} else {
					for (const part of rest) generated = generated[camel(part)];
					expect(generated, path.join(".")).toBe(node.$value);
				}
				return;
			}
			for (const [key, child] of Object.entries(node ?? {})) {
				if (!key.startsWith("$")) walk(child, [...path, key]);
			}
		};
		walk(source, []);
	});
});

describe("brand-layer tokens (Mangrove v2.1.0)", () => {
	const dir = join(ROOT, "design-tokens/brand/mangrove-v2.1.0");
	it.each(["neutral", "delta"])("%s matches the pinned Mangrove files", (brand) => {
		const tokens = readJson(`design-tokens/brand/${brand}.json`).brand;
		const tree = loadMangrove(dir, brand);
		for (const [name, token] of Object.entries<any>(tokens)) {
			const path = token.$extensions["org.undrr.delta"].mangrove.path;
			const expected = resolveMangrove(tree, path);
			const actual =
				typeof token.$value === "object" ? `${token.$value.value}${token.$value.unit}` : token.$value;
			expect(actual, `${brand} ${name} <- ${path}`).toBe(expected);
		}
	});

	it("builds neutral as the default and DELTA under [data-brand]", () => {
		const css = readFileSync(join(ROOT, "app/styles/tokens/brand.css"), "utf8");
		expect(css).toMatch(/:root \{[^}]*--delta-brand-interactive: #1a1a1a;/s);
		expect(css).toMatch(/\[data-brand="delta"\] \{[^}]*--delta-brand-interactive: #004f91;/s);
	});
});
