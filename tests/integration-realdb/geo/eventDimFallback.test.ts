import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { resolveGeoRequest, type GeoRequestContext } from "~/backend.server/handlers/geo";

// The Geoportal's event buttons (Alex, 2026-10-26): the page asks every
// panel with the event view's query (dim=disaster_event&measure=events).
// A disaster-impact-only view (the place panel) must answer with the event
// dimension and its measure named and dropped, not refuse with status 200,
// which the page then drew as a place panel and crashed.

function resolve(query: string, opts: { requireMeasure: boolean; eventDimensions?: boolean }) {
	const url = new URL(`http://localhost/en/api/geo/place/country/dossier?${query}`);
	const ctx: GeoRequestContext = {
		countryAccountsId: randomUUID(),
		lang: "en",
		url,
		request: new Request(url),
		viaApiKey: true,
	};
	return resolveGeoRequest(ctx, { requireLevel: false, ...opts });
}

describe("an event view's query on a disaster impact view", () => {
	for (const dim of ["disaster_event", "hazardous_event"]) {
		it(`answers for ${dim} with the measure named and dropped`, async () => {
			const req = await resolve(`dim=${dim}&measure=events&level=1`, { requireMeasure: false });
			expect(req.query.dimension).toBe("disaster_impact");
			expect(req.query.measure).toBeUndefined();
			expect(req.notApplied).toContain("dim: this view shows disaster impacts");
			expect(req.notApplied).toContain("measure: events is an event measure");
		});
	}

	it("keeps the measure where the view serves event dimensions", async () => {
		const req = await resolve("dim=disaster_event&measure=events&level=1", { requireMeasure: true, eventDimensions: true });
		expect(req.query.dimension).toBe("disaster_event");
		expect(req.query.measure).toBe("events");
	});
});
