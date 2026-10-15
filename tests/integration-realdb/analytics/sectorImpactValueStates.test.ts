import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestBackendContext } from "~/backend.server/context";
import {
	getImpactOnSector,
	getSectorImpactTotal,
} from "~/backend.server/handlers/analytics/ImpactonSectors";
import {
	A,
	B,
	ev,
	fx,
	setupValueStateFixture,
	teardownValueStateFixture,
} from "./valueStateFixture";

// Sector impact figures carry a value state (TR-076, E17). A sector or
// event with no reported cost is null and not_reported, never 0 (MVP exit
// AC4). Money has no tri-state source, so a cost is never zero_confirmed.

describe("sector impact value states", () => {
	beforeAll(setupValueStateFixture);
	afterAll(teardownValueStateFixture);

	const ctx = () => createTestBackendContext();

	it("getImpactOnSector: null and not_reported when no record reported a cost", async () => {
		const res = await getImpactOnSector(
			ctx(),
			A.countryAccountId,
			"public",
			fx.sectorId,
			{ disasterEvent: ev.empty },
		);
		expect(res.success).toBe(true);
		expect(res.data?.totalDamage).toBeNull();
		expect(res.data?.totalLoss).toBeNull();
		expect(res.data?.damage).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsTotal: 1,
		});
		expect(res.data?.dataAvailability).toEqual({
			damage: "no_data",
			loss: "no_data",
		});
		// No year of the series reads 0 for a cost nobody reported.
		expect(res.data?.damageOverTime).toEqual({});
	});

	it("getImpactOnSector: the sum and reported for a sector with data", async () => {
		const res = await getImpactOnSector(
			ctx(),
			A.countryAccountId,
			"public",
			fx.sectorId,
		);
		expect(res.data?.totalDamage).toBe("100");
		expect(res.data?.damage).toEqual({
			value: 100,
			valueState: "reported",
			recordsReported: 1,
			recordsNotReported: 1,
			recordsTotal: 2,
		});
		expect(res.data?.loss).toMatchObject({ value: 40, valueState: "reported" });
		expect(res.data?.damageOverTime).toEqual({ "2020": "100" });
	});

	it("getSectorImpactTotal: null and not_reported for an event with no cost", async () => {
		const d = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "damages",
			type: { disasterEventId: ev.empty },
		});
		expect(d?.damagesTotal).toBeNull();
		expect(d?.damages).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsTotal: 1,
		});
		const l = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "losses",
			type: { disasterEventId: ev.empty },
		});
		expect(l?.lossesTotal).toBeNull();
		expect(l?.losses?.valueState).toBe("not_reported");
	});

	it("getSectorImpactTotal: the sum and reported for an event with data", async () => {
		const d = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "damages",
			type: { disasterEventId: ev.reported },
		});
		expect(d?.damagesTotal).toBe(100);
		expect(d?.damages).toMatchObject({
			valueState: "reported",
			recordsReported: 1,
		});
		const l = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "losses",
			type: { disasterEventId: ev.reported },
		});
		expect(l?.lossesTotal).toBe(40);
	});

	it("never adds tenant B's rows to tenant A", async () => {
		const all = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "damages",
		});
		expect(all?.damagesTotal).toBe(100);
		const other = await getSectorImpactTotal({
			countryAccountsId: A.countryAccountId,
			audience: "public",
			impact: "damages",
			type: { disasterEventId: ev.b },
		});
		expect(other?.damagesTotal).toBeNull();
		expect(other?.damages?.recordsTotal).toBe(0);

		const res = await getImpactOnSector(
			ctx(),
			A.countryAccountId,
			"public",
			fx.sectorId,
		);
		expect(res.data?.totalLoss).toBe("40");

		const b = await getImpactOnSector(
			ctx(),
			B.countryAccountId,
			"public",
			fx.sectorId,
		);
		expect(b.data?.totalDamage).toBe("999");
	});
});
