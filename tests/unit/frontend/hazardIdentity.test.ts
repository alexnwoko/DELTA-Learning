import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataTokens } from "~/utils/designTokens.generated";
import { FAMILY_RAMPS } from "~/utils/mapState";
import { HIP_TYPE_IDENTITY, hazardColour, hazardColourVar, hazardIdentity } from "~/utils/hazardIdentity";

const ROOT = process.cwd();
const tokens = JSON.parse(readFileSync(join(ROOT, "design-tokens/data/data.json"), "utf8")).data.hazard;
const brand = (name: string) =>
	JSON.parse(readFileSync(join(ROOT, `design-tokens/brand/${name}.json`), "utf8")).brand;

const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};

describe("hazard identity colours (NFR-094)", () => {
	it("cover the eight HIPs 2025 types and unclassified, one distinct colour each", () => {
		const values = Object.values(dataTokens.hazard);
		expect(Object.keys(dataTokens.hazard)).toHaveLength(9);
		expect(new Set(values).size).toBe(9);
		expect(Object.keys(HIP_TYPE_IDENTITY).sort()).toEqual(
			["1037", "1038", "1039", "1040", "1041", "1042", "1043", "1044"],
		);
	});

	it("record the hip_class id each token stands for", () => {
		for (const [id, identity] of Object.entries(HIP_TYPE_IDENTITY)) {
			const kebab = identity.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
			expect(tokens[kebab].$extensions["org.undrr.delta"].hipClassId, identity).toBe(id);
		}
	});

	it("are never a series colour from a data ramp", () => {
		const ramp = new Set(Object.values(FAMILY_RAMPS).flat());
		for (const value of Object.values(dataTokens.hazard)) expect(ramp.has(value), value).toBe(false);
	});

	it.each(["neutral", "delta"])("reach 3:1 on the %s surfaces (WCAG 1.4.11)", (name) => {
		const b = brand(name);
		for (const [identity, value] of Object.entries(dataTokens.hazard)) {
			for (const surface of ["surface", "surface-subtle"]) {
				const r = ratio(value, b[surface].$value);
				expect(r, `${identity} on ${surface}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("map ids to identities, colours and CSS variables", () => {
		expect(hazardIdentity("1042")).toBe("meteorologicalHydrological");
		expect(hazardIdentity("9999")).toBe("unclassified");
		expect(hazardIdentity(null)).toBe("unclassified");
		expect(hazardColour("1041")).toBe(dataTokens.hazard.geological);
		expect(hazardColourVar("1042")).toBe("var(--delta-data-hazard-meteorological-hydrological)");
		expect(hazardColourVar(undefined)).toBe("var(--delta-data-hazard-unclassified)");
	});
});
