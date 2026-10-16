import { afterEach, describe, expect, it } from "vitest";
import {
	escapeHtml,
	jsonDataBlock,
	jsonForInlineScript,
	PREVIEW_DATA_ID,
	readJsonDataBlock,
} from "~/utils/inlineScript";
import { buildFootprintPreviewHtml } from "~/components/SpatialFootprintMapViewer";
import {
	previewGeoJSON,
	previewMap,
} from "~/components/ContentRepeater/controls/mapper";

// Footprint data a data-entry user controls. Each value tries a different way
// out of the preview page: a template substitution, a backtick, a script close.
const HOSTILE_TITLE = "${globalThis.__deltaPwned = 1}`;globalThis.__deltaPwned = 2;`";
const HOSTILE_DESCRIPTION = "</script><script>globalThis.__deltaPwned = 3</script>";
const FOOTPRINTS = [
	{
		title: HOSTILE_TITLE,
		type: "disaster",
		geojson: {
			type: "Feature",
			properties: { description: HOSTILE_DESCRIPTION },
			geometry: { type: "Point", coordinates: [13.2, -8.8] },
		},
	},
];

/** The preview data, read the way the page reads it (SEC-30 JSON block). */
function readPreviewData(html: string): any {
	const match = html.match(
		new RegExp(`<script type="application/json" id="${PREVIEW_DATA_ID}">(.*?)</script>`, "s"),
	);
	if (!match) throw new Error("no preview data block");
	return JSON.parse(match[1]);
}

function scriptCloseCount(html: string) {
	return html.split("</script>").length - 1;
}

afterEach(() => {
	delete (globalThis as any).__deltaPwned;
	delete (globalThis as any).window;
});

describe("jsonForInlineScript", () => {
	it("round-trips the value and never emits <, > or & literally", () => {
		const value = { a: "</script><!-- & -->", b: "\u2028\u2029", c: null };
		const out = jsonForInlineScript(value);
		expect(out).not.toMatch(/[<>&\u2028\u2029]/);
		expect(new Function(`return ${out};`)()).toEqual(value);
	});

	it("serialises undefined as null", () => {
		expect(jsonForInlineScript(undefined)).toBe("null");
	});
});

describe("jsonDataBlock", () => {
	it("writes a non-executable, escaped JSON block that the page reads back", () => {
		const value = { a: "</script><script>x()</script>", b: [1, null] };
		const block = jsonDataBlock(value);
		expect(block.startsWith('<script type="application/json" id="delta-preview-data">')).toBe(true);
		expect(block.split("</script>").length - 1).toBe(1);
		expect(readPreviewData(block)).toEqual(value);
		expect(readJsonDataBlock()).toBe(
			'JSON.parse(document.getElementById("delta-preview-data").textContent)',
		);
	});
});

describe("escapeHtml", () => {
	it("escapes markup and quotes", () => {
		expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
			"&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;",
		);
		expect(escapeHtml(null)).toBe("");
	});
});

describe("SpatialFootprintMapViewer preview page", () => {
	it("passes hostile footprint data through as data, not code", () => {
		const itemsJson = JSON.stringify(FOOTPRINTS);
		const html = buildFootprintPreviewHtml(itemsJson, "Footprints");

		expect(readPreviewData(html).items).toEqual(FOOTPRINTS);
		expect(html).toContain("const items = " + readJsonDataBlock() + ".items;");
		expect((globalThis as any).__deltaPwned).toBeUndefined();
		// Only the page's own script elements close; the data adds none.
		expect(scriptCloseCount(html)).toBe(
			scriptCloseCount(buildFootprintPreviewHtml("[]", "Footprints")),
		);
	});

	it("writes the caption as text", () => {
		const html = buildFootprintPreviewHtml("[]", "<img src=x onerror=alert(1)>");
		expect(html).toContain("<h4>&lt;img src=x onerror=alert(1)&gt;</h4>");
	});

	it("renders marker popups as text, not HTML", () => {
		const html = buildFootprintPreviewHtml("[]", "");
		expect(html).not.toContain("bindPopup(feature.properties.description)");
		expect(html).toContain("popup.textContent =");
	});
});

describe("ContentRepeater mapper preview pages", () => {
	function captureWrites() {
		const written: string[] = [];
		(globalThis as any).window = {
			open: () => ({
				document: { write: (h: string) => written.push(h), close: () => {} },
			}),
		};
		return written;
	}

	it("previewMap passes hostile footprint data through as data, not code", () => {
		const written = captureWrites();
		previewMap(JSON.stringify(FOOTPRINTS));
		const html = written.join("");

		expect(JSON.parse(readPreviewData(html))).toEqual(FOOTPRINTS);
		expect(html).toContain("const items = " + readJsonDataBlock() + ";");
		expect((globalThis as any).__deltaPwned).toBeUndefined();
		expect(html).not.toContain("bindPopup(feature.properties.description)");
	});

	it("previewGeoJSON writes the GeoJSON as text", () => {
		const written = captureWrites();
		previewGeoJSON(JSON.stringify({ name: HOSTILE_DESCRIPTION }));
		expect(written.join("")).not.toContain("<script>");
	});
});

describe("SpatialFootprintsMapViewer preview page", () => {
	const benign = {
		items: [],
		legendData: [{ id: "rec-1" }],
		defaultKeys: ["event"],
		missing: [],
		eventId: "ev-1",
		coords: [-8.8, 13.2],
		urlLang: "en",
		filterCaption: "Footprints",
	};

	it("keeps hostile data, ids, captions and the URL language as data", async () => {
		const { buildFootprintsPreviewHtml } = await import(
			"~/components/SpatialFootprintsMapViewer"
		);
		const html = buildFootprintsPreviewHtml({
			...benign,
			items: FOOTPRINTS,
			legendData: [{ id: '"</script><script>globalThis.__deltaPwned=4</script>' }],
			missing: [HOSTILE_TITLE],
			eventId: "<img src=x onerror=globalThis.__deltaPwned=5>",
			urlLang: '"+(globalThis.__deltaPwned=6)+"',
			filterCaption: "<b>caption</b>",
		});

		const data = readPreviewData(html);
		expect(data.items).toEqual(FOOTPRINTS);
		expect(data.missing).toEqual([HOSTILE_TITLE]);
		expect(data.urlLang).toBe('"+(globalThis.__deltaPwned=6)+"');
		expect(data.recordIds).toEqual(['"</script><script>globalThis.__deltaPwned=4</script>']);
		// SEC-30: the record id is read from the block, not written into code.
		expect(html).toContain("const base = previewData.recordIds[0];");
		expect((globalThis as any).__deltaPwned).toBeUndefined();

		expect(scriptCloseCount(html)).toBe(
			scriptCloseCount(buildFootprintsPreviewHtml(benign)),
		);
		expect(html).not.toContain("<img src=x");
		expect(html).not.toContain("<b>caption</b>");
		expect(html).toContain("&lt;b&gt;caption&lt;/b&gt;");
		expect(html).not.toContain('fetch("/"+(globalThis');
		expect(html).toContain("popup.textContent =");
	});
});
