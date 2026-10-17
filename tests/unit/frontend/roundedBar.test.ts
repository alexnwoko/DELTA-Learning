import { describe, expect, it } from "vitest";
import { BAR_RADIUS, roundedBarPath } from "~/frontend/charts/roundedBar";

describe("roundedBarPath (rounded far end, flat baseline)", () => {
	it("rounds the top of a column and keeps its base flat", () => {
		const d = roundedBarPath(10, 20, 30, 100, "up");
		expect(d).toBe("M10,120V26Q10,20 16,20H34Q40,20 40,26V120Z");
		// The base runs straight from (40,120) back to the start at (10,120).
		expect(d.endsWith("V120Z")).toBe(true);
	});

	it("rounds the right end of a horizontal bar and keeps its start flat", () => {
		expect(roundedBarPath(0, 0, 100, 12, "right")).toBe("M0,0H94Q100,0 100,6V6Q100,12 94,12H0Z");
	});

	it("mirrors for right-to-left layouts", () => {
		expect(roundedBarPath(0, 0, 100, 12, "left")).toBe("M100,0H6Q0,0 0,6V6Q0,12 6,12H100Z");
	});

	it("shrinks the radius to fit a thin or short bar, and draws nothing for an empty one", () => {
		expect(BAR_RADIUS).toBe(6);
		expect(roundedBarPath(0, 0, 4, 50, "up")).toBe("M0,50V2Q0,0 2,0H2Q4,0 4,2V50Z"); // r = width / 2
		expect(roundedBarPath(0, 47, 20, 3, "up")).toContain("V50Q0,47 3,47"); // r = height
		expect(roundedBarPath(0, 0, 0, 10, "up")).toBe("");
	});
});
