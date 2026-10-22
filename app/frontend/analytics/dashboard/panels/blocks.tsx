// Building blocks shared by the dashboard panels: a shaded table (matrices
// and grids) and horizontal bars (rankings and grouped bars). Both draw a
// figure only when a record reported it; every other state shows its word
// in place, never a 0 or an empty bar (TR-076).
import type { ViewContext } from "~/frontend/context";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import { cellText, coverageText } from "../panelCell";
import { UX } from "~/frontend/uxFeatures";
import { useState } from "react";
import { DASHBOARD_BAR, DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";

const reportedValue = (cell: PanelCell): number | null =>
	cell.valueState === "reported" && cell.value !== null && cell.value > 0 ? cell.value : null;

/**
 * Shade steps for a table cell: the three lightest steps of the people
 * ramp, so dark text stays readable on every step (WCAG 1.4.3).
 */
// Shades only ever sit behind dark text, so the palette's three lightest steps.
export const SHADE_STEPS = DASHBOARD_RAMP.slice(0, 3);

/** The shade for a reported value against the largest in its group. */
export function shadeFor(value: number | null, max: number, steps: readonly string[] = SHADE_STEPS): string | undefined {
	if (value === null || max <= 0) return undefined;
	const step = Math.min(steps.length - 1, Math.floor((value / max) * steps.length));
	return steps[step];
}

/**
 * Largest first (Alex, 2026-10-22): category charts and tables read from
 * the biggest value down. A row with no reported value follows the numbers,
 * and the catch-all rows ("none": no division or hazard recorded; "rest":
 * the n others) stay last, in their own order. Ordered categories (bins,
 * age groups, decades) pass "given" and keep their natural order.
 */
export function isPinnedRow(key: string, pinned?: boolean): boolean {
	return Boolean(pinned) || key === "none" || key === "rest";
}

export function sortByValueDesc<R extends { key: string; pinned?: boolean }>(rows: readonly R[], value: (r: R) => number | null, tie?: (r: R) => number): R[] {
	const indexed = rows.map((r, i) => ({ r, i, v: value(r) }));
	const rank = (x: (typeof indexed)[number]) => (isPinnedRow(x.r.key, x.r.pinned) ? 2 : x.v === null ? 1 : 0);
	return indexed
		.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (b.v as number) - (a.v as number) || (tie ? tie(b.r) - tie(a.r) : 0) : 0) || a.i - b.i)
		.map((x) => x.r);
}

export interface ShadedTableProps {
	ctx: ViewContext;
	/** Already translated: what the table shows, for screen readers. */
	caption: string;
	rowHeader: string;
	columns: string[];
	rows: { key: string; label: React.ReactNode; cells: PanelCell[] }[];
	/** Shade against the largest value in each column, or in the whole table. */
	normalise: "column" | "table";
	/** Light-to-dark shades: the section palette's (default: main dashboard). */
	shades?: readonly string[];
	/**
	 * Row order: by the row total (default), by the first column where the
	 * columns are different measures that must not be added (deaths, houses),
	 * or as given for ordered rows (decades). Columns never move.
	 */
	order?: "total" | "first" | "given";
}

/** A matrix as a real table; shading only ever helps the numbers. */
export function ShadedTable({ ctx, caption, rowHeader, columns, rows: given, normalise, shades = SHADE_STEPS, order = "total" }: ShadedTableProps) {
	const total = (r: ShadedTableProps["rows"][number]) => {
		const vs = r.cells.map(reportedValue).filter((v): v is number => v !== null);
		return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
	};
	const rows =
		order === "given"
			? given
			: sortByValueDesc(given, order === "first" ? (r) => reportedValue(r.cells[0]) : total, (r) => total(r) ?? 0);
	const columnMax = columns.map((_, i) => Math.max(0, ...rows.map((r) => reportedValue(r.cells[i]) ?? 0)));
	const tableMax = Math.max(0, ...columnMax);
	const th = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
	return (
		<div className="max-w-full overflow-x-auto">
			<table className="w-full border-collapse text-sm text-brand-text">
				<caption className="sr-only">{caption}</caption>
				<thead>
					<tr>
						<th scope="col" className={`${th} text-start`}>
							{rowHeader}
						</th>
						{columns.map((c) => (
							<th key={c} scope="col" className={`${th} text-end`}>
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.key}>
							<th scope="row" className="border-b border-brand-border px-2 py-1 text-start font-normal">
								{r.label}
							</th>
							{r.cells.map((cell, i) => {
								const value = reportedValue(cell);
								const shade = shadeFor(value, normalise === "column" ? columnMax[i] : tableMax, shades);
								return (
									<td
										key={i}
										className={`border-b border-brand-border px-2 py-1 text-end tabular-nums ${value === null ? "text-brand-text-muted italic" : ""}`}
										style={shade ? { background: shade } : undefined}
									>
										{cellText(ctx, cell)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export interface BarSeries {
	/** Already translated. */
	name: string;
	fill: string;
}

/** UX-3: a row's filter, except for the "none" and "rest" rows, which name no single place or type. */
export function rowFilter(kind: "division" | "hazard", id: string | null | undefined): { kind: "division" | "hazard"; id: string } | undefined {
	return id && id !== "none" && id !== "rest" ? { kind, id } : undefined;
}

export interface RowBarsProps {
	ctx: ViewContext;
	/** Already translated: the chart in words, for screen readers. */
	label: string;
	rows: {
		key: string;
		label: string;
		note?: string;
		bars: { series?: BarSeries; cell: PanelCell }[];
		/** UX-3: clicking the row filters the page by this division or hazard type. */
		filter?: { kind: "division" | "hazard"; id: string };
		/** A catch-all row ("n other sources") that stays last; "none" and "rest" keys always do. */
		pinned?: boolean;
	}[];
	/**
	 * Largest first by default, on the first bar (the lead measure: destroyed
	 * before damaged, displaced before evacuated), ties by the row total.
	 * "given" keeps ordered categories (bins, age groups) as they come.
	 */
	order?: "value" | "given";
	/** A legend entry per series; omit for one series. */
	series?: BarSeries[];
	/** Words for a not-reported slot, when the panel has its own (e.g. "No records linked"). */
	notReportedText?: string;
}

const BAR_H = 12;
const BAR_GAP = 3;
const LABEL_W = 140;
const WIDTH = 380;

/**
 * Horizontal bars, one group per row and one bar per series. A figure no
 * record reported has no bar: its slot says the state in words. All bars
 * share one scale, so the chart never suggests that series add up.
 */
export function RowBars({ ctx, label, rows: given, series, notReportedText, order = "value" }: RowBarsProps) {
	const rows =
		order === "given"
			? given
			: sortByValueDesc(given, (r) => (r.bars[0] ? reportedValue(r.bars[0].cell) : null), (r) => r.bars.reduce((a, b) => a + (reportedValue(b.cell) ?? 0), 0));
	// UX-4: a hover card with the value, its state and the records behind it.
	const [card, setCard] = useState<{ x: number; y: number; lines: string[] } | null>(null);
	const cardFor = (r: RowBarsProps["rows"][number]) => [
		r.label,
		...r.bars.map((b) => `${b.series && series && series.length > 1 ? `${b.series.name}: ` : ""}${cellText(ctx, b.cell)} · ${coverageText(ctx, b.cell)}`),
		...(r.filter && UX[3] ? [ctx.t({ code: "dashboard.click_to_filter", msg: "Click to filter the page" })] : []),
	];
	const max = Math.max(1, ...rows.flatMap((r) => r.bars.map((b) => reportedValue(b.cell) ?? 0)));
	const track = WIDTH - LABEL_W - 70;
	// Rows sit close (Alex, 2026-10-20): a single bar takes 18 px, a 6 px gap.
	const groupH = (r: RowBarsProps["rows"][number]) =>
		Math.max(18, r.bars.length * (BAR_H + BAR_GAP) + (r.note ? 14 : 0) + 6);
	let y = 2;
	const placed = rows.map((r) => {
		const top = y;
		y += groupH(r);
		return { r, top };
	});
	return (
		<div className="relative flex flex-col gap-2">
			{series && series.length > 1 && (
				<ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-sm">
					{series.map((s) => (
						<li key={s.name} className="flex items-center gap-1">
							<span aria-hidden="true" className="inline-block h-3 w-3" style={{ background: s.fill }} />
							{s.name}
						</li>
					))}
				</ul>
			)}
			<svg
				viewBox={`0 0 ${WIDTH} ${y + 2}`}
				width="100%"
				height={y + 2}
				preserveAspectRatio="xMinYMin meet"
				role="img"
				aria-label={label}
				fontSize={11}
				// UX-8: bars glide to new values (the delta-anim class, dashboard.css).
				className={`block max-w-full${UX[8] ? " delta-anim" : ""}`}
				onMouseLeave={() => setCard(null)}
			>
				{placed.map(({ r, top }) => (
					<g
						key={r.key}
						// UX-3: the click is caught by the dashboard and sets the page filter.
						data-filter-kind={UX[3] && r.filter ? r.filter.kind : undefined}
						data-filter-id={UX[3] && r.filter ? r.filter.id : undefined}
						style={UX[3] && r.filter ? { cursor: "pointer" } : undefined}
						onMouseMove={
							UX[4]
								? (e) => {
										const box = (e.currentTarget.ownerSVGElement?.parentElement ?? e.currentTarget).getBoundingClientRect();
										setCard({ x: e.clientX - box.left + 12, y: e.clientY - box.top + 12, lines: cardFor(r) });
									}
								: undefined
						}
					>
						<text x={0} y={top + 11} fill="currentColor" fontWeight={600}>
							{r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
							<title>{r.label}</title>
						</text>
						{r.note && (
							<text x={0} y={top + 24} fill="currentColor" opacity={0.75} fontSize={10}>
								{r.note}
							</text>
						)}
						{r.bars.map((b, i) => {
							const by = top + i * (BAR_H + BAR_GAP);
							const value = reportedValue(b.cell);
							const prefix = b.series && series && series.length > 1 ? `${b.series.name}: ` : "";
							if (value === null) {
								return (
									<text key={i} x={LABEL_W} y={by + 10} fill="currentColor" fontStyle="italic" fontSize={10}>
										{prefix}
										{notReportedText && b.cell.valueState === "not_reported" ? notReportedText : cellText(ctx, b.cell)}
									</text>
								);
							}
							const w = Math.max(1, (value / max) * track);
							return (
								<g key={i}>
									<path
										d={roundedBarPath(LABEL_W, by, w, BAR_H, "right")}
										fill={b.series?.fill ?? DASHBOARD_BAR}
									/>
									<text x={LABEL_W + w + 4} y={by + 10} fill="currentColor" fontSize={10}>
										{cellText(ctx, b.cell)}
									</text>
								</g>
							);
						})}
					</g>
				))}
			</svg>
			{UX[4] && card && (
				<div
					aria-hidden="true"
					data-print="hide"
					className="delta-layer pointer-events-none absolute z-10 max-w-64 px-2.5 py-1.5 text-xs text-data-dashboard-ink"
					style={{ insetInlineStart: card.x, top: card.y }}
				>
					<span className="delta-panel-title block">{card.lines[0]}</span>
					{card.lines.slice(1).map((l) => <span key={l} className="block">{l}</span>)}
				</div>
			)}
		</div>
	);
}

