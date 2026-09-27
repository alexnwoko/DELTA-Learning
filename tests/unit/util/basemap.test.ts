import { describe, expect, it } from "vitest";
import {
	basemapConfigForInlineScript,
	getBasemapConfig,
	setBasemapConfig,
} from "~/utils/basemap";
import {
	OSM_ATTRIBUTION,
	OSM_STANDARD_TILE_URL,
	resolveBasemapConfig,
} from "~/utils/basemap.server";

describe("resolveBasemapConfig", () => {
	it("uses BASEMAP_TILE_URL when set, with OSM attribution by default", () => {
		const config = resolveBasemapConfig({
			NODE_ENV: "production",
			BASEMAP_TILE_URL: "https://tiles.example.org/styles/delta/{z}/{x}/{y}.png",
		} as NodeJS.ProcessEnv);
		expect(config).toEqual({
			url: "https://tiles.example.org/styles/delta/{z}/{x}/{y}.png",
			attribution: OSM_ATTRIBUTION,
			maxZoom: 19,
		});
	});

	it("uses BASEMAP_ATTRIBUTION and BASEMAP_MAX_ZOOM when set", () => {
		const config = resolveBasemapConfig({
			NODE_ENV: "production",
			BASEMAP_TILE_URL: "https://tiles.example.org/{z}/{x}/{y}.png",
			BASEMAP_ATTRIBUTION: "&copy; Protomaps &copy; OpenStreetMap",
			BASEMAP_MAX_ZOOM: "14",
		} as NodeJS.ProcessEnv);
		expect(config?.attribution).toBe("&copy; Protomaps &copy; OpenStreetMap");
		expect(config?.maxZoom).toBe(14);
	});

	it("falls back to OSM standard tiles in development", () => {
		const config = resolveBasemapConfig({
			NODE_ENV: "development",
		} as NodeJS.ProcessEnv);
		expect(config?.url).toBe(OSM_STANDARD_TILE_URL);
		expect(config?.attribution).toBe(OSM_ATTRIBUTION);
	});

	it("returns no basemap in production when unset", () => {
		expect(
			resolveBasemapConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
		).toBeNull();
		expect(
			resolveBasemapConfig({
				NODE_ENV: "production",
				BASEMAP_TILE_URL: "  ",
			} as NodeJS.ProcessEnv),
		).toBeNull();
	});

	it("never calls CARTO", () => {
		for (const env of ["development", "production", "test"]) {
			const config = resolveBasemapConfig({ NODE_ENV: env } as NodeJS.ProcessEnv);
			expect(config?.url ?? "").not.toContain("cartocdn");
		}
	});
});

describe("basemap config store", () => {
	it("stores and clears the config", () => {
		setBasemapConfig({ url: "u", attribution: "a", maxZoom: 3 });
		expect(getBasemapConfig()).toEqual({ url: "u", attribution: "a", maxZoom: 3 });
		setBasemapConfig(undefined);
		expect(getBasemapConfig()).toBeNull();
	});

	it("escapes '<' for inline scripts", () => {
		const out = basemapConfigForInlineScript({
			url: "https://x/{z}/{x}/{y}.png",
			attribution: '</script><a href="https://www.openstreetmap.org/copyright">OSM</a>',
			maxZoom: 19,
		});
		expect(out).not.toContain("<");
		expect(JSON.parse(out).attribution).toContain("</script>");
	});

	it("serialises no basemap as null", () => {
		expect(basemapConfigForInlineScript(null)).toBe("null");
	});
});
