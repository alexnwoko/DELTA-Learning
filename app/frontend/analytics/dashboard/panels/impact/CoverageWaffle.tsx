// Disaster impact panel 2: coverage waffle (layout P2). 100 squares share
// out the records in scope by value state for one measure: reported,
// confirmed zero, not reported. The parts sum to all records in scope, so
// the part-to-whole form is honest. Flagged records (C30) are a subset of
// the reported ones and show as an outline on those squares, not a part.
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { CoverageWaffle as CoverageWafflePayload, PanelMeta } from "~/utils/dashboard/impactPanels";
import { PLAUSIBILITY_MARKER, STATE_ENCODING } from "~/utils/mapState";
import { panelNotes, type PanelExport } from "../../panelCell";
import { impactMeasureLabel } from "./measureLabels";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";

export const WAFFLE_CELLS = 100;

/**
 * Shares out `cells` squares in proportion to `counts` by the largest
 * remainder, so the squares always add up to `cells`. A part with records
 * keeps at least one square, so a small part never disappears.
 */
export function waffleShares(counts: number[], cells = WAFFLE_CELLS): number[] {
	const total = counts.reduce((a, b) => a + b, 0);
	if (total <= 0) return counts.map(() => 0);
	const exact = counts.map((c) => (c / total) * cells);
	const shares = exact.map((e, i) => (counts[i] > 0 ? Math.max(1, Math.floor(e)) : 0));
	let left = cells - shares.reduce((a, b) => a + b, 0);
	const order = exact
		.map((e, i) => ({ i, rem: e - Math.floor(e) }))
		.filter(({ i }) => counts[i] > 0)
		.sort((a, b) => b.rem - a.rem);
	for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) shares[order[k].i]++;
	// The one-square floor can overshoot: take back from the largest part.
	while (left < 0) {
		const largest = shares.indexOf(Math.max(...shares));
		shares[largest]--;
		left++;
	}
	return shares;
}

const SIZE = 14;
const GAP = 2;
const SIDE = 10 * SIZE + 9 * GAP;

/** Panel 2's rows and notes, for its frame and the page-level CSV. */
export function waffleExport(ctx: ViewContext, coverage: CoverageWafflePayload, meta: PanelMeta): PanelExport {
	const t = ctx.t;
	const record = (label: string, value: number): ChartExportRow =>
		// A count of records is always a reported figure: every record has a state.
		({ label, value, valueState: "reported", unit: "records" });
	return {
		rows: [
			record(t({ code: "dashboard.state_reported", msg: "Reported" }), coverage.recordsReported),
			record(STATE_ENCODING.zero_confirmed.label, coverage.recordsZeroConfirmed),
			record(STATE_ENCODING.not_reported.label, coverage.recordsNotReported),
			record(
				t({ code: "dashboard.flagged_records", msg: "Flagged for review (part of reported)" }),
				coverage.recordsFlagged,
			),
		],
		method: meta.method,
		notes: panelNotes(meta, [
			t(
				{ code: "dashboard.waffle_note", msg: "{measure}: {total} records in scope; one square is about 1% of them" },
				{
					measure: impactMeasureLabel(ctx, coverage.measure),
					total: coverage.recordsTotal.toLocaleString(ctx.lang),
				},
			),
		]),
	};
}

export interface CoverageWaffleProps {
	ctx: ViewContext;
	title: string;
	coverage: CoverageWafflePayload;
	meta: PanelMeta;
	source: string;
	scope: string;
	provisional: boolean;
}

export function CoverageWaffle({ ctx, title, coverage, meta, source, scope, provisional }: CoverageWaffleProps) {
	const t = ctx.t;
	const parts = [
		{
			key: "reported" as const,
			label: t({ code: "dashboard.state_reported", msg: "Reported" }),
			count: coverage.recordsReported,
			fill: DASHBOARD_RAMP[3],
			stroke: DASHBOARD_RAMP[4],
			dash: undefined as string | undefined,
		},
		{
			key: "zero_confirmed" as const,
			label: STATE_ENCODING.zero_confirmed.label,
			count: coverage.recordsZeroConfirmed,
			fill: STATE_ENCODING.zero_confirmed.fill,
			stroke: STATE_ENCODING.zero_confirmed.stroke,
			dash: STATE_ENCODING.zero_confirmed.dashArray ?? undefined,
		},
		{
			key: "not_reported" as const,
			label: STATE_ENCODING.not_reported.label,
			count: coverage.recordsNotReported,
			fill: STATE_ENCODING.not_reported.fill,
			stroke: STATE_ENCODING.not_reported.stroke,
			dash: STATE_ENCODING.not_reported.dashArray ?? undefined,
		},
	];
	const shares = waffleShares(parts.map((p) => p.count));
	// Flagged squares: the first reported ones, in proportion to the flag count.
	const flaggedSquares =
		coverage.recordsReported > 0 && coverage.recordsFlagged > 0
			? Math.max(1, Math.round((coverage.recordsFlagged / coverage.recordsReported) * shares[0]))
			: 0;
	const squares: { part: number; flagged: boolean }[] = [];
	shares.forEach((n, part) => {
		for (let i = 0; i < n; i++) squares.push({ part, flagged: part === 0 && i < flaggedSquares });
	});
	const total = coverage.recordsTotal;
	const pct = (n: number) =>
		total > 0 ? `${Math.round((n / total) * 100).toLocaleString(ctx.lang)}%` : "";
	const { rows, notes } = waffleExport(ctx, coverage, meta);

	return (
		<ChartFrame
			ctx={ctx}
			title={title}
			rows={rows}
			meta={{ source, scope, method: meta.method, basis: provisional ? "provisional" : "published", notes }}
		>
			<div className="flex flex-wrap items-start gap-4">
				<svg
					width={SIDE}
					height={SIDE}
					viewBox={`0 0 ${SIDE} ${SIDE}`}
					role="img"
					aria-label={parts.map((p) => `${p.label}: ${p.count} (${pct(p.count)})`).join("; ")}
					className="shrink-0"
				>
					{squares.map((sq, i) => {
						const p = parts[sq.part];
						const x = (i % 10) * (SIZE + GAP);
						const y = Math.floor(i / 10) * (SIZE + GAP);
						return (
							<rect
								key={i}
								x={x + 0.5}
								y={y + 0.5}
								width={SIZE - 1}
								height={SIZE - 1}
								fill={p.fill}
								stroke={sq.flagged ? PLAUSIBILITY_MARKER.stroke : p.stroke}
								strokeWidth={sq.flagged ? 2 : 1}
								strokeDasharray={sq.flagged ? undefined : p.dash}
							/>
						);
					})}
				</svg>
				<ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
					{parts.map((p) => (
						<li key={p.key} className="flex items-center gap-2">
							<svg width={14} height={14} aria-hidden="true" focusable="false">
								<rect x={0.5} y={0.5} width={13} height={13} fill={p.fill} stroke={p.stroke} strokeDasharray={p.dash} />
							</svg>
							<span>
								{p.label}: <span className="font-semibold tabular-nums">{p.count.toLocaleString(ctx.lang)}</span>{" "}
								<span className="text-brand-text-muted">({pct(p.count)})</span>
							</span>
						</li>
					))}
					{coverage.recordsFlagged > 0 && (
						<li className="flex items-center gap-2">
							<svg width={14} height={14} aria-hidden="true" focusable="false">
								<rect x={1} y={1} width={12} height={12} fill="none" stroke={PLAUSIBILITY_MARKER.stroke} strokeWidth={2} />
							</svg>
							<span>
								{t(
									{ code: "dashboard.waffle_flagged", msg: "Outlined: {n} reported records flagged for review" },
									{ n: coverage.recordsFlagged.toLocaleString(ctx.lang) },
								)}
							</span>
						</li>
					)}
				</ul>
			</div>
		</ChartFrame>
	);
}

export default CoverageWaffle;
