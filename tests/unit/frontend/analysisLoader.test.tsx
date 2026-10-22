// The Analysis and Geoportal waiting screen (Alex, 2026-10-22).
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisLoader, loaderSection } from "~/frontend/AnalysisLoader";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator() };

describe("waiting screen", () => {
	it("draws eight blue dots and the message on three lines, announced politely", () => {
		const html = renderToString(<AnalysisLoader ctx={ctx} />);
		expect(html.match(/class="delta-loader-dot"/g)).toHaveLength(8);
		expect(html).toContain('role="status"');
		expect(html).toContain('aria-live="polite"');
		expect(html).toMatch(/<span>Hold\.\.\.<\/span><span>putting together<\/span><span>your analysis<\/span>/);
	});

	it("says your map on the Geoportal", () => {
		expect(renderToString(<AnalysisLoader ctx={ctx} section="geoportal" />)).toContain("your map");
	});

	it("shows on Analysis and Geoportal paths only", () => {
		expect(loaderSection("/en/analytics")).toBe("analysis");
		expect(loaderSection("/fr/analytics/")).toBe("analysis");
		expect(loaderSection("/en/geoportal")).toBe("geoportal");
		expect(loaderSection("/en/disaster-record")).toBeNull();
		expect(loaderSection("/en/analyticsx")).toBeNull();
	});
});
