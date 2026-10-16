import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ViewContext } from "~/frontend/context";
import { PrintReport } from "~/frontend/print/PrintReport";

const ctx = { t: ({ msg }: { msg: string }) => msg, lang: "en" } as unknown as ViewContext;
const AT = new Date("2026-10-16T12:00:00Z");
const SECTIONS = [
	{ id: "summary", title: "Summary", content: <p>Summary body</p> },
	{ id: "human", title: "Human effects", content: <p>Human body</p> },
	{ id: "damage", title: "Damage and losses", content: <p>Damage body</p> },
];
// React's server render puts <!-- --> between adjacent text parts; drop them.
const render = (extra: Partial<React.ComponentProps<typeof PrintReport>> = {}) =>
	renderToString(
		<PrintReport ctx={ctx} title="Floods, Benguela, March 2026" source="DELTA Angola" basis="published" sections={SECTIONS} generatedAt={AT} {...extra} />,
	).replace(/<!-- -->/g, "");

describe("PrintReport (TR-246)", () => {
	it("prints every section by default, with title, source, basis and date", () => {
		const html = render();
		for (const body of ["Summary body", "Human body", "Damage body"]) expect(html).toContain(body);
		expect(html).toContain("Floods, Benguela, March 2026");
		expect(html).toMatch(/<footer[^>]*>DELTA Angola · Published records · Generated 2026-10-16<\/footer>/);
	});

	it("prints only the sections the reader ticked", () => {
		const html = render({ initialSelected: ["summary", "damage"] });
		expect(html).toContain("Summary body");
		expect(html).toContain("Damage body");
		expect(html).not.toContain("Human body");
		expect(html).toContain("Human effects"); // still offered in the picker
	});

	it("marks a provisional report on screen and on paper (AB-01)", () => {
		const html = render({ basis: "provisional" });
		expect(html).toMatch(/role="note"[^>]*bg-data-notice-provisional-background[^>]*>PROVISIONAL: includes unpublished records; not for publication/);
		expect(html).toContain("DELTA Angola · PROVISIONAL");
	});

	it("keeps the picker and the print button off paper", () => {
		const html = render();
		expect(html).toMatch(/<div data-print="hide"[^>]*>.*Sections to include/s);
		expect(html).toMatch(/<button[^>]*data-print="hide"[^>]*>Print or save as PDF<\/button>/);
	});

	it("does not split a section across pages", () => {
		expect(render()).toMatch(/<section aria-label="Summary" data-print="keep"/);
	});
});

describe("print.css (TR-246)", () => {
	const css = readFileSync(join(process.cwd(), "app/styles/print.css"), "utf8");
	it("drops the site header and footer but keeps page headers", () => {
		expect(css).toMatch(/header:has\(~ main\)/);
		expect(css).toMatch(/main ~ footer/);
		expect(css).not.toMatch(/(^|[\s,])header\s*[,{]/m);
	});
	it("hides marked controls, prints disclosed tables open and keeps state colours", () => {
		expect(css).toContain('[data-print="hide"]');
		expect(css).toContain('[data-print="expand"] [hidden]');
		expect(css).toContain("print-color-adjust: exact");
	});
	it("is imported after the tokens", () => {
		const all = readFileSync(join(process.cwd(), "app/styles/all.css"), "utf8");
		expect(all.indexOf('@import "./print.css"')).toBeGreaterThan(all.indexOf('@import "./tokens/theme.css"'));
	});
});
