// Building blocks shared by the dashboard panels: a shaded table (matrices
// and grids) and horizontal bars (rankings and grouped bars). Both draw a
// figure only when a record reported it; every other state shows its word
// in place, never a 0 or an empty bar (TR-076).
import type { ViewContext } from "~/frontend/context";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import { cellText } from "../panelCell";
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
}

/** A matrix as a real table; shading only ever helps the numbers. */
export function ShadedTable({ ctx, caption, rowHeader, columns, rows, normalise, shades = SHADE_STEPS }: ShadedTableProps) {
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

export interface RowBarsProps {
	ctx: ViewContext;
	/** Already translated: the chart in words, for screen readers. */
	label: string;
	rows: { key: string; label: string; note?: string; bars: { series?: BarSeries; cell: PanelCell }[] }[];
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
export function RowBars({ ctx, label, rows, series, notReportedText }: RowBarsProps) {
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
		<div className="flex flex-col gap-2">
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
				className="block max-w-full"
			>
				{placed.map(({ r, top }) => (
					<g key={r.key}>
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
		</div>
	);
}

