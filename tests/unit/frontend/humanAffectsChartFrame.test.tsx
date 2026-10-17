import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HumanAffects from "~/frontend/analytics/hazards/sections/HumanAffects";
import type { ViewContext } from "~/frontend/context";

// Chart frame pilot (TR-245): the hazards sex breakdown carries its source,
// scope, method, basis and coverage, and a category nobody reported stays
// "not reported", never 0 (TR-076).

const ctx = {
	t: ({ msg }: { msg: string }, vars?: Record<string, unknown>) =>
		msg.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`)),
	lang: "en",
} as unknown as ViewContext;

const render = (scope?: Record<string, unknown>) =>
	renderToString(
		<HumanAffects
			ctx={ctx}
			scope={scope as never}
			totalPeopleAffected={10}
			totalDeaths={1}
			totalInjured={2}
			totalMissing={null}
			totalPeopleDirectlyAffected={7}
			totalDisplaced={null}
			noOfMen={6}
			noOfWomen={4}
			noOfNonBinary={null}
			totalChildren={null}
			totalAdults={null}
			totalSeniors={null}
			totalDisability={null}
			totalInternationalPoorPeople={null}
			totalNationalPoorPeople={null}
			genderCoverage={{ recordsWithBreakdown: 1, recordsTotal: 3 }}
		/>,
	);

const scope = {
	tenant: "Angola",
	fromDate: "2015",
	toDate: "2024",
	hazard: null,
	audience: "public",
	provisional: false,
};

describe("HumanAffects sex breakdown in the chart frame", () => {
	it("frames the chart with source, scope, method, basis and coverage", () => {
		const html = render(scope);
		expect(html).toContain("<figure");
		const caption = html.match(/<figcaption[^>]*>(.*?)<\/figcaption>/s)![1];
		expect(caption).toContain("DELTA Resilience, Angola");
		expect(caption).toContain("Basis: Published records");
		expect(caption).toContain("sex-only rows");
		expect(caption).toContain("Based on 1 of 3 records with this breakdown");
	});

	it("lists a category nobody reported as not reported, not 0", () => {
		const html = render(scope);
		expect(html).toContain("Non-binary");
		expect(html).toMatch(/No data|Not reported/);
	});

	it("draws the chart without a frame when the screen gives no scope", () => {
		expect(render()).not.toContain("<figure");
	});
});
