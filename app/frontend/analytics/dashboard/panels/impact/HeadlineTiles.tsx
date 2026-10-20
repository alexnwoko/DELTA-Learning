// Disaster impact panel 1: headline tiles with a 10-year sparkline (layout
// P1). Each tile shows the figure or its state word, never a bare 0, with
// "n of N records" under it (TR-076, W-8). Money shows its refusal until
// the monetary convention is ruled (G-06, MONETARY_CONVENTIONS_PENDING).
// No green-up or red-down: the sparkline is one neutral ink.
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import { MEASURE_ICONS } from "~/frontend/charts/dashboardIcons";
import { PanelIcon } from "~/frontend/charts/PanelIcon";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { ViewContext } from "~/frontend/context";
import type { HeadlineTile, PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import { STATE_ENCODING } from "~/utils/mapState";
import { cellRow, cellText, coverageText, flaggedText, panelNotes, type PanelExport } from "../../panelCell";
import { impactMeasureLabel } from "./measureLabels";
import { DASHBOARD_BAR } from "~/frontend/charts/sectionPalette";

// The sparkline stretches to its tile (Alex, 2026-10-18: panel 1 is as
// tall as Ranked by divisions beside it); strokes keep their width.
const SPARK_W = 120;
const SPARK_H = 48;

/** Column sparkline: a missing year is left vacant, never a 0 bar (Alex, 2026-10-18). */
export function Sparkline({ points }: { points: { year: number; cell: PanelCell }[] }) {
	if (points.length === 0) return null;
	const max = Math.max(
		1,
		...points.map((p) => (p.cell.valueState === "reported" && p.cell.value ? p.cell.value : 0)),
	);
	const slot = SPARK_W / points.length;
	const bar = Math.max(2, slot - 2);
	const zero = STATE_ENCODING.zero_confirmed;
	return (
		<svg
			viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
			preserveAspectRatio="none"
			aria-hidden="true"
			focusable="false"
			className="absolute inset-0 block h-full w-full overflow-visible"
		>
			{points.map((p, i) => {
				const x = i * slot + (slot - bar) / 2;
				const { valueState, value } = p.cell;
				if (valueState === "reported" && value !== null && value > 0) {
					const h = Math.max(1, (value / max) * (SPARK_H - 2));
					return (
						<path key={p.year} d={roundedBarPath(x, SPARK_H - h, bar, h, "up", 3)} fill={DASHBOARD_BAR}>
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
							vectorEffect="non-scaling-stroke"
						/>
					);
				}
				// Not reported, or any other state: left vacant.
				return null;
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
			<ul className="m-0 grid flex-1 list-none auto-rows-fr grid-cols-2 gap-3 p-0 sm:grid-cols-3">
				{tiles.map((tile) => {
					const label = impactMeasureLabel(ctx, tile.measure);
					const value = cellText(ctx, tile.cell);
					const isNumber = tile.cell.valueState === "reported" && tile.cell.value !== null;
					const flagged = flaggedText(ctx, tile.cell);
					return (
						<li
							key={tile.measure}
							className="delta-panel-tile flex min-w-0 flex-col gap-1 rounded-[0.714rem] border p-3"
						>
							<span className="delta-panel-title flex items-center gap-1.5 text-sm">
								<PanelIcon name={MEASURE_ICONS[tile.measure]} size={31} />
								{label}
							</span>
							<span
								className={isNumber ? "text-2xl font-extrabold tabular-nums text-data-dashboard-ink" : "text-base font-semibold text-brand-text-muted"}
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
								<span className="mt-1 flex flex-1 flex-col gap-0.5">
									{/* 50% taller bars (Alex, 2026-10-20): 37 px at least, then the tile's free space. */}
									<span className="relative block min-h-[37px] flex-1">
										<Sparkline points={tile.sparkline} />
									</span>
									<span className="text-xs text-brand-text-muted">
										{tile.sparkline[0].year} to {tile.sparkline[tile.sparkline.length - 1].year}
									</span>
								</span>
							)}
						</li>
					);
				})}
				<li className="delta-panel-tile flex min-w-0 flex-col gap-1 rounded-[0.714rem] border border-dashed p-3">
					<span className="delta-panel-title flex items-center gap-1.5 text-sm">
						<PanelIcon name={MEASURE_ICONS.money} size={31} />
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
