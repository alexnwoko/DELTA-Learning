// Writes the TileServer GL style for one country: Protomaps grayscale
// flavour, labels in the given language, sources and glyphs served by
// TileServer GL from the local extract and the local font folder.
import { writeFileSync } from "node:fs";
const [, , pkgDir, dataId, lang, out] = process.argv;
const { layers, namedFlavor } = await import(`${pkgDir}/dist/esm/index.js`);
const style = {
	version: 8,
	name: `DELTA basemap (${dataId}, grayscale)`,
	sources: {
		protomaps: {
			type: "vector",
			url: `pmtiles://{${dataId}}`,
			attribution: "© OpenStreetMap contributors",
		},
	},
	glyphs: "{fontstack}/{range}.pbf",
	sprite: "grayscale",
	layers: layers("protomaps", namedFlavor("grayscale"), { lang }),
};
writeFileSync(out, JSON.stringify(style));
console.log(`layers ${style.layers.length}, lang ${lang}`);
