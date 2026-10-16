import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	LEAFLET_CSS,
	LEAFLET_DRAW_CSS,
	LEAFLET_DRAW_JS,
	LEAFLET_JS,
	MAP_MARKER_ICON,
	absoluteAssetUrl,
} from "~/utils/leafletAssets";
import { previewMap } from "~/components/ContentRepeater/controls/mapper";

const ROOT = process.cwd();
const THIRD_PARTY = /unpkg\.com|cdnjs\.cloudflare\.com|maps\.google\.com/;

// Leaflet maps owned by the frontend lane. MapChart.tsx (Analytics) and
// SpatialFootprintsMapViewer.tsx (ownership pending) switch separately.
const OWNED_MAP_FILES = [
	"app/components/SpatialFootprintMapViewer.tsx",
	"app/components/ContentRepeater/index.tsx",
	"app/components/ContentRepeater/controls/mapper/index.tsx",
	"app/frontend/disaster-event/DisasterEventReviewStep.tsx",
];

afterEach(() => {
	delete (globalThis as any).window;
});

describe("self-hosted Leaflet assets", () => {
	it.each([LEAFLET_JS, LEAFLET_CSS, LEAFLET_DRAW_JS, LEAFLET_DRAW_CSS, MAP_MARKER_ICON])(
		"%s is served from public/",
		(path) => {
			expect(path.startsWith("/assets/")).toBe(true);
			expect(existsSync(join(ROOT, "public", path))).toBe(true);
		},
	);

	it("vendors the pinned versions with their licences", () => {
		const leaflet = readFileSync(join(ROOT, "public", LEAFLET_JS), "utf8");
		const draw = readFileSync(join(ROOT, "public", LEAFLET_DRAW_JS), "utf8");
		expect(leaflet).toContain("Leaflet 1.9.4");
		expect(draw).toContain("Leaflet.draw 1.0.4");
		for (const dir of ["leaflet/1.9.4", "leaflet-draw/1.0.4"]) {
			expect(existsSync(join(ROOT, "public/assets/vendor", dir, "LICENSE"))).toBe(true);
		}
	});

	it.each(OWNED_MAP_FILES)("%s loads nothing from a third-party origin", (file) => {
		expect(readFileSync(join(ROOT, file), "utf8")).not.toMatch(THIRD_PARTY);
	});

	it("gives the preview tabs absolute URLs on DELTA's origin", () => {
		(globalThis as any).window = { location: { origin: "https://delta.example.org" } };
		expect(absoluteAssetUrl(LEAFLET_JS)).toBe(`https://delta.example.org${LEAFLET_JS}`);

		const written: string[] = [];
		(globalThis as any).window.open = () => ({
			document: { write: (h: string) => written.push(h), close: () => {} },
		});
		previewMap("[]");
		const mapper = written.join("");
		expect(mapper).toContain(`https://delta.example.org${LEAFLET_JS}`);
		expect(mapper).not.toMatch(THIRD_PARTY);
	});
});
