import { describe, it, expect } from "vitest";
import { UN_MAP_DISCLAIMER } from "~/components/MapChart";

// Alex, 2026-10-18: the UN short-form disclaimer, word for word, on every
// map that shows boundaries (same text as the geoportal's).
describe("UN map disclaimer", () => {
	it("keeps the exact wording", () => {
		expect(UN_MAP_DISCLAIMER).toBe(
			"The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.",
		);
	});
});
