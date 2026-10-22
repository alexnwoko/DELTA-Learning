// Shared chart frame (TR-245, ADR-19): title, the chart, a caption with the
// figure's notes, a data table and a download menu (PNG, SVG, CSV). The
// table is the chart's accessible alternative and the CSV's source; both
// keep value states, so a missing figure never reads as zero (TR-076).
import React, { useId, useRef } from "react";
import {
	Button,
	Disclosure,
	DisclosurePanel,
	Menu,
	MenuItem,
	MenuTrigger,
	Popover,
} from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import { PanelIcon, usePanelIcon } from "./PanelIcon";
import { STATE_ENCODING } from "~/utils/mapState";
import {
	chartCsv,
	chartFileName,
	exportNotes,
	standaloneChartSvg,
	type ChartExportMeta,
	type ChartExportRow,
} from "./chartExport";
import { SECONDARY_BUTTON_SM } from "~/frontend/buttonStyles";

export interface ChartFrameProps {
	ctx: ViewContext;
	/** Already translated. */
	title: string;
	meta: Omit<ChartExportMeta, "title" | "generatedAt">;
	/** The rows the chart draws; also the table and the CSV. */
	rows: ChartExportRow[];
	/** Formats a reported value for the table, for example with a currency. */
	formatValue?: (value: number, row: ChartExportRow) => string;
	/**
	 * Offer PNG and SVG downloads. False for a panel that is itself a table:
	 * it has no picture, so only its CSV is offered.
	 */
	pictures?: boolean;
	/**
	 * Notes every download carries but the on-screen caption leaves out,
	 * because the page states them once nearby (for example the Sendai notice).
	 */
	quietNotes?: string[];
	children: React.ReactNode;
}

type DownloadKind = "png" | "svg" | "csv";

function stateText(row: ChartExportRow): string | null {
	if (row.valueState === "reported") return null;
	return STATE_ENCODING[row.valueState].label;
}

/** Saves a file the page made, through a temporary link. */
export function saveBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Where the DELTA Resilience logo is served (RegularMenuBar uses the same file). */
export const LOGO_URL = "/assets/images/delta-resilience-logo.png";
const LOGO_SIZE = { width: 705, height: 130 };
let logoData: Promise<string | null> | null = null;

/** The logo as a data URI, fetched once; null when it cannot be read, so a download never fails for it. */
function logoDataUri(): Promise<string | null> {
	logoData ??= fetch(LOGO_URL)
		.then((r) => (r.ok ? r.blob() : null))
		.then(
			(b) =>
				b &&
				new Promise<string | null>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
					reader.onerror = () => resolve(null);
					reader.readAsDataURL(b);
				}),
		)
		.catch(() => null);
	return logoData;
}

function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(width * scale);
			canvas.height = Math.ceil(height * scale);
			const context = canvas.getContext("2d");
			if (!context) return reject(new Error("canvas unavailable"));
			context.scale(scale, scale);
			context.drawImage(image, 0, 0);
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG failed"))), "image/png");
		};
		image.onerror = () => reject(new Error("SVG could not be drawn"));
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	});
}

/** The label of a note such as "Source: DELTA" ("Source"); null for a plain sentence. */
export function noteLabel(note: string): string | null {
	const m = /^([A-Z][A-Za-z]+(?: [a-z]+)?): /.exec(note);
	return m ? m[1] : null;
}

export function ChartFrame({ ctx, title, meta, rows, formatValue, pictures = true, quietNotes = [], children }: ChartFrameProps) {
	const titleId = useId();
	const icon = usePanelIcon();
	const chartRef = useRef<HTMLDivElement>(null);
	const fullMeta = (): ChartExportMeta => ({ ...meta, title, generatedAt: new Date() });
	// Each note once: a caveat named by two sources (TR-152) is not repeated.
	const notes = [...new Set(exportNotes({ ...meta, title, generatedAt: new Date() }, rows))].filter(
		(note) => !note.startsWith("Generated ") && !quietNotes.includes(note),
	);
	const hasSeries = rows.some((r) => r.series);

	const download = async (kind: DownloadKind) => {
		const m = fullMeta();
		if (kind === "csv") {
			saveBlob(new Blob([chartCsv(rows, m)], { type: "text/csv;charset=utf-8" }), chartFileName(title, "csv", m.generatedAt));
			return;
		}
		const chart = chartRef.current?.querySelector("svg.recharts-surface, svg");
		if (!chart) return;
		const box = chart.getBoundingClientRect();
		// The file has no stylesheet, so the brand colours are written into it.
		const styles = getComputedStyle(document.documentElement);
		const text = styles.getPropertyValue("--delta-brand-text").trim();
		const background = styles.getPropertyValue("--delta-brand-surface").trim();
		const logo = await logoDataUri();
		const svg = standaloneChartSvg(
			chart.outerHTML,
			{ width: box.width, height: box.height },
			m,
			rows,
			text && background ? { text, background } : undefined,
			logo ? { href: logo, ...LOGO_SIZE } : undefined,
		);
		if (kind === "svg") {
			saveBlob(new Blob([svg], { type: "image/svg+xml" }), chartFileName(title, "svg", m.generatedAt));
			return;
		}
		const size = svg.match(/^<svg[^>]*\swidth="(\d+)" height="(\d+)"/);
		const png = await svgToPng(svg, Number(size?.[1] ?? box.width), Number(size?.[2] ?? box.height));
		saveBlob(png, chartFileName(title, "png", m.generatedAt));
	};

	const t = (code: string, msg: string) => ctx.t({ code, msg });

	return (
		<figure aria-labelledby={titleId} data-print="flow" className="m-0 flex flex-1 flex-col gap-2">
			{/* A light blue rule under the title row (FE-Proposal-03). */}
			<div className="flex items-start justify-between gap-2 border-b border-data-dashboard-border pb-2.5">
				<h3 id={titleId} className="delta-panel-title m-0 flex items-center gap-2 text-[1.0625rem]">
					{icon && (
						<span className="delta-panel-iconbox flex h-16 w-16 shrink-0 items-center justify-center rounded-[0.714rem] border">
							<PanelIcon name={icon} size={35} />
						</span>
					)}
					{title}
				</h3>
				<MenuTrigger>
					<Button
						data-print="hide"
						aria-label={`${t("charts.download", "Download")}: ${title}`}
						className={SECONDARY_BUTTON_SM}
					>
						{t("charts.download", "Download")}
					</Button>
					<Popover className="rounded border border-brand-border-control bg-brand-surface shadow">
						<Menu onAction={(key) => void download(key as DownloadKind)} className="min-w-48 p-1 outline-none">
							{(
								[
									["png", t("charts.download_png", "Picture (PNG)")],
									["svg", t("charts.download_svg", "Scalable picture (SVG)")],
									["csv", t("charts.download_csv", "Data (CSV)")],
								] as const
							)
								.filter(([id]) => pictures || id === "csv")
								.map(([id, label]) => (
								<MenuItem
									key={id}
									id={id}
									className="cursor-pointer rounded px-2 py-1 data-[focused]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
								>
									{label}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
			</div>
			<div ref={chartRef}>{children}</div>
			{/* Small print, so the chart keeps the reader's eye (Alex, 2026-10-19):
			    7.5pt, with each note's label ("Source:", "Method:") bold at 8pt. */}
			<figcaption className="text-brand-text-muted" style={{ fontSize: "7.5pt", lineHeight: 1.35 }}>
				{notes.map((note) => {
					const label = noteLabel(note);
					return (
						<span key={note} className="block">
							{label ? (
								<>
									<strong className="font-bold text-brand-text" style={{ fontSize: "8pt" }}>{label}:</strong>
									{note.slice(label.length + 1)}
								</>
							) : (
								note
							)}
						</span>
					);
				})}
			</figcaption>
			{/* The table prints open (print.css), so the numbers reach paper too. */}
			<Disclosure data-print="expand">
				<Button
					slot="trigger"
					data-print="hide"
					className="self-start text-sm text-brand-interactive underline data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
				>
					{t("charts.data_table", "Data table")}
				</Button>
				<DisclosurePanel>
					<table className="mt-2 w-full border-collapse text-sm">
						<caption className="sr-only">{title}</caption>
						<thead>
							<tr>
								<th scope="col" className="border-b border-brand-border bg-brand-surface-subtle px-2 py-1 text-start">
									{t("charts.category", "Category")}
								</th>
								{hasSeries && (
									<th scope="col" className="border-b border-brand-border bg-brand-surface-subtle px-2 py-1 text-start">
										{t("charts.series", "Series")}
									</th>
								)}
								<th scope="col" className="border-b border-brand-border bg-brand-surface-subtle px-2 py-1 text-end">
									{t("charts.value", "Value")}
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => {
								const state = stateText(row);
								return (
									<tr key={`${row.label}-${row.series ?? ""}-${i}`}>
										<th scope="row" className="border-b border-brand-border px-2 py-1 text-start font-normal">
											{row.label}
										</th>
										{hasSeries && <td className="border-b border-brand-border px-2 py-1">{row.series ?? ""}</td>}
										<td className="border-b border-brand-border px-2 py-1 text-end">
											{state ?? (row.value === null ? "" : formatValue ? formatValue(row.value, row) : row.value.toLocaleString(ctx.lang))}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</DisclosurePanel>
			</Disclosure>
		</figure>
	);
}

export default ChartFrame;
