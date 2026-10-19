// Section page headings (Alex, 2026-10-19).
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { brandTitle, isDataEntryPath, PageBrand } from "~/frontend/PageBrand";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator() };

describe("section page headings", () => {
	it("names the three sections", () => {
		expect(brandTitle(ctx, "data")).toBe("Delta Resilience | Data Entry");
		expect(brandTitle(ctx, "analysis")).toBe("Data Analysis");
		expect(brandTitle(ctx, "geoportal")).toBe("Delta Resilience | Geoportal");
	});

	it("is the page's h1, styled in capitals and extra bold by CSS", () => {
		const html = renderToString(<PageBrand ctx={ctx} section="analysis" />);
		expect(html).toMatch(/^<h1 class="delta-page-brand m-0 "[^>]*>Data Analysis<\/h1>$/);
	});

	it("treats the three record lists and everything under them as Data Entry", () => {
		for (const p of ["/en/disaster-record", "/fr/disaster-event/edit/1", "/en-debug/hazardous-event/abc"]) expect(isDataEntryPath(p)).toBe(true);
		for (const p of ["/en/analytics", "/en/geoportal", "/en/settings/system", "/en/disaster-recordings"]) expect(isDataEntryPath(p)).toBe(false);
	});
});
