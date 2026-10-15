import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dr } from "~/db.server";
import {
	disasterEventSectorTotal__ById,
	disasterEventSectorTotal__ByDivisionId,
} from "~/backend.server/models/analytics/disaster-events";
import { getAffected } from "~/backend.server/models/analytics/affected-people-by-disaster-event-v2";
import {
	A,
	B,
	div,
	ev,
	fx,
	setupValueStateFixture,
	teardownValueStateFixture,
} from "./valueStateFixture";

// Disaster event figures carry a value state (TR-076, E17). An event with
// no reporting record is null and not_reported, never 0 (MVP exit AC4).

describe("disaster event value states", () => {
	beforeAll(setupValueStateFixture);
	afterAll(teardownValueStateFixture);

	it("sector totals: null and not_reported for an event with no cost", async () => {
		const res = await disasterEventSectorTotal__ById(
			A.countryAccountId,
			ev.empty,
			[fx.sectorId],
			"USD",
			"public",
		);
		for (const effect of [res.damages, res.losses, res.recovery]) {
			expect(effect).toMatchObject({
				total: null,
				value: null,
				valueState: "not_reported",
				recordsReported: 0,
				recordsTotal: 1,
				currency: "USD",
			});
		}
	});

	it("sector totals: the sum and reported for an event with data", async () => {
		const res = await disasterEventSectorTotal__ById(
			A.countryAccountId,
			ev.reported,
			[fx.sectorId],
			"USD",
			"public",
		);
		expect(res.damages).toMatchObject({
			total: 100,
			valueState: "reported",
			recordsReported: 1,
			recordsTotal: 1,
		});
		expect(res.losses).toMatchObject({ total: 40, valueState: "reported" });
		// No recovery cost on the record: not reported, never 0.
		expect(res.recovery).toMatchObject({
			total: null,
			valueState: "not_reported",
		});
	});

	it("sector totals by division: the same states", async () => {
		const empty = await disasterEventSectorTotal__ByDivisionId(
			A.countryAccountId,
			ev.empty,
			div.reported,
			"USD",
			"public",
		);
		expect(empty.damages.valueState).toBe("not_reported");
		expect(empty.damages.total).toBeNull();
		const reported = await disasterEventSectorTotal__ByDivisionId(
			A.countryAccountId,
			ev.reported,
			div.reported,
			"USD",
			"public",
		);
		expect(reported.damages.total).toBe(100);
	});

	it("sector totals never read another tenant's event", async () => {
		const res = await disasterEventSectorTotal__ById(
			A.countryAccountId,
			ev.b,
			[fx.sectorId],
			"USD",
			"public",
		);
		expect(res.damages).toMatchObject({ total: null, recordsTotal: 0 });
		const byDivision = await disasterEventSectorTotal__ByDivisionId(
			A.countryAccountId,
			ev.b,
			div.b,
			"USD",
			"public",
		);
		expect(byDivision.losses.total).toBeNull();
		const own = await disasterEventSectorTotal__ById(
			B.countryAccountId,
			ev.b,
			[fx.sectorId],
			"USD",
			"public",
		);
		expect(own.damages.total).toBe(999);
	});

	it("human effects: null and not_reported for an event with no reporting record", async () => {
		const res = await getAffected(dr, ev.empty, { audience: "public" });
		const n = res.noDisaggregations;
		expect(n.tables.deaths).toBeNull();
		expect(n.measures.deaths).toMatchObject({
			value: null,
			valueState: "not_reported",
			recordsNotReported: 1,
			recordsTotal: 1,
		});
		expect(n.totalPeopleAffected).toBeNull();
		expect(n.peopleAffected.valueState).toBe("not_reported");
	});

	it("human effects: the sum and reported for an event with data", async () => {
		const res = await getAffected(dr, ev.reported, { audience: "public" });
		const n = res.noDisaggregations;
		expect(n.tables.deaths).toBe(5);
		expect(n.measures.deaths).toMatchObject({
			value: 5,
			valueState: "reported",
			recordsReported: 1,
		});
		// No component of people affected was reported: null, never 0.
		expect(n.totalPeopleAffected).toBeNull();
	});

	it("human effects by division: a division without the event's records is not_reported", async () => {
		const res = await getAffected(dr, ev.reported, {
			audience: "public",
			divisionId: div.empty,
		});
		expect(res.noDisaggregations.tables.deaths).toBeNull();
		expect(res.noDisaggregations.measures.deaths.recordsTotal).toBe(0);
	});
});
