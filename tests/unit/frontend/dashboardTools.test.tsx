// Analysis trial helpers (Alex, 2026-10-22): UX-6 saved views, UX-7 shortcuts.
import { describe, expect, it } from "vitest";
import { readSavedViews, saveView, shortcutFor } from "~/frontend/analytics/dashboard/DashboardTools";
import { UX } from "~/frontend/uxFeatures";

const memory = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("UX switches", () => {
	it("has all eight on for the trial, each switchable by number", () => {
		expect(Object.keys(UX).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(Object.values(UX).every(Boolean)).toBe(true);
	});
});

describe("UX-6 saved views", () => {
	it("saves newest first, replaces a view of the same name, and keeps 20 at most", () => {
		const s = memory();
		saveView(s, { name: "Floods", href: "/en/analytics?hazard=fl" });
		saveView(s, { name: "Tete", href: "/en/analytics?division=t" });
		saveView(s, { name: "Floods", href: "/en/analytics?hazard=fl&from=2010" });
		expect(readSavedViews(s).map((v) => v.name)).toEqual(["Floods", "Tete"]);
		expect(readSavedViews(s)[0].href).toContain("from=2010");
		for (let i = 0; i < 25; i++) saveView(s, { name: `v${i}`, href: "/en/analytics" });
		expect(readSavedViews(s)).toHaveLength(20);
	});

	it("reads nothing from broken or missing storage", () => {
		expect(readSavedViews(null)).toEqual([]);
		expect(readSavedViews({ getItem: () => "{not json" })).toEqual([]);
		expect(saveView(null, { name: "x", href: "/" })).toBe(false);
	});
});

describe("UX-7 keyboard shortcuts", () => {
	const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
	it("maps 1-4, / and ?, and nothing else", () => {
		expect(shortcutFor(key("3"), null)).toBe("3");
		expect(shortcutFor(key("/"), null)).toBe("/");
		expect(shortcutFor(key("?"), null)).toBe("?");
		expect(shortcutFor(key("5"), null)).toBeNull();
		expect(shortcutFor(key("1", { metaKey: true }), null)).toBeNull();
	});

	it("never fires while the reader types in a field", () => {
		expect(shortcutFor(key("1"), { tagName: "INPUT" } as unknown as EventTarget)).toBeNull();
		expect(shortcutFor(key("/"), { tagName: "SELECT" } as unknown as EventTarget)).toBeNull();
	});
});
