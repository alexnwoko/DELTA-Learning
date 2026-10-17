// Disaster impact panel 4: hazard ranking (layout P5), a sorted lollipop
// per HIPs type. A type with no reported figure is listed with its state
// word and has no stem, never a zero stem. Each hazard carries its name and
// its identity colour on the dot; the stems share one neutral ink (NFR-094).
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ViewContext } from "~/frontend/context";
import type { HazardRankingRow, PanelMeta } from "~/utils/dashboard/impactPanels";
import { dataTokens } from "~/utils/designTokens.generated";
import { hazardColour } from "~/utils/hazardIdentity";
import { cellRow, cellText, coverageText, panelNotes, type PanelExport } from "../../panelCell";

/** Splits a hazard name over at most two lines of about `max` characters. */
export function wrapLabel(label: string, max = 22): [string, string?] {
	if (label.length <= max) return [label];
	const cut = label.lastIndexOf(" ", max);
	const first = cut > 0 ? label.slice(0, cut) : label.slice(0, max);
	const rest = label.slice(first.length).trim();
	return [first, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

const ROW = 46;
const LABEL_W = 150;
const WIDTH = 360;

/** Reported figures first, largest first; every other state after them. */
export function rankHazards(rows: HazardRankingRow[]): HazardRankingRow[] {
	const drawn = (r: HazardRankingRow) => r.cell.valueState === "reported" && r.cell.value !== null;
	return [...rows].sort((a, b) => {
		if (drawn(a) !== drawn(b)) return drawn(a) ? -1 : 1;
		if (drawn(a)) return (b.cell.value as number) - (a.cell.value as number);
		return a.label.localeCompare(b.label);
	});
}

/** Panel 4's rows and notes, for its frame and the page-level CSV. */
export function rankingExport(rows: HazardRankingRow[], meta: PanelMeta): PanelExport {
	return { rows: rankHazards(rows).map((r) => cellRow(r.label, r.cell)), method: meta.method, notes: panelNotes(meta) };
}

export interface HazardRankingProps {
	ctx: ViewContext;
	title: string;
	measureLabel: string;
	rows: HazardRankingRow[];
	meta: PanelMeta;
	source: string;
	scope: string;
	provisional: boolean;
}

export function HazardRanking({
	ctx,
	title,
	measureLabel,
	rows,
	meta,
	source,
	scope,
	provisional,
}: HazardRankingProps) {
	const ranked = rankHazards(rows);
	const max = Math.max(
		1,
		...ranked.map((r) => (r.cell.valueState === "reported" && r.cell.value ? r.cell.value : 0)),
	);
	const { rows: exportRows, notes } = rankingExport(rows, meta);

	return (
		<ChartFrame
			ctx={ctx}
			title={title}
			rows={exportRows}
			meta={{ source, scope, method: meta.method, basis: provisional ? "provisional" : "published", notes }}
		>
			<div className="flex flex-col gap-1">
				<span className="text-sm text-brand-text-muted">{measureLabel}</span>
				{/* One SVG, so the exported picture matches the screen. */}
				<svg
					viewBox={`0 0 ${WIDTH} ${ranked.length * ROW + 4}`}
					width="100%"
					height={ranked.length * ROW + 4}
					preserveAspectRatio="xMinYMin meet"
					role="img"
					aria-label={ranked.map((r) => `${r.label}: ${cellText(ctx, r.cell)}`).join("; ")}
					fontSize={12}
					className="block max-w-full"
				>
					{ranked.map((r, i) => {
						const y = i * ROW + 4;
						const value = r.cell.valueState === "reported" ? r.cell.value : null;
						const [line1, line2] = wrapLabel(r.label);
						const stemEnd = LABEL_W + 4 + (value ? (value / max) * (WIDTH - LABEL_W - 70) : 0);
						return (
							<g key={r.hipTypeId}>
								<text x={0} y={y + 12} fill="currentColor" fontWeight={600}>
									<tspan x={0}>{line1}</tspan>
									{line2 && (
										<tspan x={0} dy={14}>
											{line2}
										</tspan>
									)}
								</text>
								<text x={0} y={y + (line2 ? 40 : 26)} fill="currentColor" opacity={0.75} fontSize={10}>
									{coverageText(ctx, r.cell)}
								</text>
								{value !== null && value > 0 ? (
									<>
										<line x1={LABEL_W + 4} x2={stemEnd} y1={y + 12} y2={y + 12} stroke={dataTokens.chart.axis} strokeWidth={2} />
										<circle cx={stemEnd} cy={y + 12} r={5} fill={hazardColour(r.hipTypeId)} />
										<text x={stemEnd + 9} y={y + 16} fill="currentColor">
											{cellText(ctx, r.cell)}
										</text>
									</>
								) : (
									<text x={LABEL_W + 4} y={y + 16} fill="currentColor" fontStyle="italic">
										{cellText(ctx, r.cell)}
									</text>
								)}
							</g>
						);
					})}
				</svg>
			</div>
		</ChartFrame>
	);
}

export default HazardRanking;
