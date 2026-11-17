import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestBackendContext } from "~/backend.server/context";
import { getEffectDetails } from "~/backend.server/models/analytics/effectDetails";
import { getMostDamagingEvents } from "~/backend.server/models/analytics/mostDamagingEvents";
import { fetchHazardImpactData } from "~/backend.server/models/analytics/hazardImpact";
import {
	A,
	B,
	ev,
	fx,
	setupValueStateFixture,
	teardownValueStateFixture,
} from "./valueStateFixture";

// Effect details, most damaging events and impact by hazard carry a value
// state on every cost (TR-076, E17). A row, event or hazard with no
// reported cost is null and not_reported, never 0 (MVP exit AC4).

const noFilters = {
	sectorId: null,
	subSectorId: null,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
	disasterEventId: null,
};

describe("sector breakdown value states", () => {
	beforeAll(setupValueStateFixture);
	afterAll(teardownValueStateFixture);

	const ctx = () => createTestBackendContext();

	it("effect details: a loss row with no cost is null and not_reported", async () => {
		const res = await getEffectDetails(ctx(), A.countryAccountId, "public", {
			...noFilters,
			disasterEventId: ev.empty,
		});
		expect(res.losses).toHaveLength(1);
		expect(res.losses[0].publicCostTotal).toBeNull();
		expect(res.losses[0].privateCostTotal).toBeNull();
		expect(res.losses[0].valueStates).toEqual({
			publicCostTotal: "not_reported",
			privateCostTotal: "not_reported",
		});
	});

	it("effect details: a loss row with a cost is reported", async () => {
		const res = await getEffectDetails(ctx(), A.countryAccountId, "public", {
			...noFilters,
			disasterEventId: ev.reported,
		});
		expect(res.losses).toHaveLength(1);
		expect(Number(res.losses[0].publicCostTotal)).toBe(40);
		expect(res.losses[0].valueStates.publicCostTotal).toBe("reported");
	});

	it("effect details: never returns tenant B's rows to tenant A", async () => {
		const res = await getEffectDetails(ctx(), A.countryAccountId, "public", {
			...noFilters,
			disasterEventId: ev.b,
		});
		expect(res.damages).toHaveLength(0);
		expect(res.losses).toHaveLength(0);
		expect(res.disruptions).toHaveLength(0);
	});

	it("most damaging events: null and not_reported for an event with no cost", async () => {
		const res = await getMostDamagingEvents(A.countryAccountId, "public", {
			sectorId: fx.sectorId,
		});
		const empty = res.events.find((e) => e.eventId === ev.empty);
		expect(empty).toMatchObject({ totalDamages: null, totalLosses: null });
		expect(empty?.damages).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsTotal: 1,
		});
		const reported = res.events.find((e) => e.eventId === ev.reported);
		expect(reported?.totalDamages).toBe(100);
		expect(reported?.totalLosses).toBe(40);
		expect(reported?.damages).toMatchObject({
			valueState: "reported",
			recordsReported: 1,
		});
	});

	it("most damaging events: never lists tenant B's events for tenant A", async () => {
		const a = await getMostDamagingEvents(A.countryAccountId, "public", {
			sectorId: fx.sectorId,
		});
		expect(a.events.map((e) => e.eventId).sort()).toEqual(
			[ev.empty, ev.reported].sort(),
		);
		const b = await getMostDamagingEvents(B.countryAccountId, "public", {
			sectorId: fx.sectorId,
		});
		expect(b.events.map((e) => e.eventId)).toEqual([ev.b]);
		expect(b.events[0].totalDamages).toBe(999);
	});

	it("impact by hazard: a hazard with no reported cost is null, not 0", async () => {
		const res = await fetchHazardImpactData(
			ctx(),
			A.countryAccountId,
			"public",
			{
				sectorId: fx.sectorId,
			},
		);
		const byHazard = Object.fromEntries(
			(res.damages ?? []).map((d) => [d.hazardId, d]),
		);
		expect(byHazard[fx.hipTypeB]).toMatchObject({
			value: null,
			percentage: null,
			valueState: "not_reported",
			recordsTotal: 1,
		});
		expect(byHazard[fx.hipTypeA]).toMatchObject({
			value: "100",
			percentage: 100,
			valueState: "reported",
		});
		expect(res.dataAvailability?.damages).toBe("available");
	});

	it("impact by hazard: no data when the only record reported no cost", async () => {
		const res = await fetchHazardImpactData(
			ctx(),
			A.countryAccountId,
			"public",
			{
				sectorId: fx.sectorId,
				disasterEventId: ev.empty,
			},
		);
		expect(res.damages?.every((d) => d.value === null)).toBe(true);
		expect(res.dataAvailability?.damages).toBe("no_data");
		expect(res.dataAvailability?.losses).toBe("no_data");
	});

	it("impact by hazard: never adds tenant B's costs to tenant A", async () => {
		const res = await fetchHazardImpactData(
			ctx(),
			A.countryAccountId,
			"public",
			{
				sectorId: fx.sectorId,
			},
		);
		const values = (res.damages ?? []).map((d) => d.value);
		expect(values).not.toContain("999");
		expect(values).not.toContain("1099");
	});
});
