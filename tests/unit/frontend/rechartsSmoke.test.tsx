import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AreaChart from "~/components/AreaChart";
import HorizontalBarChart from "~/components/HorizontalBarChart";
import type { ViewContext } from "~/frontend/context";

const ctx = { t: ({ msg }: { msg: string }) => msg, lang: "en" } as unknown as ViewContext;

// Recharts 3 smoke test: the shared chart components still render with the
// props the analytics screens pass. PieChart and StackedBarChart render
// nothing until mounted in a browser, so they are checked in the browser.
describe("Recharts 3 chart components render", () => {
	it("HorizontalBarChart", () => {
		expect(() =>
			renderToString(<HorizontalBarChart data={[{ name: "Men", value: 3 }, { name: "Women", value: 5 }]} />),
		).not.toThrow();
	});

	it("AreaChart", () => {
		const html = renderToString(
			<AreaChart
				ctx={ctx}
				data={[{ year: 2020, count: 2 }, { year: 2021, count: 4 }]}
				variant="events"
				formatter={(v) => String(v)}
				CustomTooltip={() => null}
				title="Events per year"
			/>,
		);
		expect(html).toContain("Events per year");
	});
});
