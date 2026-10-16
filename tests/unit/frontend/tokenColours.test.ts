import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Screens moved onto design tokens (ADR-19, TR-250). They use token
// utilities (brand-*, data-*) only: no Tailwind palette colour and no hex.
const RETROFITTED = ["app/routes/$lang+/analytics+/plausibility-review.tsx"];

const PALETTE =
	/\b(?:bg|text|border|outline|ring|fill|stroke|divide|placeholder|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

describe("retrofitted screens use design tokens only", () => {
	it.each(RETROFITTED)("%s", (file) => {
		const source = readFileSync(join(process.cwd(), file), "utf8");
		expect(source.match(PALETTE) ?? [], "use brand-* or data-* utilities").toEqual([]);
		expect(source.match(HEX) ?? [], "use brand-* or data-* utilities").toEqual([]);
	});
});
