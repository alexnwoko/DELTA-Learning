import { describe, it, expect } from "vitest";
import { sumReported } from "~/backend.server/models/analytics/disaster-events-cost-calculator";

// Null is not zero: an event cost total is empty when nothing is reported.
describe("sumReported", () => {
	it("is null when no value is reported", () => {
		expect(sumReported([])).toBeNull();
		expect(sumReported([null, undefined, ""])).toBeNull();
	});
	it("keeps a reported zero as 0", () => {
		expect(sumReported([null, "0"])).toBe(0);
	});
	it("adds reported values and skips missing ones", () => {
		expect(sumReported(["1200.5", null, 300, "x"])).toBe(1500.5);
	});
});
