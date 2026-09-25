import { describe, it, expect } from "vitest";
import { derivePresence } from "~/backend.server/models/human_effects/category_presence";

// Presence semantics (solution pack decision 3, P-1): true = Yes (a value
// row exists, including a stored 0), false = No (confirmed none, kept only
// when explicitly stored), null = not specified.
const defs = [
	{ role: "metric", jsName: "direct" },
	{ role: "metric", jsName: "indirect" },
	{ role: "dimension", jsName: "sex" },
] as any[];

describe("derivePresence", () => {
	it("sets true where any row holds a value, including a stored zero", () => {
		const rows = [
			{ direct: 12, indirect: null },
			{ direct: null, indirect: 0 },
		];
		expect(derivePresence(defs, rows, {})).toEqual({
			direct: true,
			indirect: true,
		});
	});

	it("leaves a category with no value unspecified, never false", () => {
		const rows = [{ direct: 5, indirect: null }];
		expect(
			derivePresence(defs, rows, { direct: null, indirect: null }),
		).toEqual({ direct: true, indirect: null });
	});

	it("keeps an explicitly stored No when no value exists", () => {
		expect(derivePresence(defs, [], { direct: false, indirect: null })).toEqual(
			{
				direct: false,
				indirect: null,
			},
		);
	});

	it("drops a stale Yes once the values are cleared", () => {
		expect(derivePresence(defs, [], { direct: true, indirect: true })).toEqual({
			direct: null,
			indirect: null,
		});
	});

	it("replaces a stored No with Yes when a value is entered", () => {
		expect(
			derivePresence(defs, [{ direct: 3, indirect: null }], { direct: false }),
		).toEqual({ direct: true, indirect: null });
	});
});
