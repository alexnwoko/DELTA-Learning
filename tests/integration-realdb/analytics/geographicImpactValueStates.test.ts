import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getGeographicImpact } from "~/backend.server/models/analytics/geographicImpact";
import {
	A,
	B,
	div,
	fx,
	setupValueStateFixture,
	teardownValueStateFixture,
} from "./valueStateFixture";

// geographicImpact per-division figures carry a value state (TR-076, E17,
// PD-10:62). A division with no reporting record is null and not_reported,
// never 0 (MVP exit AC4).

describe("geographicImpact value states", () => {
	beforeAll(setupValueStateFixture);
	afterAll(teardownValueStateFixture);

	it("returns null and not_reported for a division with no records", async () => {
		const res = await getGeographicImpact(A.countryAccountId, "public", {
			sectorId: fx.sectorId,
		});
		expect(res.success).toBe(true);
		const v = res.values[div.empty];
		expect(v.totalDamage).toBeNull();
		expect(v.totalLoss).toBeNull();
		expect(v.damage).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsTotal: 0,
		});
		expect(v.loss.valueState).toBe("not_reported");
		expect(v.dataAvailability).toBe("no_data");
	});

	it("returns the sum and reported for a division with data", async () => {
		const res = await getGeographicImpact(A.countryAccountId, "public", {
			sectorId: fx.sectorId,
		});
		const v = res.values[div.reported];
		// Two records in the division; only one reported a cost.
		expect(v.damage).toEqual({
			value: 100,
			valueState: "reported",
			recordsReported: 1,
			recordsNotReported: 1,
			recordsTotal: 2,
		});
		expect(v.totalDamage).toBe(100);
		expect(v.loss).toMatchObject({ value: 40, valueState: "reported" });
		expect(v.dataAvailability).toBe("available");
	});

	it("is not_reported, not 0, when the only record reported no cost", async () => {
		const res = await getGeographicImpact(A.countryAccountId, "public", {
			sectorId: fx.sectorId,
			hazardTypeId: fx.hipTypeB,
		});
		const v = res.values[div.reported];
		expect(v.damage).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsReported: 0,
			recordsTotal: 1,
		});
		expect(v.totalLoss).toBeNull();
	});

	it("never shows tenant B's divisions or figures to tenant A", async () => {
		const a = await getGeographicImpact(A.countryAccountId, "public", {});
		expect(Object.keys(a.values)).not.toContain(div.b);
		expect(a.divisions.map((d) => d.id)).not.toContain(div.b);
		expect(a.values[div.reported].totalDamage).toBe(100);

		const b = await getGeographicImpact(B.countryAccountId, "public", {});
		expect(Object.keys(b.values)).toEqual([div.b]);
		expect(b.values[div.b].totalDamage).toBe(999);
	});
});
