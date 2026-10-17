// Disaster impact panels 5 to 16 (panels paper v0.3, section 4.3). Each
// panel has an export function (rows and notes for its frame and the
// page-level CSV) and a view drawn inside ChartFrame. Rules held here:
// a figure no record reported is a word, never 0 (TR-076); figures that
// overlap are never added (O-2, TR-216); dwelling counts are inputs to B-3
// and B-4 and carry no indicator code; hazard types are labelled, never a
// series colour (NFR-094); money is absent with its refusal (G-06).
import type React from "react";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { PanelMeta } from "~/utils/dashboard/impactPanels";
import type {
	CompletenessMatrix,
	DisaggregationPanel,
	ExtensiveIntensive,
	HazardEffectMatrix,
	HazardSectorMatrix,
	HousesPanel,
	ImpactPanels5to16,
	LargestRecords,
	PeopleMovedPanel,
	PeriodChange,
	RankedDivisions,
	SeasonGrid,
	SendaiCountsPanel,
} from "~/utils/dashboard/impactPanels5to16";
import type { QueryHumanEffect } from "~/utils/deltaQuery";
import { dataTokens } from "~/utils/designTokens.generated";
import { STATE_ENCODING } from "~/utils/mapState";
import { cellRow, cellText, coverageText, panelNotes, type PanelExport } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { RowBars, ShadedTable, shadeFor, type BarSeries } from "../blocks";

type T = ViewContext["t"];
const tr = (t: T, code: string, msg: string, r?: Record<string, unknown>) => t({ code, msg }, r);

export function effectLabel(t: T, effect: QueryHumanEffect): string {
	const labels: Record<QueryHumanEffect, [string, string]> = {
		deaths: ["dashboard.measure_deaths", "Deaths"],
		missing: ["dashboard.measure_missing", "Missing"],
		injured: ["dashboard.measure_injured", "Injured or ill"],
		affected_direct: ["dashboard.measure_affected_direct", "Directly affected"],
		affected_indirect: ["dashboard.measure_affected_indirect", "Indirectly affected"],
		displaced: ["dashboard.measure_displaced", "Displaced"],
	};
	const [code, msg] = labels[effect];
	return t({ code, msg });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Three series inks from the people ramp: distinct in lightness and named
// in the legend and beside every bar, so colour is never the only signal.
const RAMP = dataTokens.ramp.people;

// ---------------------------------------------------------------------------
// Export functions: one per panel, the single source of each panel's rows.

/** Panel 5. Indicators keep their code; dwelling inputs never get one. */
export function sendaiExport(t: T, p: SendaiCountsPanel, meta: PanelMeta, country: string): PanelExport {
	const rows: ChartExportRow[] = [
		...p.indicators.map((i) => cellRow(`${i.code} ${i.label}`, i.cell)),
		...p.inputs.map((i) =>
			cellRow(tr(t, "dashboard.sendai_input", "{label} (input to {code}; no indicator value)", { label: i.label, code: i.inputTo }), i.cell),
		),
	];
	const notes = panelNotes(meta, [
		sendaiNotice(t, country),
		...p.refused.map((r) => tr(t, "dashboard.sendai_refused", "{code} not computed: {reason}", { code: r.code, reason: r.reason })),
	]);
	return { rows, method: meta.method, notes };
}

/** The disclaimer sentence of the disclaimer paper, naming the country. */
export function sendaiNotice(t: T, country: string): string {
	return tr(
		t,
		"dashboard.sendai_notice",
		"Sendai-aligned counts from national records. These figures are not the official Sendai Framework Monitor submission of {country}.",
		{ country },
	);
}

/** Panels 6 and 8: label = row, series = column, index-aligned cells. */
function matrixExport(rows: { label: string; cells: HazardEffectMatrix["rows"][number]["cells"] }[], columns: string[]) {
	return rows.flatMap((r) => r.cells.map((cell, i) => cellRow(r.label, cell, columns[i])));
}

export function hazardEffectExport(t: T, p: HazardEffectMatrix, meta: PanelMeta): PanelExport {
	return {
		rows: matrixExport(p.rows, p.effects.map((e) => effectLabel(t, e))),
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.effects_overlap", "Effects overlap, so the table has no row total."),
		]),
	};
}

export function hazardSectorExport(t: T, p: HazardSectorMatrix, meta: PanelMeta): PanelExport {
	return {
		rows: matrixExport(p.rows, p.sectors.map((s) => s.label)).map((r) => ({ ...r, unit: "records" })),
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.sectors_overlap", "A record can report several sectors, so columns do not add up to records."),
			tr(t, "dashboard.money_absent", "Money not shown: monetary convention pending (G-06)."),
		]),
	};
}

export function rankedDivisionsExport(t: T, p: RankedDivisions, meta: PanelMeta): PanelExport {
	const rows = p.rows.map((r) => cellRow(r.name, r.cell));
	if (p.rest) {
		rows.push(cellRow(tr(t, "dashboard.other_divisions", "{n} other divisions", { n: p.rest.divisions }), p.rest.cell));
	}
	return {
		rows,
		method: meta.method,
		notes: panelNotes(meta, [
			p.multiDivisionRecords > 0
				? tr(t, "dashboard.multi_division", "{n} records touch several divisions and count in each, so rows do not add up.", { n: p.multiDivisionRecords })
				: undefined,
		]),
	};
}

export function peopleMovedExport(t: T, p: PeopleMovedPanel, meta: PanelMeta): PanelExport {
	const names = movedNames(t);
	return {
		rows: p.rows.flatMap((r) => [
			cellRow(r.label, r.displaced, names.displaced),
			cellRow(r.label, r.evacuated, names.evacuated),
			cellRow(r.label, r.relocated, names.relocated),
		]),
		method: meta.method,
		notes: panelNotes(meta, [p.overlapNote]),
	};
}

export function housesExport(t: T, p: HousesPanel, meta: PanelMeta): PanelExport {
	const names = housesNames(t);
	return {
		rows: p.rows.flatMap((r) => [
			{ ...cellRow(r.label, r.destroyed, names.destroyed), unit: "houses" },
			{ ...cellRow(r.label, r.damaged, names.damaged), unit: "houses" },
		]),
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.houses_inputs", "Dwelling counts are inputs to Sendai B-3 and B-4 and carry no indicator code."),
		]),
	};
}

export function largestRecordsExport(t: T, p: LargestRecords, meta: PanelMeta): PanelExport {
	return {
		rows: p.rows.map((r) => ({
			...cellRow(recordLabel(t, r), r.cell),
			series: r.flags.join(" ") || undefined,
		})),
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.largest_series", "Series column: plausibility flags (C30), if any."),
		]),
	};
}

export function completenessExport(t: T, p: CompletenessMatrix, meta: PanelMeta): PanelExport {
	// No PanelCell here: the share is a reported figure, or blank with no record in scope.
	const rows: ChartExportRow[] = p.rows.map((r) => ({
		label: r.label,
		series: tr(t, "dashboard.records_with", "{n} of {total} records", { n: r.recordsWith, total: r.recordsTotal }),
		value: r.share === null ? null : Math.round(r.share * 1000) / 10,
		valueState: r.share === null ? "not_applicable" : "reported",
		unit: "%",
	}));
	const low = p.rows.filter((r) => r.share !== null && r.share < p.lowShareThreshold).map((r) => r.label);
	return {
		rows,
		method: meta.method,
		notes: panelNotes(meta, [
			low.length > 0
				? tr(t, "dashboard.low_share", "Under 25% of records report: {fields}", { fields: low.join(", ") })
				: undefined,
		]),
	};
}

export function seasonExport(t: T, p: SeasonGrid, meta: PanelMeta): PanelExport {
	return {
		rows: p.cells.map((c) => cellRow(`${c.year}-${String(c.month).padStart(2, "0")}`, c.cell)),
		method: meta.method,
		notes: panelNotes(meta, [
			p.recordsWithoutMonth > 0
				? tr(t, "dashboard.without_month", "{n} records have no month and are left out.", { n: p.recordsWithoutMonth })
				: undefined,
		]),
	};
}

export function periodLabel(p: PeriodChange["periodA"]): string {
	return `${p.from} to ${p.to} annual average (${p.years} years)`;
}

export function periodChangeExport(t: T, p: PeriodChange, meta: PanelMeta): PanelExport {
	return {
		rows: p.rows.flatMap((r) => [
			cellRow(r.name, r.averageA, periodLabel(p.periodA)),
			cellRow(r.name, r.averageB, periodLabel(p.periodB)),
		]),
		method: meta.method,
		notes: panelNotes(meta, [
			p.label,
			tr(t, "dashboard.period_reporting", "Reporting can differ between periods."),
		]),
	};
}

export function extensiveExport(t: T, p: ExtensiveIntensive, meta: PanelMeta): PanelExport {
	const names = riskNames(t, p);
	return {
		rows: [
			{ ...cellRow(names.intensive, p.intensive), series: tr(t, "dashboard.records_n", "{n} records", { n: p.intensiveRecords }) },
			{ ...cellRow(names.extensive, p.extensive), series: tr(t, "dashboard.records_n", "{n} records", { n: p.extensiveRecords }) },
		],
		method: meta.method,
		notes: panelNotes(meta, [thresholdText(t, p), p.note]),
	};
}

export function disaggregationExport(t: T, p: DisaggregationPanel, meta: PanelMeta): PanelExport {
	const notSplit = p.coverage.recordsTotal - p.coverage.recordsWithBreakdown;
	return {
		rows: [
			...p.rows.map((r) => cellRow(r.category, r.cell, dimensionName(t, r.dimension))),
			{
				label: tr(t, "dashboard.not_disaggregated", "Not disaggregated"),
				// A count of records, not people: the series says so in the table.
				series: tr(t, "dashboard.records_not_people", "Records (not people)"),
				value: notSplit,
				valueState: "reported",
				unit: "records",
			},
		],
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.disagg_coverage", "{n} of {total} records carry a breakdown; totals are not sums of the categories.", {
				n: p.coverage.recordsWithBreakdown,
				total: p.coverage.recordsTotal,
			}),
		]),
	};
}

// ---------------------------------------------------------------------------
// Words shared by exports and views.

function movedNames(t: T) {
	return {
		displaced: tr(t, "dashboard.moved_displaced", "Displaced"),
		evacuated: tr(t, "dashboard.moved_evacuated", "Evacuated"),
		relocated: tr(t, "dashboard.moved_relocated", "Relocated"),
	};
}

function housesNames(t: T) {
	return {
		destroyed: tr(t, "dashboard.houses_destroyed", "Houses destroyed"),
		damaged: tr(t, "dashboard.houses_damaged", "Houses damaged"),
	};
}

function riskNames(t: T, p: ExtensiveIntensive) {
	return {
		intensive: tr(t, "dashboard.intensive", "Intensive (records at or above the threshold)"),
		extensive: tr(t, "dashboard.extensive", "Extensive (records below the threshold)"),
		measure: p.measure === "deaths" ? effectLabel(t, "deaths") : tr(t, "dashboard.houses_destroyed", "Houses destroyed"),
	};
}

function thresholdText(t: T, p: ExtensiveIntensive): string {
	return tr(t, "dashboard.gar_threshold", "Threshold: {deaths} deaths or {houses} houses destroyed per record ({source}).", {
		deaths: p.threshold.deaths,
		houses: p.threshold.housesDestroyed,
		source: p.threshold.source,
	});
}

function dimensionName(t: T, d: DisaggregationPanel["rows"][number]["dimension"]): string {
	return d === "sex"
		? tr(t, "dashboard.dim_sex", "Sex")
		: d === "age"
			? tr(t, "dashboard.dim_age", "Age")
			: tr(t, "dashboard.dim_disability", "Disability");
}

function recordLabel(t: T, r: LargestRecords["rows"][number]): string {
	return [r.startDate ?? tr(t, "dashboard.no_date", "No date"), r.hazardLabel, r.divisionName ?? tr(t, "dashboard.no_division", "Division not recorded")].join(" · ");
}

// ---------------------------------------------------------------------------
// Views.

interface Common {
	ctx: ViewContext;
	title: string;
	source: string;
	scope: string;
	provisional: boolean;
}

function Frame({
	common,
	exp,
	pictures = true,
	children,
}: {
	common: Common;
	exp: PanelExport;
	pictures?: boolean;
	children: React.ReactNode;
}) {
	return (
		<ChartFrame
			ctx={common.ctx}
			title={common.title}
			rows={exp.rows}
			pictures={pictures}
			meta={{
				source: common.source,
				scope: common.scope,
				method: exp.method,
				basis: common.provisional ? "provisional" : "published",
				notes: exp.notes,
			}}
		>
			{children}
		</ChartFrame>
	);
}

const tableTh = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
const tableTd = "border-b border-brand-border px-2 py-1";

function SendaiView({ common, p, exp, country }: { common: Common; p: SendaiCountsPanel; exp: PanelExport; country: string }) {
	const { ctx } = common;
	const t = ctx.t;
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<p role="note" className="m-0 mb-2 border-s-4 border-brand-warning-border bg-brand-warning-background px-3 py-2 text-sm">
				{sendaiNotice(t, country)}
			</p>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{common.title}</caption>
					<thead>
						<tr>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.indicator", "Indicator")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.measure", "Measure")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{tr(t, "dashboard.count", "Count")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.records_reporting", "Records reporting")}</th>
						</tr>
					</thead>
					<tbody>
						{p.indicators.map((i) => (
							<tr key={i.code}>
								<th scope="row" className={`${tableTd} text-start font-semibold`}>{i.code}</th>
								<td className={tableTd}>{i.label}</td>
								<td className={`${tableTd} text-end tabular-nums`}>{cellText(ctx, i.cell)}</td>
								<td className={`${tableTd} text-brand-text-muted`}>{coverageText(ctx, i.cell)}</td>
							</tr>
						))}
						{p.inputs.map((i) => (
							<tr key={i.inputTo}>
								{/* An input carries no indicator code: the cell says what it feeds. */}
								<th scope="row" className={`${tableTd} text-start font-normal text-brand-text-muted`}>
									{tr(t, "dashboard.input_to", "Input to {code}", { code: i.inputTo })}
								</th>
								<td className={tableTd}>{i.label}</td>
								<td className={`${tableTd} text-end tabular-nums`}>{cellText(ctx, i.cell)}</td>
								<td className={`${tableTd} text-brand-text-muted`}>{coverageText(ctx, i.cell)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{/* Refused indicators are listed in the caption notes. */}
		</Frame>
	);
}

function SeasonView({ common, p, exp }: { common: Common; p: SeasonGrid; exp: PanelExport }) {
	const { ctx } = common;
	const years = [...new Set(p.cells.map((c) => c.year))].sort((a, b) => a - b);
	const at = (y: number, m: number) => p.cells.find((c) => c.year === y && c.month === m);
	const max = Math.max(0, ...p.cells.map((c) => (c.cell.valueState === "reported" && c.cell.value ? c.cell.value : 0)));
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<span className="text-sm text-brand-text-muted">{effectLabel(ctx.t, p.measure)}</span>
			<div className="max-w-full overflow-x-auto">
				<table className="border-collapse text-xs">
					<caption className="sr-only">{common.title}</caption>
					<thead>
						<tr>
							<th scope="col" className="px-1 py-1 text-start">{tr(ctx.t, "dashboard.year", "Year")}</th>
							{MONTHS.map((m) => (
								<th key={m} scope="col" className="px-1 py-1 text-center font-semibold">{m}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{years.map((y) => (
							<tr key={y}>
								<th scope="row" className="px-1 py-1 text-start font-semibold">{y}</th>
								{MONTHS.map((_, i) => {
									const c = at(y, i + 1);
									const v = c && c.cell.valueState === "reported" ? c.cell.value : null;
									return (
										<td
											key={i}
											className="h-7 min-w-7 border border-brand-border px-0.5 text-center tabular-nums"
											style={{ background: shadeFor(v && v > 0 ? v : null, max) }}
											title={c ? `${MONTHS[i]} ${y}: ${cellText(ctx, c.cell)}` : undefined}
										>
											{/* An empty cell had no record that month; a state word is a record that did not report. */}
											{c ? (c.cell.valueState === "reported" ? cellText(ctx, c.cell) : c.cell.valueState === "zero_confirmed" ? "0" : "–") : ""}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="m-0 text-xs text-brand-text-muted">
				{tr(ctx.t, "dashboard.season_key", "Blank: no record that month. –: records that did not report this measure. 0: confirmed zero.")}
			</p>
		</Frame>
	);
}

function LargestView({ common, p, exp }: { common: Common; p: LargestRecords; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{common.title}</caption>
					<thead>
						<tr>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.date", "Date")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.hazard", "Hazard")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.division", "Division")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{effectLabel(t, p.measure)}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.flags", "Flags")}</th>
						</tr>
					</thead>
					<tbody>
						{p.rows.map((r) => (
							<tr key={r.recordId}>
								<td className={tableTd}>{r.startDate ?? tr(t, "dashboard.no_date", "No date")}</td>
								<th scope="row" className={`${tableTd} text-start font-normal`}>{r.hazardLabel}</th>
								<td className={tableTd}>{r.divisionName ?? <span className="text-brand-text-muted">{tr(t, "dashboard.no_division", "Division not recorded")}</span>}</td>
								<td className={`${tableTd} text-end tabular-nums`}>{cellText(ctx, r.cell)}</td>
								<td className={tableTd}>
									{r.flags.length === 0 ? (
										<span className="text-brand-text-muted">{tr(t, "dashboard.no_flags", "None")}</span>
									) : (
										r.flags.map((f) => (
											<span key={f} className="me-1 inline-block rounded bg-data-flag-review-chip-background px-1 text-xs text-data-flag-review-chip-text">
												{f}
											</span>
										))
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Frame>
	);
}

function CompletenessView({ common, p, exp }: { common: Common; p: CompletenessMatrix; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{common.title}</caption>
					<thead>
						<tr>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.field", "Field")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{tr(t, "dashboard.share", "Share of records")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.records", "Records")}</th>
						</tr>
					</thead>
					<tbody>
						{p.rows.map((r) => {
							const low = r.share !== null && r.share < p.lowShareThreshold;
							return (
								<tr key={r.key}>
									<th scope="row" className={`${tableTd} text-start font-normal`}>{r.label}</th>
									<td className={`${tableTd} text-end tabular-nums`} style={{ background: shadeFor(r.share, 1) }}>
										{r.share === null
											? tr(t, "dashboard.no_records_scope", "No records in scope")
											: `${(Math.round(r.share * 1000) / 10).toLocaleString(ctx.lang)}%`}
									</td>
									<td className={`${tableTd} text-brand-text-muted`}>
										{tr(t, "dashboard.records_with", "{n} of {total} records", { n: r.recordsWith.toLocaleString(ctx.lang), total: r.recordsTotal.toLocaleString(ctx.lang) })}
										{low && (
											<span className="block font-semibold text-brand-text">
												{tr(t, "dashboard.under_25", "Under 25% of records report this")}
											</span>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</Frame>
	);
}

/** Dumbbell: hollow dot for the first period, filled for the second; a missing side is listed, not drawn. */
function PeriodView({ common, p, exp }: { common: Common; p: PeriodChange; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	const val = (c: PeriodChange["rows"][number]["averageA"]) =>
		c.valueState === "reported" || c.valueState === "zero_confirmed" ? c.value : null;
	const drawn = p.rows.filter((r) => val(r.averageA) !== null && val(r.averageB) !== null);
	const listed = p.rows.filter((r) => !drawn.includes(r));
	const max = Math.max(1, ...drawn.flatMap((r) => [val(r.averageA)!, val(r.averageB)!]));
	const W = 380;
	const L = 130;
	const x = (v: number) => L + (v / max) * (W - L - 50);
	const ink = dataTokens.chart.axis;
	return (
		<Frame common={common} exp={exp}>
			<div className="flex flex-col gap-2 text-sm">
				<ul className="m-0 flex list-none flex-wrap gap-3 p-0">
					<li className="flex items-center gap-1">
						<svg width={12} height={12} aria-hidden="true"><circle cx={6} cy={6} r={4.5} fill="#fff" stroke={ink} strokeWidth={2} /></svg>
						{periodLabel(p.periodA)}
					</li>
					<li className="flex items-center gap-1">
						<svg width={12} height={12} aria-hidden="true"><circle cx={6} cy={6} r={5} fill={ink} /></svg>
						{periodLabel(p.periodB)}
					</li>
				</ul>
				{drawn.length > 0 && (
					<svg
						viewBox={`0 0 ${W} ${drawn.length * 26 + 4}`}
						width="100%"
						height={drawn.length * 26 + 4}
						preserveAspectRatio="xMinYMin meet"
						role="img"
						aria-label={drawn.map((r) => `${r.name}: ${cellText(ctx, r.averageA)} then ${cellText(ctx, r.averageB)}`).join("; ")}
						fontSize={11}
						className="block max-w-full"
					>
						{drawn.map((r, i) => {
							const y = i * 26 + 14;
							const a = x(val(r.averageA)!);
							const b = x(val(r.averageB)!);
							return (
								<g key={r.divisionId}>
									<text x={0} y={y + 4} fill="currentColor">{r.name}</text>
									<line x1={a} x2={b} y1={y} y2={y} stroke={ink} strokeWidth={2} />
									<circle cx={a} cy={y} r={5} fill="#fff" stroke={ink} strokeWidth={2} />
									<circle cx={b} cy={y} r={5} fill={ink} />
									<text x={Math.max(a, b) + 9} y={y + 4} fill="currentColor" fontSize={10}>
										{cellText(ctx, r.averageA)} → {cellText(ctx, r.averageB)}
									</text>
								</g>
							);
						})}
					</svg>
				)}
				{listed.length > 0 && (
					<p className="m-0 text-brand-text-muted">
						{tr(t, "dashboard.period_one_side", "Not drawn, one period not reported:")}{" "}
						{listed.map((r) => `${r.name} (${cellText(ctx, r.averageA)}; ${cellText(ctx, r.averageB)})`).join(", ")}
					</p>
				)}
			</div>
		</Frame>
	);
}

/** One 100% bar split at the GAR threshold, both parts named and numbered. */
function ExtensiveView({ common, p, exp }: { common: Common; p: ExtensiveIntensive; exp: PanelExport }) {
	const { ctx } = common;
	const names = riskNames(ctx.t, p);
	const v = (c: ExtensiveIntensive["intensive"]) => (c.valueState === "reported" && c.value ? c.value : 0);
	// Both sides must be known; a confirmed zero on one side is still a split.
	const known = (c: ExtensiveIntensive["intensive"]) =>
		c.valueState === "reported" || c.valueState === "zero_confirmed";
	const both = known(p.intensive) && known(p.extensive);
	const total = v(p.intensive) + v(p.extensive);
	const share = total > 0 ? v(p.intensive) / total : 0;
	const W = 380;
	const pct = (x: number) => `${Math.round(x * 100)}%`;
	return (
		<Frame common={common} exp={exp}>
			<div className="flex flex-col gap-2 text-sm">
				<span className="text-brand-text-muted">{names.measure}</span>
				{both && total > 0 ? (
					<svg viewBox={`0 0 ${W} 28`} width="100%" height={28} preserveAspectRatio="none" role="img" className="block max-w-full"
						aria-label={`${names.intensive}: ${pct(share)}; ${names.extensive}: ${pct(1 - share)}`}>
						<rect x={0} y={0} width={W * share} height={28} fill={RAMP[4]} />
						<rect x={W * share} y={0} width={W * (1 - share)} height={28} fill={RAMP[1]} />
					</svg>
				) : (
					<p className="m-0 italic text-brand-text-muted">
						{STATE_ENCODING.not_reported.label}
					</p>
				)}
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{([
						[names.intensive, p.intensive, p.intensiveRecords, RAMP[4]],
						[names.extensive, p.extensive, p.extensiveRecords, RAMP[1]],
					] as const).map(([name, cell, n, fill]) => (
						<li key={name} className="flex items-center gap-2">
							<span aria-hidden="true" className="inline-block h-3 w-3 shrink-0" style={{ background: fill }} />
							<span>
								{name}: <span className="font-semibold tabular-nums">{cellText(ctx, cell)}</span>{" "}
								<span className="text-brand-text-muted">
									({tr(ctx.t, "dashboard.records_n", "{n} records", { n: n.toLocaleString(ctx.lang) })}
									{both && total > 0 ? `, ${pct(cell === p.intensive ? share : 1 - share)}` : ""})
								</span>
							</span>
						</li>
					))}
				</ul>
			</div>
		</Frame>
	);
}

// ---------------------------------------------------------------------------
// The panel set.

export function impactPanels5to16(
	ctx: ViewContext,
	data: ImpactPanels5to16,
	opts: { source: string; scope: string; provisional: boolean; country: string },
): DashboardPanel[] {
	const t = ctx.t;
	const m = data.meta;
	const common = (title: string): Common => ({ ctx, title, source: opts.source, scope: opts.scope, provisional: opts.provisional });
	const moved = movedNames(t);
	const houses = housesNames(t);
	const movedSeries: BarSeries[] = [
		{ name: moved.displaced, fill: RAMP[4] },
		{ name: moved.evacuated, fill: RAMP[2] },
		{ name: moved.relocated, fill: RAMP[1] },
	];
	const houseSeries: BarSeries[] = [
		{ name: houses.destroyed, fill: RAMP[4] },
		{ name: houses.damaged, fill: RAMP[2] },
	];
	// "Not disaggregated" counts records, not people: it is a line of text,
	// never a bar on the people axis.
	const disaggSeries = data.disaggregation;

	const spec: [number, string, PanelExport, (c: Common, e: PanelExport) => React.ReactNode][] = [
		[5, tr(t, "dashboard.impact_5", "Sendai Targets A and B counts"), sendaiExport(t, data.sendai, m.sendai, opts.country),
			(c, e) => <SendaiView common={c} p={data.sendai} exp={e} country={opts.country} />],
		[6, tr(t, "dashboard.impact_6", "Hazard by human effect"), hazardEffectExport(t, data.hazardEffect, m.hazardEffect),
			(c, e) => (
				<Frame common={c} exp={e} pictures={false}>
					<ShadedTable ctx={ctx} caption={c.title} rowHeader={tr(t, "dashboard.hazard_type", "Hazard type")}
						columns={data.hazardEffect.effects.map((x) => effectLabel(t, x))}
						rows={data.hazardEffect.rows.map((r) => ({ key: r.hipTypeId, label: r.label, cells: r.cells }))}
						normalise="column" />
				</Frame>
			)],
		[7, tr(t, "dashboard.impact_7", "Ranked divisions"), rankedDivisionsExport(t, data.rankedDivisions, m.rankedDivisions),
			(c, e) => (
				<Frame common={c} exp={e}>
					<RowBars ctx={ctx} label={c.title}
						rows={[
							...data.rankedDivisions.rows.map((r) => ({ key: r.divisionId, label: r.name, bars: [{ cell: r.cell }] })),
							...(data.rankedDivisions.rest
								? [{ key: "rest", label: tr(t, "dashboard.other_divisions", "{n} other divisions", { n: data.rankedDivisions.rest.divisions }), bars: [{ cell: data.rankedDivisions.rest.cell }] }]
								: []),
						]} />
				</Frame>
			)],
		[8, tr(t, "dashboard.impact_8", "Hazard by sector"), hazardSectorExport(t, data.hazardSector, m.hazardSector),
			(c, e) => (
				<Frame common={c} exp={e} pictures={false}>
					<ShadedTable ctx={ctx} caption={c.title} rowHeader={tr(t, "dashboard.hazard_type", "Hazard type")}
						columns={data.hazardSector.sectors.map((s) => s.label)}
						rows={data.hazardSector.rows.map((r) => ({ key: r.hipTypeId, label: r.label, cells: r.cells }))}
						normalise="table" />
				</Frame>
			)],
		[9, tr(t, "dashboard.impact_9", "People moved"), peopleMovedExport(t, data.peopleMoved, m.peopleMoved),
			(c, e) => (
				<Frame common={c} exp={e}>
					<RowBars ctx={ctx} label={c.title} series={movedSeries}
						rows={data.peopleMoved.rows.map((r) => ({
							key: r.hipTypeId,
							label: r.label,
							bars: [
								{ series: movedSeries[0], cell: r.displaced },
								{ series: movedSeries[1], cell: r.evacuated },
								{ series: movedSeries[2], cell: r.relocated },
							],
						}))} />
				</Frame>
			)],
		[10, tr(t, "dashboard.impact_10", "Houses destroyed and damaged"), housesExport(t, data.houses, m.houses),
			(c, e) => (
				<Frame common={c} exp={e}>
					<RowBars ctx={ctx} label={c.title} series={houseSeries}
						rows={data.houses.rows.map((r) => ({
							key: r.key,
							label: r.label,
							bars: [
								{ series: houseSeries[0], cell: r.destroyed },
								{ series: houseSeries[1], cell: r.damaged },
							],
						}))} />
				</Frame>
			)],
		[11, tr(t, "dashboard.impact_11", "Largest records"), largestRecordsExport(t, data.largestRecords, m.largestRecords),
			(c, e) => <LargestView common={c} p={data.largestRecords} exp={e} />],
		[12, tr(t, "dashboard.impact_12", "Reporting completeness and precision"), completenessExport(t, data.completeness, m.completeness),
			(c, e) => <CompletenessView common={c} p={data.completeness} exp={e} />],
		[13, tr(t, "dashboard.impact_13", "Season of impact"), seasonExport(t, data.season, m.season),
			(c, e) => <SeasonView common={c} p={data.season} exp={e} />],
		[14, tr(t, "dashboard.impact_14", "Period change by division"), periodChangeExport(t, data.periodChange, m.periodChange),
			(c, e) => <PeriodView common={c} p={data.periodChange} exp={e} />],
		[15, tr(t, "dashboard.impact_15", "Extensive and intensive risk"), extensiveExport(t, data.extensiveIntensive, m.extensiveIntensive),
			(c, e) => <ExtensiveView common={c} p={data.extensiveIntensive} exp={e} />],
		[16, tr(t, "dashboard.impact_16", "Disaggregation"), disaggregationExport(t, disaggSeries, m.disaggregation),
			(c, e) => (
				<Frame common={c} exp={e}>
					<span className="text-sm text-brand-text-muted">{effectLabel(t, disaggSeries.effect)}</span>
					<RowBars ctx={ctx} label={c.title}
						rows={disaggSeries.rows.map((r, i) => ({ key: `${r.dimension}-${i}`, label: r.category, note: dimensionName(t, r.dimension), bars: [{ cell: r.cell }] }))} />
					<p className="m-0 text-sm">
						{tr(t, "dashboard.not_disaggregated_count", "Not disaggregated: {n} of {total} records", {
							n: (disaggSeries.coverage.recordsTotal - disaggSeries.coverage.recordsWithBreakdown).toLocaleString(ctx.lang),
							total: disaggSeries.coverage.recordsTotal.toLocaleString(ctx.lang),
						})}
					</p>
				</Frame>
			)],
	];

	return spec.map(([n, title, exp, view]) => ({
		id: `impact-${n}`,
		n,
		title,
		exportData: exp,
		render: () => view(common(title), exp),
	}));
}
