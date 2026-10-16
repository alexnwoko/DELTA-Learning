import { describe, it, expect } from "vitest";
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
