import { afterEach, describe, it, expect } from "vitest";
import { isSelfHostedTileUrl } from "~/utils/basemap";

// TR-166, SEC-20: only a self-hosted basemap on the DELTA origin is drawn.

const origin = "https://delta.example.org";

describe("isSelfHostedTileUrl", () => {
	it("accepts root-relative and same-origin tile templates", () => {
		expect(isSelfHostedTileUrl("/tiles/{z}/{x}/{y}.png", origin)).toBe(true);
		expect(
			isSelfHostedTileUrl(
				"https://delta.example.org/tiles/{z}/{x}/{y}.png",
				origin,
			),
		).toBe(true);
	});

	it("refuses third-party, protocol-relative and empty URLs", () => {
		expect(
			isSelfHostedTileUrl(
				"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
				origin,
			),
		).toBe(false);
		expect(
			isSelfHostedTileUrl("//tile.openstreetmap.org/{z}/{x}/{y}.png", origin),
		).toBe(false);
		expect(isSelfHostedTileUrl("", origin)).toBe(false);
		expect(isSelfHostedTileUrl(undefined, origin)).toBe(false);
		expect(
			isSelfHostedTileUrl("https://delta.example.org.evil.com/t", origin),
		).toBe(false);
	});

	it("refuses an absolute URL when the origin is unknown", () => {
		expect(isSelfHostedTileUrl("https://delta.example.org/t", undefined)).toBe(
			false,
		);
	});
});

// I-3 switcher (Alex 2026-10-16): the reader chooses among configured
// layers; third-party providers are an allow-list pinned to one host each.
import {
	isAllowedThirdPartyUrl,
	printableBasemap,
	selectableBasemaps,
	type BasemapLayer,
} from "~/utils/basemap";
import { basemapLayers } from "~/utils/basemap.server";

describe("basemap switcher", () => {
	const saved = { ...process.env };
	afterEach(() => {
		process.env = { ...saved };
	});
	const keys = [
		"BASEMAP_TILE_DIR",
		"BASEMAP_TILE_URL",
		"BASEMAP_SATELLITE_TILE_DIR",
		"BASEMAP_GOOGLE_KEY",
		"BASEMAP_GOOGLE_REGION",
		"BASEMAP_MAPBOX_TOKEN",
		"BASEMAP_MAPBOX_LOGO",
	];
	const clear = () => keys.forEach((k) => delete process.env[k]);

	it("offers no third-party layer without a key", () => {
		clear();
		process.env.BASEMAP_TILE_DIR = "/data/basemap";
		const layers = basemapLayers("https://delta.example");
		expect(layers.map((l) => l.id)).toEqual(["street"]);
		expect(layers.some((l) => l.thirdParty)).toBe(false);
	});

	it("puts the self-hosted street map first, before any third party", () => {
		clear();
		process.env.BASEMAP_TILE_DIR = "/data/basemap";
		process.env.BASEMAP_SATELLITE_TILE_DIR = "/data/satellite";
		process.env.BASEMAP_GOOGLE_KEY = "k";
		process.env.BASEMAP_GOOGLE_REGION = "mz";
		process.env.BASEMAP_MAPBOX_TOKEN = "t";
		process.env.BASEMAP_MAPBOX_LOGO = "/assets/mapbox-logo.svg";
		const layers = basemapLayers("https://delta.example", "pt");
		expect(layers.map((l) => l.id)).toEqual([
			"street",
			"satellite",
			"google",
			"mapbox",
		]);
		expect(layers[0].thirdParty).toBe(false);
		expect(layers.find((l) => l.id === "google")?.google?.region).toBe("MZ");
		expect(layers.find((l) => l.id === "satellite")?.attribution).toContain(
			"ESA WorldCover",
		);
		expect(layers.find((l) => l.id === "mapbox")?.attribution).toContain(
			"Improve this map",
		);
	});

	it("needs a region for Google and the self-hosted logo for Mapbox", () => {
		clear();
		process.env.BASEMAP_GOOGLE_KEY = "k";
		process.env.BASEMAP_MAPBOX_TOKEN = "t";
		expect(basemapLayers("https://delta.example")).toEqual([]);
		process.env.BASEMAP_MAPBOX_LOGO = "https://cdn.example/logo.svg";
		expect(basemapLayers("https://delta.example")).toEqual([]);
	});

	it("refuses a provider outside the allow-list and any other host", () => {
		expect(
			isAllowedThirdPartyUrl(
				"esri",
				"https://server.arcgisonline.com/{z}/{y}/{x}",
			),
		).toBe(false);
		expect(
			isAllowedThirdPartyUrl(
				"google",
				"https://evil.example/v1/2dtiles/{z}/{x}/{y}",
			),
		).toBe(false);
		expect(
			isAllowedThirdPartyUrl(
				"google",
				"http://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}",
			),
		).toBe(false);
		expect(
			isAllowedThirdPartyUrl(
				"mapbox",
				"https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}",
			),
		).toBe(true);
	});

	it("offers public pages self-hosted layers only", () => {
		const l = (id: BasemapLayer["id"], thirdParty: boolean) =>
			({ id, thirdParty }) as BasemapLayer;
		const all = [l("street", false), l("google", true)];
		expect(selectableBasemaps(all, "public").map((x) => x.id)).toEqual([
			"street",
		]);
		expect(selectableBasemaps(all, "signed-in").map((x) => x.id)).toEqual([
			"street",
			"google",
		]);
	});

	it("never prints a third-party layer", () => {
		const l = (id: BasemapLayer["id"], thirdParty: boolean) =>
			({ id, thirdParty }) as BasemapLayer;
		expect(
			printableBasemap([l("street", false), l("google", true)], "google"),
		).toBe("street");
		expect(printableBasemap([l("google", true)], "google")).toBeNull();
		expect(printableBasemap([l("satellite", false)], "satellite")).toBe(
			"satellite",
		);
		expect(printableBasemap([l("street", false)], null)).toBeNull();
	});
});
