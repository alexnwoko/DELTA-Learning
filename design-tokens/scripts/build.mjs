// Builds DELTA's design tokens (ADR-19, TR-250) with Style Dictionary.
//
// Sources (DTCG): design-tokens/data/*.json (data layer, owned by DELTA) and
// design-tokens/brand/{neutral,delta}.json (brand layer, taken from the
// pinned Mangrove release; see design-tokens/README.md).
//
// Outputs are committed, so building the app never needs Style Dictionary:
//   app/styles/tokens/data.css           data-layer CSS variables
//   app/styles/tokens/brand.css          brand variables: neutral on :root,
//                                        DELTA under [data-brand="delta"]
//   app/styles/tokens/theme.css          Tailwind v4 @theme names
//   app/utils/designTokens.generated.js  data-layer values for mapState.ts,
//   app/utils/designTokens.generated.d.ts  OpenLayers and charts
//
// Run: yarn build:tokens
import StyleDictionary from "style-dictionary";
import { fileHeader } from "style-dictionary/utils";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const PREFIX = "delta";
const CSS_DIR = "app/styles/tokens/";

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

// DTCG dimension values are {value, unit}; CSS wants "2px".
StyleDictionary.registerTransform({
	name: "delta/dimension-object",
	type: "value",
	filter: (token) =>
		typeof token.$value === "object" && token.$value !== null && "unit" in token.$value,
	transform: (token) => `${token.$value.value}${token.$value.unit}`,
});

// Nested ES module of the data layer. Ramps become ordered arrays so
// FAMILY_RAMPS in mapState.ts keeps its shape.
StyleDictionary.registerFormat({
	name: "delta/data-module",
	format: async ({ dictionary, file }) => {
		const tree = {};
		for (const token of dictionary.allTokens) {
			const [, ...path] = token.path; // drop the leading "data"
			let node = tree;
			path.slice(0, -1).forEach((part) => {
				node = node[camel(part)] ??= {};
			});
			node[camel(path.at(-1))] = token.$value;
		}
		for (const [family, steps] of Object.entries(tree.ramp ?? {})) {
			tree.ramp[family] = Object.keys(steps)
				.sort((a, b) => Number(a) - Number(b))
				.map((k) => steps[k]);
		}
		const header = await fileHeader({ file });
		return (
			header +
			"// Data-layer design tokens (FE-Tokens-01). Generated from\n" +
			"// design-tokens/data/*.json; edit the JSON, then run yarn build:tokens.\n" +
			"//\n" +
			"// map.noRecords and state.notReported are different things: no record\n" +
			"// in scope for the area, against records in scope that reported nothing\n" +
			"// (TR-076). Never merge them, even when their values match.\n" +
			`export const dataTokens = ${JSON.stringify(tree, null, "\t")};\n`
		);
	},
});

StyleDictionary.registerFormat({
	name: "delta/data-module-types",
	format: async ({ file }) => {
		const header = await fileHeader({ file });
		return (
			header +
			"export interface StateTokens {\n\tfill: string;\n\tstroke: string;\n\tstrokeWidth: number;\n\tdash: string;\n\tpattern: string;\n}\n" +
			"export interface StrokeTokens {\n\tstroke: string;\n\tstrokeWidth: number;\n}\n" +
			"export declare const dataTokens: {\n" +
			"\tstate: Record<\"zeroConfirmed\" | \"notReported\" | \"insufficientReporting\" | \"notApplicable\" | \"suppressed\", StateTokens>;\n" +
			"\tmap: {\n\t\tnoRecords: StrokeTokens & { fill: string };\n\t\tareaBoundary: StrokeTokens;\n\t\tselectedOutline: StrokeTokens;\n\t\tplausibilityMarker: StrokeTokens;\n\t\tnotAppliedNote: { border: string; borderWidth: number; background: string };\n\t\tcanvas: { background: string };\n\t};\n" +
			"\tflag: { reviewChip: { background: string; text: string } };\n" +
			"\tchart: { axis: string };\n" +
			"\tnotice: { provisional: { border: string; background: string } };\n" +
			"\tramp: Record<\"people\" | \"housing\" | \"money\" | \"events\", readonly string[]>;\n" +
			"};\n"
		);
	},
});

// Tailwind v4 theme: utility names that read the runtime variables, so a
// brand switch on [data-brand] restyles every utility without a rebuild.
StyleDictionary.registerFormat({
	name: "delta/tailwind-theme",
	format: async ({ dictionary, file }) => {
		const header = await fileHeader({ file });
		const lines = dictionary.allTokens
			.filter((t) => t.$type === "color")
			.map((t) => `\t--color-${t.path.join("-")}: var(--${t.name});`);
		return `${header}@theme inline {\n${lines.join("\n")}\n}\n`;
	},
});

const cssTransforms = ["attribute/cti", "name/kebab", "delta/dimension-object", "color/css"];

async function build(source, platforms) {
	const sd = new StyleDictionary({
		source,
		usesDtcg: true,
		log: { verbosity: "silent", warnings: "disabled" },
		platforms,
	});
	await sd.buildAllPlatforms();
}

mkdirSync(CSS_DIR, { recursive: true });

await build(["design-tokens/data/*.json"], {
	css: {
		transforms: cssTransforms,
		prefix: PREFIX,
		buildPath: CSS_DIR,
		files: [{ destination: "data.css", format: "css/variables" }],
	},
	js: {
		transforms: ["attribute/cti", "name/camel"],
		buildPath: "app/utils/",
		files: [
			{ destination: "designTokens.generated.js", format: "delta/data-module" },
			{ destination: "designTokens.generated.d.ts", format: "delta/data-module-types" },
		],
	},
});

for (const [brand, selector] of [
	["neutral", ":root"],
	["delta", '[data-brand="delta"]'],
]) {
	await build([`design-tokens/brand/${brand}.json`], {
		css: {
			transforms: cssTransforms,
			prefix: PREFIX,
			buildPath: CSS_DIR,
			files: [
				{
					destination: `brand-${brand}.css`,
					format: "css/variables",
					options: { selector },
				},
			],
		},
	});
}

// One brand file: neutral is the default (self-hosted deployments, until
// UNDRR Communications rules), DELTA applies under [data-brand="delta"].
const brandCss =
	readFileSync(`${CSS_DIR}brand-neutral.css`, "utf8") +
	"\n" +
	readFileSync(`${CSS_DIR}brand-delta.css`, "utf8");
writeFileSync(`${CSS_DIR}brand.css`, brandCss);
for (const brand of ["neutral", "delta"]) {
	(await import("node:fs")).rmSync(`${CSS_DIR}brand-${brand}.css`);
}

await build(["design-tokens/data/*.json", "design-tokens/brand/neutral.json"], {
	tw: {
		transforms: cssTransforms,
		prefix: PREFIX,
		buildPath: CSS_DIR,
		files: [{ destination: "theme.css", format: "delta/tailwind-theme" }],
	},
});
