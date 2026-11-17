import { describe, expect, it } from "vitest";
import type { LoaderFunctionArgs } from "react-router";
import { legacyAnalyticsLoader } from "~/frontend/analytics/dashboard/legacyRedirect";

const run = async (page: "sectors" | "hazards" | "disaster-events", url: string, lang = "en") => {
	const res = (await legacyAnalyticsLoader(page)({
		request: new Request(url),
		params: { lang },
		context: {},
	} as unknown as LoaderFunctionArgs)) as Response;
	return { status: res.status, location: res.headers.get("Location") };
};

describe("old analysis pages redirect to the dashboard (Alex, 2026-10-17)", () => {
	it("keep the language and the link's filters", async () => {
		expect(await run("sectors", "http://x/en/analytics/sectors")).toEqual({ status: 301, location: "/en/analytics?view=sectors" });
		expect(await run("hazards", "http://x/fr/analytics/hazards?hipType=1042&from=2015", "fr")).toEqual({
			status: 301,
			location: "/fr/analytics?hipType=1042&from=2015",
		});
		expect(await run("disaster-events", "http://x/en/analytics/disaster-events")).toEqual({
			status: 301,
			location: "/en/analytics?dim=disaster_event",
		});
	});
});
