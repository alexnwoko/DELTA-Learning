import { describe, it, expect, vi } from "vitest";

vi.mock("~/db.server", () => ({ dr: {} }));
import { geometryCacheControl } from "~/backend.server/handlers/geo";
import { labelMinZoom } from "~/backend.server/models/geo/tenantExtent";

describe("geometry cache rule (NFR-113)", () => {
	it("caches a URL for a year only when it carries the current version", () => {
		const u = (q: string) => new URL(`http://x/en/api/geo/world${q}`);
		expect(geometryCacheControl(u("?v=abc"), "abc")).toBe(
			"private, max-age=31536000, immutable",
		);
		expect(geometryCacheControl(u("?v=old"), "abc")).toBe("private, no-cache");
		expect(geometryCacheControl(u(""), "abc")).toBe("private, no-cache");
		expect(geometryCacheControl(u("?v=abc"), null)).toBe("private, no-cache");
	});
});

describe("country name ranking", () => {
	it("names large countries first and small islands only when zoomed in", () => {
		expect(labelMinZoom(9_800_000)).toBe(0);
		expect(labelMinZoom(800_000)).toBe(2);
		expect(labelMinZoom(65_000)).toBe(3);
		expect(labelMinZoom(10_000)).toBe(4);
		expect(labelMinZoom(120)).toBe(5);
	});
});
