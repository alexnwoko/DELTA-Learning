// Chart export (TR-245, NFR-131). Pure functions, safe on server and client.
//
// Every export keeps what the screen shows next to a figure: its value
// state (a missing figure is never written as 0, TR-076), method and grade,
// the flagged-records caveat (C30), and the approval basis. A file made on
// the reviewer provisional basis says so and is never for publication
// (AB-01).
import type { ValueState } from "~/utils/valueState";

export type ExportBasis = "published" | "provisional";

export interface ChartExportRow {
	/** Category on the axis, for example a hazard or a year. */
	label: string;
	/** Series name when the chart has more than one. */
	series?: string;
	/** null unless a record reported the figure. */
	value: number | null;
	valueState: ValueState;
	unit?: string;
	/** Records whose plausibility flags concern this figure (C30). */
	recordsFlagged?: number;
}

export interface ChartExportMeta {
	title: string;
	/** Who the figures come from, for example "DELTA Angola". */
	source: string;
	/** What the figures cover: places, period, filters. */
	scope?: string;
	method?: string;
	grade?: string;
	basis: ExportBasis;
	/** Further notes the screen shows, for example coverage ("12 of 40 records carry a sex breakdown"). */
	notes?: string[];
	generatedAt: Date;
}

const BASIS_TEXT: Record<ExportBasis, string> = {
	published: "Published records",
	provisional: "PROVISIONAL: includes unpublished records; not for publication",
};

/** One line per caveat, in the order the footer and the CSV show them. */
export function exportNotes(meta: ChartExportMeta, rows: ChartExportRow[]): string[] {
	const flagged = rows.reduce((n, r) => n + (r.recordsFlagged ?? 0), 0);
	const notes = [`Source: ${meta.source}`, `Basis: ${BASIS_TEXT[meta.basis]}`];
	if (meta.scope) notes.push(`Scope: ${meta.scope}`);
	if (meta.method || meta.grade) {
		notes.push(
			[meta.method && `Method: ${meta.method}`, meta.grade && `Grade: ${meta.grade}`]
				.filter(Boolean)
				.join("; "),
		);
	}
	notes.push(...(meta.notes ?? []));
	if (flagged > 0) {
		notes.push(`${flagged} record(s) behind these figures are flagged for review`);
	}
	if (rows.some((r) => r.value === null)) {
		notes.push("Blank values are not reported, not zero");
	}
	notes.push(`Generated ${meta.generatedAt.toISOString().slice(0, 10)}`);
	return notes;
}

/**
 * A cell as RFC 4180 CSV. Text that a spreadsheet would run as a formula
 * (leading =, +, -, @, tab or carriage return) is prefixed with an
 * apostrophe, because labels can come from data entry.
 */
export function csvCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The rows a chart draws, with state, method, grade, basis and caveat. */
export function chartCsv(rows: ChartExportRow[], meta: ChartExportMeta): string {
	const header = [
		"label",
		"series",
		"value",
		"value_state",
		"unit",
		"records_flagged",
		"method",
		"grade",
		"basis",
		"source",
		"scope",
		"notes",
		"title",
		"generated",
	];
	const date = meta.generatedAt.toISOString().slice(0, 10);
	const lines = rows.map((r) =>
		[
			r.label,
			r.series ?? "",
			r.value,
			r.valueState,
			r.unit ?? "",
			// Unknown is not zero (TR-076): an empty cell, never 0.
			r.recordsFlagged ?? null,
			meta.method ?? "",
			meta.grade ?? "",
			BASIS_TEXT[meta.basis],
			meta.source,
			meta.scope ?? "",
			(meta.notes ?? []).join("; "),
			meta.title,
			date,
		]
			.map(csvCell)
			.join(","),
	);
	// CRLF per RFC 4180; a byte order mark so spreadsheet tools read UTF-8
	// (Tajik, Russian and Arabic labels).
	return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

/** A file name from the title, for example "deaths-by-hazard_2026-10-16.csv". */
export function chartFileName(title: string, extension: "csv" | "svg" | "png", at: Date): string {
	const slug =
		title
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "chart";
	return `${slug}_${at.toISOString().slice(0, 10)}.${extension}`;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * A chart's SVG as a standalone file: a title, the chart, and a footer with
 * the notes from exportNotes, so the caveats travel with the picture.
 */
export function standaloneChartSvg(
	chartSvg: string,
	size: { width: number; height: number },
	meta: ChartExportMeta,
	rows: ChartExportRow[],
	style: { text: string; background: string; fontFamily?: string } = {
		text: "#1a1a1a",
		background: "#ffffff",
	},
): string {
	const font = style.fontFamily ?? "system-ui, sans-serif";
	const pad = 16;
	const titleHeight = 28;
	const lineHeight = 16;
	const notes = exportNotes(meta, rows);
	const width = Math.ceil(size.width) + pad * 2;
	const height = Math.ceil(size.height) + pad * 2 + titleHeight + notes.length * lineHeight + 8;
	const inner = chartSvg
		.replace(/^<svg\b/, `<svg x="${pad}" y="${pad + titleHeight}"`)
		.replace(/\swidth="[^"]*"/, ` width="${size.width}"`)
		.replace(/\sheight="[^"]*"/, ` height="${size.height}"`);
	const footerTop = pad + titleHeight + size.height + 8;
	const footer = notes
		.map(
			(note, i) =>
				`<text x="${pad}" y="${footerTop + (i + 1) * lineHeight - 4}" font-size="11">${escapeXml(note)}</text>`,
		)
		.join("");
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escapeXml(font)}" fill="${style.text}">` +
		`<title>${escapeXml(meta.title)}</title>` +
		`<rect width="100%" height="100%" fill="${style.background}"/>` +
		`<text x="${pad}" y="${pad + 18}" font-size="16" font-weight="600">${escapeXml(meta.title)}</text>` +
		inner +
		footer +
		`</svg>`
	);
}
