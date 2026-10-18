// Disaster impact panel 3: annotated timeline (layout P3, with P7 folded in
// as the "by hazard" toggle). One column per year. A year no record
// reported is an outlined gap labelled in words, never a drop to 0 (W-7);
// a confirmed zero is a mark on the baseline. Up to three annotations name
// peak years in words. Hazards are labelled, and their small multiples
// share one neutral ink: a hazard type is never a series colour (NFR-094).
import React, { useState } from "react";
import { ToggleButton } from "react-aria-components";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { ViewContext } from "~/frontend/context";
import type { ImpactTimeline as ImpactTimelinePayload, PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import { dataTokens } from "~/utils/designTokens.generated";
import { hazardColour } from "~/utils/hazardIdentity";
import { STATE_ENCODING } from "~/utils/mapState";
import { cellRow, panelNotes, type PanelExport } from "../../panelCell";
import { impactMeasureLabel } from "./measureLabels";
import { DASHBOARD_BAR } from "~/frontend/charts/sectionPalette";

type YearCell = { year: number; cell: PanelCell };

const PAD_TOP = 22;
const PAD_BOTTOM = 18;

export function YearColumns({
	years,
	annotations = [],
	height,
	width,
	label,
	noDataText,
	fill = DASHBOARD_BAR,
}: {
	/** Bar colour: the section palette's bar (Alex, 2026-10-18). */
	fill?: string;
	years: YearCell[];
	annotations?: { year: number; label: string }[];
	height: number;
	/** viewBox width; the columns share it, at most 48 units each, centred. */
	width: number;
	label: string;
	noDataText: string;
}) {
	const slot = Math.min(48, width / Math.max(1, years.length));
	const offset = (width - slot * years.length) / 2;
	const plot = height - PAD_TOP - PAD_BOTTOM;
	const max = Math.max(
		1,
		...years.map((y) => (y.cell.valueState === "reported" && y.cell.value ? y.cell.value : 0)),
	);
	const bar = Math.max(3, slot * 0.7);
	const base = PAD_TOP + plot;
	const zero = STATE_ENCODING.zero_confirmed;
	const tickEvery = years.length > 12 ? Math.ceil(years.length / 8) : 1;
	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			width="100%"
			height={height}
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label={label}
			className="block max-w-full"
			fontSize={10}
		>
			<line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} stroke={dataTokens.chart.axis} />
			{years.map((y, i) => {
				const x = offset + i * slot + (slot - bar) / 2;
				const { valueState, value } = y.cell;
				const ann = annotations.find((a) => a.year === y.year);
				let mark: React.ReactNode;
				let top = base;
				if (valueState === "reported" && value !== null && value > 0) {
					const h = Math.max(1, (value / max) * plot);
					top = base - h;
					mark = <path d={roundedBarPath(x, top, bar, h, "up")} fill={fill} />;
				} else if (valueState === "zero_confirmed") {
					mark = (
						<rect
							x={x}
							y={base - 3}
							width={bar}
							height={3}
							fill={zero.fill}
							stroke={zero.stroke}
							strokeDasharray={zero.dashArray ?? undefined}
						/>
					);
				} else {
					top = PAD_TOP;
					// No record that year: left vacant (Alex, 2026-10-18), never a 0
					// bar. An invisible slot keeps the year's hover text.
					mark = (
						<rect x={x} y={PAD_TOP} width={bar} height={plot} fill="transparent">
							<title>{`${y.year}: ${noDataText}`}</title>
						</rect>
					);
				}
				return (
					<g key={y.year}>
						{mark}
						{ann && (
							// Anchored inwards near an edge, so the label is never cut off.
							<text
								x={x + bar / 2}
								y={Math.max(10, top - 4)}
								textAnchor={x < width * 0.25 ? "start" : x > width * 0.75 ? "end" : "middle"}
								fontWeight={600}
								fill="currentColor"
							>
								{ann.label}
							</text>
						)}
						{i % tickEvery === 0 && (
							<text x={x + bar / 2} y={height - 4} textAnchor="middle" fill="currentColor">
								{y.year}
							</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}

/**
 * Panel 3's rows and notes. On screen the rows follow the toggle; the
 * page-level CSV takes both (`view` "all"): the series, then each hazard.
 */
export function timelineExport(
	ctx: ViewContext,
	timeline: ImpactTimelinePayload,
	meta: PanelMeta,
	view: "total" | "by_hazard" | "all" = "total",
): PanelExport {
	const total = timeline.years.map((y) => cellRow(String(y.year), y.cell));
	const hazards = timeline.byHazard
		.slice(0, 6)
		.flatMap((h) => h.years.map((y) => cellRow(String(y.year), y.cell, h.label)));
	const rows = view === "total" ? total : view === "by_hazard" ? hazards : [...total, ...hazards];
	const notes = panelNotes(meta, [
		ctx.t({
			code: "dashboard.timeline_caveat",
			msg: "More records in later years can reflect more reporting, not more impact.",
		}),
		ctx.t({ code: "dashboard.timeline_gaps", msg: "Outlined years: no record reported this measure." }),
	]);
	return { rows, method: meta.method, notes };
}

export interface ImpactTimelineProps {
	ctx: ViewContext;
	title: string;
	timeline: ImpactTimelinePayload;
	meta: PanelMeta;
	source: string;
	scope: string;
	provisional: boolean;
}

export function ImpactTimeline({ ctx, title, timeline, meta, source, scope, provisional }: ImpactTimelineProps) {
	const t = ctx.t;
	const [byHazard, setByHazard] = useState(false);
	const measure = impactMeasureLabel(ctx, timeline.measure);
	const noData = STATE_ENCODING.not_reported.label;
	const smallMultiples = timeline.byHazard.slice(0, 6);

	const { rows, notes } = timelineExport(ctx, timeline, meta, byHazard ? "by_hazard" : "total");

	return (
		<ChartFrame
			ctx={ctx}
			title={title}
			rows={rows}
			meta={{ source, scope, method: meta.method, basis: provisional ? "provisional" : "published", notes }}
		>
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2" data-print="hide">
					<span className="text-sm text-brand-text-muted">{measure}</span>
					<ToggleButton
						isSelected={byHazard}
						onChange={setByHazard}
						isDisabled={timeline.byHazard.length === 0}
						className="rounded border border-brand-border-control bg-brand-surface px-2 py-1 text-sm text-brand-interactive data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[disabled]:cursor-not-allowed data-[disabled]:text-brand-text-muted data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
					>
						{t({ code: "dashboard.by_hazard", msg: "By hazard" })}
					</ToggleButton>
				</div>
				{byHazard ? (
					<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
						{smallMultiples.map((h) => (
							<li key={h.hipTypeId} className="flex flex-col gap-1">
								<span className="flex items-center gap-1 text-sm font-semibold">
									<span
										aria-hidden="true"
										className="inline-block h-3 w-3 rounded-full"
										style={{ background: hazardColour(h.hipTypeId) }}
									/>
									{h.label}
								</span>
								<YearColumns
									years={h.years}
									height={90}
									width={240}
									label={`${h.label}: ${measure}`}
									noDataText={noData}
								/>
							</li>
						))}
						<li className="text-xs text-brand-text-muted sm:col-span-2">
							{t({
								code: "dashboard.small_multiples_axis",
								msg: "Each hazard has its own vertical scale.",
							})}
						</li>
					</ul>
				) : (
					<YearColumns
						years={timeline.years}
						annotations={timeline.annotations.slice(0, 3)}
						height={180}
						width={480}
						label={`${title}: ${measure}`}
						noDataText={noData}
					/>
				)}
			</div>
		</ChartFrame>
	);
}

export default ImpactTimeline;
