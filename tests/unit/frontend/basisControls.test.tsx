import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BasisSwitch, PublishedBasisNotice } from "~/frontend/analytics/dashboard/BasisControls";
import type { ViewContext } from "~/frontend/context";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const noop = () => {};

describe("Basis switch (AB-01, D7)", () => {
	it("offers Published and Include unpublished, with the current basis checked", () => {
		const html = text(renderToString(<BasisSwitch ctx={ctx} basis="published" onChange={noop} />));
		expect(html).toContain('role="radiogroup"');
		expect(html).toContain("Basis");
		expect(html).toContain("Published");
		expect(html).toContain("Include unpublished (reviewers)");
		// One option is selected, and it is the published one.
		expect(html.match(/data-selected="true"/g)).toHaveLength(1);
		const selected = html.slice(html.indexOf('data-selected="true"'));
		expect(selected.indexOf("Published")).toBeLessThan(selected.indexOf("Include unpublished"));
		expect(html).toContain('data-print="hide"');
	});
});

describe("No published records notice (G-00)", () => {
	const render = (counts: { published: number; unpublished: number } | null, canReview: boolean) =>
		text(renderToString(<PublishedBasisNotice ctx={ctx} counts={counts} canReview={canReview} onShowUnpublished={noop} />));

	it("says so once, with a switch for reviewers", () => {
		const html = render({ published: 0, unpublished: 901149 }, true);
		expect(html).toContain("No published records yet.");
		expect(html).toContain("All 901,149 records in scope are unpublished.");
		expect(html).toContain("Show unpublished records (reviewers)");
	});

	it("tells other readers that reviewers can view them, with no switch", () => {
		const html = render({ published: 0, unpublished: 12 }, false);
		expect(html).toContain("Signed-in reviewers can view them.");
		expect(html).not.toContain("<button");
	});

	it("says there are no records at all when nothing is in scope", () => {
		expect(render({ published: 0, unpublished: 0 }, true)).toContain("No records in scope for these filters.");
	});

	it("shows nothing when published records exist or the count is not known", () => {
		expect(render({ published: 3, unpublished: 10 }, true)).toBe("");
		expect(render(null, true)).toBe("");
	});
});
