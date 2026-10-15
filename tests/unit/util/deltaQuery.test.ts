import { describe, it, expect } from "vitest";
import {
	parseDeltaQuery,
	serializeDeltaQuery,
	withLockedFilters,
	DEFAULT_QUERY,
} from "~/utils/deltaQuery";

const DIV = "11111111-1111-4111-8111-111111111111";
const HIP = "22222222-2222-4222-8222-222222222222";
const SEC = "33333333-3333-4333-8333-333333333333";
const EVT = "44444444-4444-4444-8444-444444444444";

const q = (s: string) => parseDeltaQuery(new URLSearchParams(s));

describe("delta.query/1", () => {
	it("defaults to the Disaster impact dimension on the published basis", () => {
		const { query, issues } = q("");
		expect(query).toEqual(DEFAULT_QUERY);
		expect(issues).toEqual([]);
	});

	it("reads the dimension facet and the work package grain alias", () => {
		expect(q("dim=hazardous_event").query.dimension).toBe("hazardous_event");
		expect(q("grain=disaster_record").query.dimension).toBe("disaster_impact");
		expect(q("grain=disaster_event").query.dimension).toBe("disaster_event");
	});

	it("reports an unknown dimension or basis instead of guessing", () => {
		const { query, issues } = q("dim=records&basis=draft");
		expect(query.dimension).toBe("disaster_impact");
		expect(query.scope.basis).toBe("published");
		expect(issues.map((i) => i.param)).toEqual(["dim", "basis"]);
	});

	it("never applies a malformed division silently", () => {
		const { query, issues } = q("division=1;DROP TABLE x");
		expect(query.where.geo).toBeUndefined();
		expect(issues).toEqual([{ param: "division", reason: "not a valid id" }]);
	});

	it("round-trips every filter", () => {
		const s = `dim=disaster_event&basis=provisional&asOf=2026-10-15&hip=${HIP}&division=${DIV}&from=2015&to=2020-06&sector=${SEC}&effect=deaths&effect=missing&disasterEvent=${EVT}`;
		const { query, issues } = q(s);
		expect(issues).toEqual([]);
		expect(query.where).toEqual({
			hazard: { hazardId: HIP },
			geo: { divisionId: DIV },
			time: { from: "2015", to: "2020-06" },
			sectors: [SEC],
			humanEffects: ["deaths", "missing"],
			disasterEventId: EVT,
		});
		expect(parseDeltaQuery(serializeDeltaQuery(query)).query).toEqual(query);
	});

	it("reads one measure and refuses a list", () => {
		expect(q("measure=houses_damaged").query.measure).toBe("houses_damaged");
		const many = q("measure=deaths&measure=injured");
		expect(many.query.measure).toBeUndefined();
		expect(many.issues).toEqual([
			{ param: "measure", reason: "MULTI_SERIES_CHOROPLETH" },
		]);
		expect(q("measure=dollars").issues[0].param).toBe("measure");
	});

	it("marks monetary measures for refusal", async () => {
		const { isMonetaryMeasure } = await import("~/utils/deltaQuery");
		expect(isMonetaryMeasure("losses")).toBe(true);
		expect(isMonetaryMeasure("deaths")).toBe(false);
	});

	it("accepts grade floors A to C and refuses D", () => {
		expect(q("minAttGrade=B").query.minAttGrade).toBe("B");
		const d = q("minAttGrade=D");
		expect(d.query.minAttGrade).toBeUndefined();
		expect(d.issues).toEqual([
			{ param: "minAttGrade", reason: "ATT_D_EXCLUDED_FROM_OFFICIAL" },
		]);
	});

	it("round-trips measure and grade floor", () => {
		const { query } = q("measure=evacuated&minAttGrade=A");
		expect(parseDeltaQuery(serializeDeltaQuery(query)).query).toEqual(query);
	});

	it("accepts numeric HIP ids as stored on records", () => {
		const { query, issues } = q("hipType=1037&hipCluster=1844&hip=78443");
		expect(issues).toEqual([]);
		expect(query.where.hazard).toEqual({
			typeId: "1037",
			clusterId: "1844",
			hazardId: "78443",
		});
		expect(parseDeltaQuery(serializeDeltaQuery(query)).query).toEqual(query);
		expect(q("hip=12ab").issues).toEqual([
			{ param: "hip", reason: "not a valid hazard id" },
		]);
	});

	it("leaves defaults out of the URL", () => {
		expect(serializeDeltaQuery(DEFAULT_QUERY).toString()).toBe("");
	});

	it("rejects dates that are not YYYY, YYYY-MM or YYYY-MM-DD", () => {
		const { query, issues } = q("from=2015-13-45x&to=2020");
		expect(query.where.time).toEqual({ to: "2020" });
		expect(issues.map((i) => i.param)).toEqual(["from"]);
	});

	it("keeps locked embed filters when the URL tries to widen them", () => {
		const fromUrl = q(`dim=hazardous_event&disasterEvent=${DIV}`).query;
		const locked = withLockedFilters(fromUrl, {
			dimension: "disaster_impact",
			where: { disasterEventId: EVT },
		});
		expect(locked.dimension).toBe("disaster_impact");
		expect(locked.where.disasterEventId).toBe(EVT);
	});
});
