// Disaster events panels 1 to 7 (panels paper v0.3, section 4.2). Event
// counts are plain counts of recorded events: a count is never "not
// reported". Human effects over linked records keep their value state
// (TR-076). Every panel prints the grouping rule of the events and the
// share of records not grouped into any event (ruling RV-1), because an
// event count means little without them. Events are never records (SFM).
import type React from "react";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import {
	EVENT_GROUPING_RULES,
	type EventGroupingRule,
	type EventPanels1to7,
} from "~/utils/dashboard/eventPanels";
import { dataTokens } from "~/utils/designTokens.generated";
import { cellRow, cellText, coverageText, emptyViewPanel, panelNotes, type PanelExport } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { RowBars } from "../blocks";
import { waffleShares } from "../impact/CoverageWaffle";
import { YearColumns } from "../impact/ImpactTimeline";
import { effectLabel } from "../impact/panels5to16";

type T = ViewContext["t"];
const tr = (t: T, code: string, msg: string, r?: Record<string, unknown>) => t({ code, msg }, r);

/** A plain count as a cell, so shared bars and tables can draw it. */
export function countCell(n: number): PanelCell {
	return {
		value: n,
		valueState: "reported",
		recordsReported: 0,
		recordsZeroConfirmed: 0,
		recordsNotReported: 0,
		recordsTotal: 0,
		recordsFlagged: 0,
	};
}

const countRow = (label: string, n: number, unit: string, series?: string): ChartExportRow => ({
	label,
	series,
	value: n,
	valueState: "reported",
	unit,
});

export function ruleLabel(t: T, rule: EventGroupingRule): string {
	return rule === "glide"
		? tr(t, "dashboard.rule_glide", "GLIDE")
		: rule === "serial"
			? tr(t, "dashboard.rule_serial", "Guarded country serial")
			: tr(t, "dashboard.rule_entered", "Entered as an event");
}

// Grouping rules in distinct steps of the events ramp, always named.
const RULE_FILL: Record<EventGroupingRule, string> = {
	glide: dataTokens.ramp.events[4],
	serial: dataTokens.ramp.events[3],
	entered: dataTokens.ramp.events[1],
};

/** The lines every Disaster events panel carries (RV-1). */
export function eventContextNotes(t: T, d: EventPanels1to7): string[] {
	const h = d.headline;
	const rules = EVENT_GROUPING_RULES.map((r) =>
		tr(t, "dashboard.rule_count", "{rule} ({n} events)", { rule: ruleLabel(t, r), n: h.byRule[r] }),
	).join("; ");
	const notGrouped = d.linkage.notLinked;
	const total = d.linkage.recordsInScope;
	return [
		tr(t, "dashboard.grouping_rule", "Grouping rule: {rules}.", { rules }),
		// With no record in scope there is no share to state, never "0 of 0".
		total > 0
			? tr(t, "dashboard.not_grouped", "{n} of {total} records ({pct}%) are not grouped into an event.", {
					n: notGrouped,
					total,
					pct: Math.round((notGrouped / total) * 1000) / 10,
				})
			: tr(t, "dashboard.no_records_in_scope", "No records in scope"),
	];
}

// ---------------------------------------------------------------------------
// Export functions.

export function headlineExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	const h = d.headline;
	return {
		rows: [
			countRow(tr(t, "dashboard.events", "Disaster events"), h.events, "events"),
			...EVENT_GROUPING_RULES.map((r) => countRow(tr(t, "dashboard.events", "Disaster events"), h.byRule[r], "events", ruleLabel(t, r))),
			countRow(tr(t, "dashboard.events_with_glide", "Events with a GLIDE number"), h.eventsWithGlide, "events"),
			countRow(tr(t, "dashboard.records_linked", "Records linked to an event"), h.recordsLinked, "records"),
			countRow(tr(t, "dashboard.records_in_scope", "Records in scope"), h.recordsInScope, "records"),
			cellRow(tr(t, "dashboard.deaths_linked", "Deaths over linked records"), h.deaths),
		],
		method: meta.method,
		notes: panelNotes(meta, eventContextNotes(t, d)),
	};
}

export function linkageExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	return {
		rows: [
			...EVENT_GROUPING_RULES.map((r) =>
				countRow(tr(t, "dashboard.linked_by", "Linked to an event by {rule}", { rule: ruleLabel(t, r) }), d.linkage.linked[r], "records"),
			),
			countRow(tr(t, "dashboard.not_linked", "Not grouped"), d.linkage.notLinked, "records"),
		],
		method: meta.method,
		notes: panelNotes(meta, eventContextNotes(t, d)),
	};
}

export function largestEventsExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	return {
		rows: d.largest.rows.map((r) => ({ ...cellRow(r.name, r.cell), series: [r.glide, r.startDate, r.hazardLabel].filter(Boolean).join(" · ") })),
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.largest_events_rank", "Ranked only on reported and confirmed figures; others follow."),
			...eventContextNotes(t, d),
		]),
	};
}

export function byYearExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	return {
		rows: d.byYear.years.flatMap((y) => [
			countRow(String(y.year), y.events, "events"),
			...EVENT_GROUPING_RULES.filter((r) => y.byRule[r] > 0).map((r) => countRow(String(y.year), y.byRule[r], "events", ruleLabel(t, r))),
		]),
		method: meta.method,
		notes: panelNotes(meta, [
			d.byYear.eventsWithoutYear > 0
				? tr(t, "dashboard.events_without_year", "{n} events have no start year and are left out.", { n: d.byYear.eventsWithoutYear })
				: undefined,
			tr(t, "dashboard.ungrouped_not_events", "Records not grouped into an event are not counted as events."),
			...eventContextNotes(t, d),
		]),
	};
}

export function byHazardExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	return {
		rows: d.byHazard.rows.map((r) => countRow(r.label, r.events, "events")),
		method: meta.method,
		notes: panelNotes(meta, eventContextNotes(t, d)),
	};
}

export function recordsPerEventExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	const p = d.recordsPerEvent;
	return {
		rows: [
			...p.bins.map((b) => countRow(b.label, b.events, "events", tr(t, "dashboard.linked_records", "Linked records"))),
			countRow(tr(t, "dashboard.not_linked", "Not grouped"), p.recordsNotGrouped, "records"),
		],
		method: meta.method,
		notes: panelNotes(meta, [
			p.eventsWithoutRecords > 0
				? tr(t, "dashboard.events_without_records", "{n} events have no linked record on this basis.", { n: p.eventsWithoutRecords })
				: undefined,
			...eventContextNotes(t, d),
		]),
	};
}

export function eventSizeExport(t: T, d: EventPanels1to7, meta: PanelMeta): PanelExport {
	const s = d.eventSize;
	const names = sizeNames(t);
	return {
		rows: [
			countRow(names.intensive, s.intensive, "events"),
			countRow(names.extensive, s.extensive, "events"),
			countRow(names.zero, s.zeroConfirmed, "events"),
			countRow(names.notReported, s.notReported, "events"),
		],
		method: meta.method,
		notes: panelNotes(meta, [
			tr(t, "dashboard.gar_threshold", "Threshold: {deaths} deaths or {houses} houses destroyed per record ({source}).", {
				deaths: s.threshold.deaths,
				houses: s.threshold.housesDestroyed,
				source: s.threshold.source,
			}),
			s.note,
			...eventContextNotes(t, d),
		]),
	};
}

function sizeNames(t: T) {
	return {
		intensive: tr(t, "dashboard.events_intensive", "Intensive events (at or above the threshold)"),
		extensive: tr(t, "dashboard.events_extensive", "Extensive events (below the threshold)"),
		zero: tr(t, "dashboard.events_zero", "Events with zero deaths and no houses destroyed, confirmed"),
		notReported: tr(t, "dashboard.events_not_reported", "Events whose records report neither"),
	};
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

function Frame({ common, exp, pictures = true, children }: { common: Common; exp: PanelExport; pictures?: boolean; children: React.ReactNode }) {
	return (
		<ChartFrame
			ctx={common.ctx}
			title={common.title}
			rows={exp.rows}
			pictures={pictures}
			meta={{ source: common.source, scope: common.scope, method: exp.method, basis: common.provisional ? "provisional" : "published", notes: exp.notes }}
		>
			{children}
		</ChartFrame>
	);
}

function HeadlineView({ common, d, exp }: { common: Common; d: EventPanels1to7; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	const h = d.headline;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const pct = h.recordsInScope > 0 ? `${Math.round((h.recordsLinked / h.recordsInScope) * 1000) / 10}%` : "";
	const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
		<li className="flex min-w-0 flex-col gap-1 rounded border border-brand-border bg-brand-surface-card p-3">
			<span className="text-sm text-brand-text-muted">{label}</span>
			<span className="text-2xl font-semibold tabular-nums">{value}</span>
			{sub && <span className="text-xs text-brand-text-muted">{sub}</span>}
		</li>
	);
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
				{tile(
					tr(t, "dashboard.events", "Disaster events"),
					n(h.events),
					EVENT_GROUPING_RULES.map((r) => `${ruleLabel(t, r)} ${n(h.byRule[r])}`).join(" · "),
				)}
				{tile(tr(t, "dashboard.events_with_glide", "Events with a GLIDE number"), n(h.eventsWithGlide))}
				{tile(
					tr(t, "dashboard.records_linked", "Records linked to an event"),
					n(h.recordsLinked),
					tr(t, "dashboard.of_records", "of {total} records in scope ({pct})", { total: n(h.recordsInScope), pct }),
				)}
				<li className="flex min-w-0 flex-col gap-1 rounded border border-brand-border bg-brand-surface-card p-3">
					<span className="text-sm text-brand-text-muted">{tr(t, "dashboard.deaths_linked", "Deaths over linked records")}</span>
					<span className={h.deaths.valueState === "reported" ? "text-2xl font-semibold tabular-nums" : "text-base font-semibold"}>
						{cellText(ctx, h.deaths)}
					</span>
					<span className="text-xs text-brand-text-muted">{coverageText(ctx, h.deaths)}</span>
				</li>
			</ul>
		</Frame>
	);
}

const SQ = 14;
const GAP = 2;

function LinkageView({ common, d, exp }: { common: Common; d: EventPanels1to7; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	const l = d.linkage;
	const parts = [
		...EVENT_GROUPING_RULES.map((r) => ({ key: r, label: ruleLabel(t, r), count: l.linked[r], fill: RULE_FILL[r], dash: undefined as string | undefined })),
		{ key: "not", label: tr(t, "dashboard.not_linked", "Not grouped"), count: l.notLinked, fill: "#ffffff", dash: "3 2" },
	];
	const shares = waffleShares(parts.map((p) => p.count));
	const squares = shares.flatMap((s, i) => Array.from({ length: s }, () => i));
	const side = 10 * SQ + 9 * GAP;
	const pct = (x: number) => (l.recordsInScope > 0 ? `${Math.round((x / l.recordsInScope) * 100)}%` : "");
	const notPct = pct(l.notLinked);
	return (
		<Frame common={common} exp={exp}>
			<p className="m-0 mb-2 text-sm font-semibold">
				{tr(t, "dashboard.not_grouped_headline", "{pct} of records in scope are not grouped into an event.", { pct: notPct })}
			</p>
			<div className="flex flex-wrap items-start gap-4">
				<svg width={side} height={side} viewBox={`0 0 ${side} ${side}`} role="img" className="shrink-0"
					aria-label={parts.map((p) => `${p.label}: ${p.count} (${pct(p.count)})`).join("; ")}>
					{squares.map((part, i) => (
						<rect key={i} x={(i % 10) * (SQ + GAP) + 0.5} y={Math.floor(i / 10) * (SQ + GAP) + 0.5} width={SQ - 1} height={SQ - 1}
							fill={parts[part].fill} stroke={dataTokens.chart.axis} strokeWidth={parts[part].dash ? 1 : 0} strokeDasharray={parts[part].dash} />
					))}
				</svg>
				<ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
					{parts.map((p) => (
						<li key={p.key} className="flex items-center gap-2">
							<svg width={14} height={14} aria-hidden="true" focusable="false">
								<rect x={0.5} y={0.5} width={13} height={13} fill={p.fill} stroke={dataTokens.chart.axis} strokeWidth={p.dash ? 1 : 0} strokeDasharray={p.dash} />
							</svg>
							<span>
								{p.label}: <span className="font-semibold tabular-nums">{p.count.toLocaleString(ctx.lang)}</span>{" "}
								<span className="text-brand-text-muted">({pct(p.count)})</span>
							</span>
						</li>
					))}
				</ul>
			</div>
		</Frame>
	);
}

const tableTh = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
const tableTd = "border-b border-brand-border px-2 py-1";

function LargestView({ common, d, exp }: { common: Common; d: EventPanels1to7; exp: PanelExport }) {
	const { ctx } = common;
	const t = ctx.t;
	return (
		<Frame common={common} exp={exp} pictures={false}>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{common.title}</caption>
					<thead>
						<tr>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.event", "Event")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.date", "Date")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.hazard", "Hazard")}</th>
							<th scope="col" className={`${tableTh} text-start`}>{tr(t, "dashboard.rule", "Grouping rule")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{tr(t, "dashboard.records", "Records")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{tr(t, "dashboard.divisions", "Divisions")}</th>
							<th scope="col" className={`${tableTh} text-end`}>{effectLabel(t, d.largest.measure)}</th>
						</tr>
					</thead>
					<tbody>
						{d.largest.rows.map((r) => (
							<tr key={r.eventId}>
								<th scope="row" className={`${tableTd} text-start font-normal`}>
									{r.name}
									{r.glide && <span className="block text-xs text-brand-text-muted">{r.glide}</span>}
								</th>
								<td className={tableTd}>{r.startDate ?? tr(t, "dashboard.no_date", "No date")}</td>
								<td className={tableTd}>{r.hazardLabel}</td>
								<td className={tableTd}>{ruleLabel(t, r.rule)}</td>
								<td className={`${tableTd} text-end tabular-nums`}>{r.records.toLocaleString(ctx.lang)}</td>
								<td className={`${tableTd} text-end tabular-nums`}>{r.divisions.toLocaleString(ctx.lang)}</td>
								<td className={`${tableTd} text-end tabular-nums`}>
									{cellText(ctx, r.cell)}
									<span className="block text-xs text-brand-text-muted">{coverageText(ctx, r.cell)}</span>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Frame>
	);
}

/** Every year from the first to the last; a year with no event is an outlined gap. */
export function continuousYears(years: EventPanels1to7["byYear"]["years"]): { year: number; cell: PanelCell }[] {
	if (years.length === 0) return [];
	const byYear = new Map(years.map((y) => [y.year, y.events]));
	const first = Math.min(...years.map((y) => y.year));
	const last = Math.max(...years.map((y) => y.year));
	return Array.from({ length: last - first + 1 }, (_, i) => {
		const year = first + i;
		const n = byYear.get(year);
		return { year, cell: n ? countCell(n) : { ...countCell(0), value: null, valueState: "not_reported" as const } };
	});
}

function EventSizeView({ common, d, exp }: { common: Common; d: EventPanels1to7; exp: PanelExport }) {
	const { ctx } = common;
	const s = d.eventSize;
	const names = sizeNames(ctx.t);
	const total = s.intensive + s.extensive;
	const share = total > 0 ? s.intensive / total : 0;
	const W = 380;
	const R = dataTokens.ramp.people;
	return (
		<Frame common={common} exp={exp}>
			<div className="flex flex-col gap-2 text-sm">
				{total > 0 && (
					<svg viewBox={`0 0 ${W} 28`} width="100%" height={28} preserveAspectRatio="none" role="img" className="block max-w-full"
						aria-label={`${names.intensive}: ${s.intensive}; ${names.extensive}: ${s.extensive}`}>
						<rect x={0} y={0} width={W * share} height={28} fill={R[4]} />
						<path d={roundedBarPath(W * share, 0, W * (1 - share), 28, "right")} fill={R[1]} />
					</svg>
				)}
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{([
						[names.intensive, s.intensive, R[4]],
						[names.extensive, s.extensive, R[1]],
						[names.zero, s.zeroConfirmed, null],
						[names.notReported, s.notReported, null],
					] as const).map(([label, n, fill]) => (
						<li key={label} className="flex items-center gap-2">
							<span aria-hidden="true" className="inline-block h-3 w-3 shrink-0" style={{ background: fill ?? "transparent" }} />
							<span>
								{label}: <span className="font-semibold tabular-nums">{n.toLocaleString(ctx.lang)}</span>
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

export function eventDashboardPanels(
	ctx: ViewContext,
	d: EventPanels1to7,
	opts: { source: string; scope: string; provisional: boolean },
): DashboardPanel[] {
	const t = ctx.t;
	if (d.empty) {
		return [emptyViewPanel("events", tr(t, "dashboard.dim_disaster_events", "Disaster events"), tr(t, "dashboard.events_empty", d.empty.reason))];
	}
	const m = d.meta;
	const common = (title: string): Common => ({ ctx, title, ...opts });
	const noEvents = tr(t, "dashboard.no_events_year", "No events recorded");
	const spec: [number, string, PanelExport, (c: Common, e: PanelExport) => React.ReactNode][] = [
		[1, tr(t, "dashboard.events_1", "Disaster events at a glance"), headlineExport(t, d, m.headline), (c, e) => <HeadlineView common={c} d={d} exp={e} />],
		[2, tr(t, "dashboard.events_2", "Records grouped into events"), linkageExport(t, d, m.linkage), (c, e) => <LinkageView common={c} d={d} exp={e} />],
		[3, tr(t, "dashboard.events_3", "Largest events"), largestEventsExport(t, d, m.largest), (c, e) => <LargestView common={c} d={d} exp={e} />],
		[4, tr(t, "dashboard.events_4", "Events by year"), byYearExport(t, d, m.byYear),
			(c, e) => (
				<Frame common={c} exp={e}>
					<YearColumns years={continuousYears(d.byYear.years)} height={180} width={480} label={c.title} noDataText={noEvents} />
				</Frame>
			)],
		[5, tr(t, "dashboard.events_5", "Events by hazard"), byHazardExport(t, d, m.byHazard),
			(c, e) => (
				<Frame common={c} exp={e}>
					<RowBars ctx={ctx} label={c.title} rows={d.byHazard.rows.map((r) => ({ key: r.hipTypeId, label: r.label, bars: [{ cell: countCell(r.events) }] }))} />
				</Frame>
			)],
		[6, tr(t, "dashboard.events_6", "Records per event"), recordsPerEventExport(t, d, m.recordsPerEvent),
			(c, e) => (
				<Frame common={c} exp={e}>
					<span className="text-sm text-brand-text-muted">{tr(t, "dashboard.events_by_records", "Events by number of linked records")}</span>
					<RowBars ctx={ctx} label={c.title} rows={d.recordsPerEvent.bins.map((b) => ({ key: b.label, label: b.label, bars: [{ cell: countCell(b.events) }] }))} />
					{/* Records, not events: a separate line, never a bar on the events scale. */}
					<p className="m-0 text-sm">
						{tr(t, "dashboard.not_grouped_records", "Not grouped: {n} records belong to no event.", { n: d.recordsPerEvent.recordsNotGrouped.toLocaleString(ctx.lang) })}
					</p>
				</Frame>
			)],
		[7, tr(t, "dashboard.events_7", "Event size and extensive risk"), eventSizeExport(t, d, m.eventSize), (c, e) => <EventSizeView common={c} d={d} exp={e} />],
	];
	const drawn = spec.map(([n, title, exp, view]): DashboardPanel => ({ id: `events-${n}`, n, title, exportData: exp, render: () => view(common(title), exp) }));
	// Panels 8 to 16 follow; on this view they fold into the strip (decision 1).
	const later: [number, string][] = [
		[8, tr(t, "dashboard.events_8", "Declaration, warning and response timeline")],
		[9, tr(t, "dashboard.events_9", "Event chain")],
		[10, tr(t, "dashboard.events_10", "Approval and assessment status")],
		[11, tr(t, "dashboard.events_11", "Event register")],
		[12, tr(t, "dashboard.events_12", "Event field completeness")],
		[13, tr(t, "dashboard.events_13", "Divisions per event")],
		[14, tr(t, "dashboard.events_14", "Official warning by hazard")],
		[15, tr(t, "dashboard.events_15", "Compare events")],
		[16, tr(t, "dashboard.events_16", "Event by sector")],
	];
	return [
		...drawn,
		...later.map(([n, title]): DashboardPanel => ({
			id: `events-${n}`,
			n,
			title,
			gap: { code: "D1 events", text: tr(t, "dashboard.panel_in_build", "This panel is being built.") },
		})),
	];
}
