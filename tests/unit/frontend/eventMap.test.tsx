import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventMap, toEventMapArea } from "~/frontend/analytics/dashboard/panels/events/EventMap";
import type { ViewContext } from "~/frontend/context";
import type { EventMapPayload } from "~/utils/dashboard/eventMap";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
// Shaped like the loader's answer (bb29b1fa); figures invented for the test.
const MAP: EventMapPayload = {
	dimension: "disaster_event",
	areas: [
		{ divisionId: "a", name: "Luanda", geojson: square, labelPoint: [0.5, 0.5], events: 12, fromRecords: 4 },
		{ divisionId: "b", name: "Cunene", geojson: square, labelPoint: [0.5, 0.5], events: 0, fromRecords: 0 },
		{ divisionId: "c", name: "Namibe", geojson: null, labelPoint: null, events: 3, fromRecords: 0 },
	],
	unplacedEvents: 7,
	unplacedReasons: { "No division on the event or its records": 7 },
	legend: { symbol: "Number of events", note: "An event in several provinces counts in each, so provinces do not add up." },
	meta: { method: "Events per division", notApplied: [] },
};
const words = { none: "No events recorded", fromRecords: (n: number) => `${n} placed through their records` };

describe("event map M0", () => {
	it("sizes a bubble by the event count and notes events placed through records", () => {
		const a = toEventMapArea(MAP.areas[0], words);
		expect(a.total).toBe(12);
		expect(a.valueState).toBe("reported");
		expect(a.description).toBe("4 placed through their records");
	});

	it("draws no bubble for a division with no event, and says so", () => {
		const b = toEventMapArea(MAP.areas[1], words);
		expect(b.total).toBeNull();
		expect(b.description).toBe("No events recorded");
	});

	it("counts what the map cannot show, and lists every division in the table", () => {
		const html = text(renderToString(<EventMap ctx={ctx} map={MAP} scope={{ tenant: "Angola", audience: "signed-in" }} />));
		expect(html).toContain("An event in several provinces counts in each, so provinces do not add up.");
		expect(html).toContain("7 events in scope could not be placed on the map: No division on the event or its records (7).");
		expect(html).toContain("Not on the map (no boundary held):</span> Namibe (3)");
		expect(html).toContain("Map data as a table");
		expect(html).toContain("No events recorded");
	});
});
