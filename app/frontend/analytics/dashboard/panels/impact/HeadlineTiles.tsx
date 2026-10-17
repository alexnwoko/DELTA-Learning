// Disaster impact panel 1: headline tiles with a 10-year sparkline (layout
// P1). Each tile shows the figure or its state word, never a bare 0, with
// "n of N records" under it (TR-076, W-8). Money shows its refusal until
// the monetary convention is ruled (G-06, MONETARY_CONVENTIONS_PENDING).
// No green-up or red-down: the sparkline is one neutral ink.
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { ViewContext } from "~/frontend/context";
import type { HeadlineTile, PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import { dataTokens } from "~/utils/designTokens.generated";
import { STATE_ENCODING } from "~/utils/mapState";
import { cellRow, cellText, coverageText, flaggedText, panelNotes, type PanelExport } from "../../panelCell";
import { impactMeasureLabel } from "./measureLabels";

const SPARK_W = 120;
const SPARK_H = 28;

/** Column sparkline: a missing year is an empty dashed slot, never a 0 bar. */
export function Sparkline({ points }: { points: { year: number; cell: PanelCell }[] }) {
	if (points.length === 0) return null;
	const max = Math.max(
		1,
		...points.map((p) => (p.cell.valueState === "reported" && p.cell.value ? p.cell.value : 0)),
	);
	const slot = SPARK_W / points.length;
	const bar = Math.max(2, slot - 2);
	const nr = STATE_ENCODING.not_reported;
	const zero = STATE_ENCODING.zero_confirmed;
	return (
		<svg
			width={SPARK_W}
			height={SPARK_H}
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			aria-hidden="true"
			focusable="false"
			className="block overflow-visible"
		>
			{points.map((p, i) => {
				const x = i * slot + (slot - bar) / 2;
				const { valueState, value } = p.cell;
				if (valueState === "reported" && value !== null && value > 0) {
					const h = Math.max(1, (value / max) * (SPARK_H - 2));
					return (
						<path key={p.year} d={roundedBarPath(x, SPARK_H - h, bar, h, "up", 3)} fill={dataTokens.chart.axis}>
							<title>{`${p.year}: ${value}`}</title>
						</path>
					);
				}
				if (valueState === "zero_confirmed") {
					return (
						<line
							key={p.year}
							x1={x}
							x2={x + bar}
							y1={SPARK_H - 0.5}
							y2={SPARK_H - 0.5}
							stroke={zero.stroke}
							strokeWidth={zero.strokeWidth}
						/>
					);
				}
				// Not reported, or any other state: an outlined empty slot.
				return (
					<rect
						key={p.year}
						x={x + 0.5}
						y={0.5}
						width={bar - 1}
						height={SPARK_H - 1}
						fill="none"
						stroke={nr.stroke}
						strokeWidth={1}
						strokeDasharray="2 2"
					/>
				);
			})}
		</svg>
	);
}

/** Panel 1's rows and notes, for its frame and the page-level CSV. */
export function headlineExport(ctx: ViewContext, tiles: HeadlineTile[], meta: PanelMeta): PanelExport {
	return {
		rows: tiles.map((tile) => cellRow(impactMeasureLabel(ctx, tile.measure), tile.cell)),
		method: meta.method,
		notes: panelNotes(meta),
	};
}

export interface HeadlineTilesProps {
	ctx: ViewContext;
	title: string;
	tiles: HeadlineTile[];
	meta: PanelMeta;
	source: string;
	scope: string;
	provisional: boolean;
}

export function HeadlineTiles({ ctx, title, tiles, meta, source, scope, provisional }: HeadlineTilesProps) {
	const { rows, notes } = headlineExport(ctx, tiles, meta);
	return (
		<ChartFrame
			ctx={ctx}
			title={title}
			rows={rows}
			meta={{ source, scope, method: meta.method, basis: provisional ? "provisional" : "published", notes }}
		>
			<ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
				{tiles.map((tile) => {
					const label = impactMeasureLabel(ctx, tile.measure);
					const value = cellText(ctx, tile.cell);
					const isNumber = tile.cell.valueState === "reported" && tile.cell.value !== null;
					const flagged = flaggedText(ctx, tile.cell);
					return (
						<li
							key={tile.measure}
							className="flex min-w-0 flex-col gap-1 rounded border border-brand-border bg-brand-surface-card p-3"
						>
							<span className="text-sm text-brand-text-muted">{label}</span>
							<span
								className={isNumber ? "text-2xl font-semibold tabular-nums" : "text-base font-semibold"}
							>
								{value}
							</span>
							<span className="text-xs text-brand-text-muted">{coverageText(ctx, tile.cell)}</span>
							{flagged && (
								<span className="self-start rounded bg-data-flag-review-chip-background px-1 text-xs text-data-flag-review-chip-text">
									{flagged}
								</span>
							)}
							{tile.sparkline.length > 0 && (
								<span className="mt-1 flex flex-col gap-0.5">
									<Sparkline points={tile.sparkline} />
									<span className="text-xs text-brand-text-muted">
										{tile.sparkline[0].year} to {tile.sparkline[tile.sparkline.length - 1].year}
									</span>
								</span>
							)}
						</li>
					);
				})}
				<li className="flex min-w-0 flex-col gap-1 rounded border border-dashed border-brand-border-control bg-brand-surface-subtle p-3">
					<span className="text-sm text-brand-text-muted">
						{ctx.t({ code: "dashboard.measure_money", msg: "Damage and losses" })}
					</span>
					<span className="text-sm font-semibold">
						{ctx.t({
							code: "dashboard.money_refused",
							msg: "Not shown: monetary convention pending",
						})}
					</span>
					<span className="text-xs text-brand-text-muted">G-06</span>
				</li>
			</ul>
		</ChartFrame>
	);
}

export default HeadlineTiles;
