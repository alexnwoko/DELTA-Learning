import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ViewContext } from "~/frontend/context";

const ctx = { t: ({ msg }: { msg: string }) => msg, lang: "en" } as unknown as ViewContext;

const render = (basis: "published" | "provisional" = "published") =>
	renderToString(
		<ChartFrame
			ctx={ctx}
			title="Deaths by hazard"
			meta={{ source: "DELTA Angola", scope: "Angola, 2015-2024", method: "Sum of reported records", grade: "B", basis }}
			rows={[
				{ label: "Flood", value: 1200, valueState: "reported", recordsFlagged: 2 },
				{ label: "Drought", value: 0, valueState: "zero_confirmed" },
				{ label: "Landslide", value: null, valueState: "not_reported" },
			]}
		>
			<svg className="recharts-surface" width="400" height="200" />
		</ChartFrame>,
	);

describe("ChartFrame (TR-245)", () => {
	it("is a labelled figure with the chart, a download button and a data-table control", () => {
		const html = render();
		expect(html).toMatch(/<figure[^>]*aria-labelledby="([^"]+)"/);
		const id = html.match(/<figure[^>]*aria-labelledby="([^"]+)"/)![1];
		expect(html).toContain(`id="${id}"`);
		expect(html).toContain("Deaths by hazard");
		expect(html).toContain('class="recharts-surface"');
		expect(html).toContain('aria-label="Download: Deaths by hazard"');
		expect(html).toContain("Data table");
	});

	it("captions the figure with source, basis, scope, method, grade and caveats (NFR-131)", () => {
		const caption = render().match(/<figcaption[^>]*>(.*?)<\/figcaption>/s)![1];
		for (const note of [
			"Source: DELTA Angola",
			"Basis: Published records",
			"Scope: Angola, 2015-2024",
			"Method: Sum of reported records; Grade: B",
			"2 record(s) behind these figures are flagged for review",
			"Blank values are not reported, not zero",
		]) {
			expect(caption).toContain(note);
		}
	});

	it("says a provisional chart is not for publication (AB-01)", () => {
		expect(render("provisional")).toContain("PROVISIONAL: includes unpublished records; not for publication");
	});

	it("uses token colours only (ADR-19)", () => {
		expect(render()).not.toMatch(/(bg|text|border)-(gray|blue|white|black|amber)-?\d*/);
	});
});
