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
import { STATE_ENCODING } from "~/utils/mapState";
import {
	chartCsv,
	chartFileName,
	exportNotes,
	standaloneChartSvg,
	type ChartExportMeta,
	type ChartExportRow,
} from "./chartExport";

export interface ChartFrameProps {
	ctx: ViewContext;
	/** Already translated. */
	title: string;
	meta: Omit<ChartExportMeta, "title" | "generatedAt">;
	/** The rows the chart draws; also the table and the CSV. */
	rows: ChartExportRow[];
	/** Formats a reported value for the table, for example with a currency. */
	formatValue?: (value: number, row: ChartExportRow) => string;
	children: React.ReactNode;
}

type DownloadKind = "png" | "svg" | "csv";

function stateText(row: ChartExportRow): string | null {
	if (row.valueState === "reported") return null;
	return STATE_ENCODING[row.valueState].label;
}

function saveBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
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

export function ChartFrame({ ctx, title, meta, rows, formatValue, children }: ChartFrameProps) {
	const titleId = useId();
	const chartRef = useRef<HTMLDivElement>(null);
	const fullMeta = (): ChartExportMeta => ({ ...meta, title, generatedAt: new Date() });
	const notes = exportNotes({ ...meta, title, generatedAt: new Date() }, rows).filter(
		(note) => !note.startsWith("Generated "),
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
		const svg = standaloneChartSvg(
			chart.outerHTML,
			{ width: box.width, height: box.height },
			m,
			rows,
			text && background ? { text, background } : undefined,
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
		<figure aria-labelledby={titleId} className="m-0 flex flex-col gap-2">
			<div className="flex items-start justify-between gap-2">
				<h3 id={titleId} className="m-0 text-base font-semibold text-brand-text">
					{title}
				</h3>
				<MenuTrigger>
					<Button
						data-print="hide"
						aria-label={`${t("charts.download", "Download")}: ${title}`}
						className="rounded border border-brand-border-control px-2 py-1 text-sm text-brand-interactive data-[hovered]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
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
							).map(([id, label]) => (
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
			<figcaption className="text-sm text-brand-text-muted">
				{notes.map((note) => (
					<span key={note} className="block">
						{note}
					</span>
				))}
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
