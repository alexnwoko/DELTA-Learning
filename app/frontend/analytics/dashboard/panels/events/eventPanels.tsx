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
import { RowBars, rowFilter } from "../blocks";
import { waffleShares } from "../impact/CoverageWaffle";
import { YearColumns } from "../impact/ImpactTimeline";
import { effectLabel } from "../impact/panels5to16";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import type { EventMapPayload } from "~/utils/dashboard/eventMap";
import type { EventPanels8to16 } from "~/utils/dashboard/eventPanels8to16";
import type { HazardMonth } from "~/utils/dashboard/hazardMonth";
import { hazardMonthPanel } from "../hazardMonth";
import { comingSoonPanels } from "../../comingSoon";
import { arrangeByLayout, EVENTS_LAYOUT } from "../../layout";

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
	glide: DASHBOARD_RAMP[4],
	serial: DASHBOARD_RAMP[3],
	entered: DASHBOARD_RAMP[2],
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
	const R = DASHBOARD_RAMP;
	return (
		<Frame common={common} exp={exp}>
			<div className="flex flex-col gap-2 text-sm">
				{total > 0 && (
					<svg viewBox={`0 0 ${W} 28`} width="100%" height={28} preserveAspectRatio="none" role="img" className="block max-w-full"
						aria-label={`${names.intensive}: ${s.intensive}; ${names.extensive}: ${s.extensive}`}>
						<rect x={0} y={0} width={W * share} height={28} fill={R[4]} />
						<path d={roundedBarPath(W * share, 0, W * (1 - share), 28, "right")} fill={R[2]} />
					</svg>
				)}
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{([
						[names.intensive, s.intensive, R[4]],
						[names.extensive, s.extensive, R[2]],
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
	opts: { source: string; scope: string; provisional: boolean; map?: EventMapPayload | null; more?: EventPanels8to16 | null; hazardMonth?: HazardMonth | null },
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
		[2, tr(t, "dashboard.events_2", "Records grouped into disaster events"), linkageExport(t, d, m.linkage), (c, e) => <LinkageView common={c} d={d} exp={e} />],
		[3, tr(t, "dashboard.events_3", "Largest disaster events by disaster impact"), largestEventsExport(t, d, m.largest), (c, e) => <LargestView common={c} d={d} exp={e} />],
		[4, tr(t, "dashboard.events_4", "Disaster events by year"), byYearExport(t, d, m.byYear),
			(c, e) => (
				<Frame common={c} exp={e}>
					<YearColumns years={continuousYears(d.byYear.years)} height={180} width={480} label={c.title} noDataText={noEvents} />
				</Frame>
			)],
		[5, tr(t, "dashboard.events_5", "Hazard ranking by disaster events"), byHazardExport(t, d, m.byHazard),
			(c, e) => (
				<Frame common={c} exp={e}>
					<RowBars ctx={ctx} label={c.title} rows={d.byHazard.rows.map((r) => ({ key: r.hipTypeId, label: r.label, bars: [{ cell: countCell(r.events) }], filter: rowFilter("hazard", r.hipTypeId) }))} />
				</Frame>
			)],
		[6, tr(t, "dashboard.events_6", "Records per disaster event"), recordsPerEventExport(t, d, m.recordsPerEvent),
			(c, e) => (
				<Frame common={c} exp={e}>
					<span className="text-sm text-brand-text-muted">{tr(t, "dashboard.events_by_records", "Events by number of linked records")}</span>
					<RowBars ctx={ctx} label={c.title} order="given" rows={d.recordsPerEvent.bins.map((b) => ({ key: b.label, label: b.label, bars: [{ cell: countCell(b.events) }] }))} />
					{/* Records, not events: a separate line, never a bar on the events scale. */}
					<p className="m-0 text-sm">
						{tr(t, "dashboard.not_grouped_records", "Not grouped: {n} records belong to no event.", { n: d.recordsPerEvent.recordsNotGrouped.toLocaleString(ctx.lang) })}
					</p>
				</Frame>
			)],
		[7, tr(t, "dashboard.events_7", "Extensive and intensive risk by disaster event"), eventSizeExport(t, d, m.eventSize), (c, e) => <EventSizeView common={c} d={d} exp={e} />],
	];
	const drawn = spec.map(([n, title, exp, view]): DashboardPanel => ({ id: `events-${n}`, n, title, exportData: exp, render: () => view(common(title), exp) }));
	const divisions = opts.map ? [eventDivisionsPanel(ctx, opts.map, common)] : [];
	const months = opts.hazardMonth ? [hazardMonthPanel(ctx, opts.hazardMonth, "events-21", 21, opts)] : [];
	const built = [...drawn, ...divisions, ...(opts.more ? eventPanels8to16(ctx, opts.more, common) : []), ...months];
	// Unbuilt features (Alex, 2026-10-19): a grey placeholder in their slot,
	// the rest in Features Coming Soon, official warning included.
	return arrangeByLayout([...built, ...comingSoonPanels(ctx, "events", EVENTS_LAYOUT, built)], EVENTS_LAYOUT);
}

/** How many divisions Ranked by divisions lists before "n other divisions". */
const TOP_DIVISIONS = 10;

/**
 * Ranked by divisions on Disaster events (FE-Proposal-02): the event map's
 * own counts per level-1 division, so the panel and the map agree. An event
 * in several divisions counts in each, so the rows do not add up.
 */
export function eventDivisionsPanel(ctx: ViewContext, map: EventMapPayload, common: (title: string) => Common): DashboardPanel {
	const t = ctx.t;
	const title = tr(t, "dashboard.events_divisions", "Ranked by divisions");
	const ranked = map.areas.filter((a) => a.events > 0).sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
	const shown = ranked.slice(0, TOP_DIVISIONS);
	const rest = ranked.length - shown.length;
	const note = tr(t, "dashboard.map_events_note", "An event in several provinces counts in each, so provinces do not add up.");
	const exp: PanelExport = {
		rows: ranked.map((a) => countRow(a.name, a.events, "events")),
		method: map.meta.method,
		notes: panelNotes(map.meta, [note]),
	};
	return {
		id: "events-divisions",
		n: 17,
		title,
		exportData: exp,
		render: () => (
			<Frame common={common(title)} exp={exp}>
				<RowBars ctx={ctx} label={title} rows={shown.map((a) => ({ key: a.divisionId, label: a.name, bars: [{ cell: countCell(a.events) }], filter: rowFilter("division", a.divisionId) }))} />
				{rest > 0 && (
					<p className="m-0 text-sm text-brand-text-muted">
						{tr(t, "dashboard.other_divisions_with_events", "{n} other divisions with events", { n: rest.toLocaleString(ctx.lang) })}
					</p>
				)}
			</Frame>
		),
	};
}

/** Share track for "n of N": an empty track is 0, which is a finding. */
function ShareTrack({ n, of }: { n: number; of: number }) {
	const share = of > 0 ? n / of : 0;
	return (
		<svg width="100%" height={6} aria-hidden="true" focusable="false" className="mt-1 block">
			<rect x={0} y={0} width="100%" height={6} rx={3} fill={DASHBOARD_RAMP[1]} />
			{n > 0 && <rect x={0} y={0} width={`${Math.max(2, share * 100)}%`} height={6} rx={3} fill={DASHBOARD_RAMP[3]} />}
		</svg>
	);
}

/**
 * Disaster events panels 11, 12, 13 and 16 (Analytics ee73e61f,
 * reassessment DE-11 to DE-16). Counts of events or of their linked
 * records, never one for the other.
 */
export function eventPanels8to16(ctx: ViewContext, d: EventPanels8to16, common: (title: string) => Common): DashboardPanel[] {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const m = d.meta;
	const th = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
	const td = "border-b border-brand-border px-2 py-1";

	// 11: the register, newest first.
	const regTitle = tr(t, "dashboard.events_11", "Disaster event register");
	const reg = d.register;
	const regShown = tr(t, "dashboard.register_shown", "Newest {n} of {total} events in scope.", { n: n(reg.rows.length), total: n(reg.eventsInScope) });
	const regExp: PanelExport = {
		rows: reg.rows.map((r) => countRow(r.name, r.records, "linked records", r.startDate ?? undefined)),
		method: m.register.method,
		notes: panelNotes(m.register, [regShown]),
	};
	const register: DashboardPanel = {
		id: "events-11",
		n: 11,
		title: regTitle,
		exportData: regExp,
		render: () => (
			<Frame common={common(regTitle)} exp={regExp} pictures={false}>
				<p className="m-0 text-xs text-brand-text-muted">{regShown}</p>
				<div className="max-h-96 max-w-full overflow-auto">
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">{regTitle}</caption>
						<thead className="sticky top-0">
							<tr>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.event", "Event")}</th>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.start", "Start")}</th>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.hazard", "Hazard")}</th>
								<th scope="col" className={`${th} text-start`}>GLIDE</th>
								<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.records", "Records")}</th>
								<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.divisions", "Divisions")}</th>
							</tr>
						</thead>
						<tbody>
							{reg.rows.map((r) => (
								<tr key={r.eventId}>
									<th scope="row" className={`${td} text-start font-normal`}>{r.name}</th>
									<td className={`${td} whitespace-nowrap`}>{r.startDate ?? "—"}</td>
									<td className={td}>{r.hazardLabel}</td>
									<td className={`${td} whitespace-nowrap`}>{r.glide ?? "—"}</td>
									<td className={`${td} text-end tabular-nums`}>{n(r.records)}</td>
									<td className={`${td} text-end tabular-nums`}>{n(r.divisions)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Frame>
		),
	};

	// 12: fields filled, as events of all events in scope.
	const compTitle = tr(t, "dashboard.events_12", "Reporting completeness of disaster events");
	const comp = d.completeness;
	const compExp: PanelExport = {
		rows: comp.rows.map((r) => countRow(r.label, r.events, `events filling the field, of ${comp.eventsInScope}`)),
		method: m.completeness.method,
		notes: panelNotes(m.completeness),
	};
	const completeness: DashboardPanel = {
		id: "events-12",
		n: 12,
		title: compTitle,
		exportData: compExp,
		render: () => (
			<Frame common={common(compTitle)} exp={compExp} pictures={false}>
				<ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
					{comp.rows.map((r) => (
						<li key={r.key}>
							<span className="flex justify-between gap-2">
								<span>{r.label}</span>
								<span className="tabular-nums">{tr(t, "dashboard.n_of_total", "{n} of {total}", { n: n(r.events), total: n(comp.eventsInScope) })}</span>
							</span>
							<ShareTrack n={r.events} of={comp.eventsInScope} />
						</li>
					))}
				</ul>
			</Frame>
		),
	};

	// 13: events by how many level-1 divisions their records touch.
	const divTitle = tr(t, "dashboard.events_13", "Divisions per disaster event");
	const dpe = d.divisionsPerEvent;
	const noDiv = tr(t, "dashboard.events_without_division", "{n} events name no division and are left out.", { n: n(dpe.eventsWithoutDivision) });
	const divExp: PanelExport = {
		rows: dpe.bins.map((b) => countRow(b.label, b.events, "events")),
		method: m.divisionsPerEvent.method,
		notes: panelNotes(m.divisionsPerEvent, [dpe.eventsWithoutDivision > 0 ? noDiv : undefined]),
	};
	const perEvent: DashboardPanel = {
		id: "events-13",
		n: 13,
		title: divTitle,
		exportData: divExp,
		render: () => (
			<Frame common={common(divTitle)} exp={divExp}>
				<RowBars ctx={ctx} label={divTitle} order="given" rows={dpe.bins.map((b) => ({ key: b.label, label: b.label, bars: [{ cell: countCell(b.events) }] }))} />
				{dpe.eventsWithoutDivision > 0 && <p className="m-0 text-sm text-brand-text-muted">{noDiv}</p>}
			</Frame>
		),
	};

	// 16: events with a linked record reporting damage, per sector.
	const secTitle = tr(t, "dashboard.events_16", "Disaster events by sector");
	const bs = d.bySector;
	const noSec = tr(t, "dashboard.events_without_sector", "{n} events have no linked record reporting sector damage.", { n: n(bs.eventsWithoutSector) });
	const secExp: PanelExport = {
		rows: bs.rows.map((r) => countRow(r.label, r.events, "events")),
		method: m.bySector.method,
		notes: panelNotes(m.bySector, [bs.eventsWithoutSector > 0 ? noSec : undefined]),
	};
	const bySector: DashboardPanel = {
		id: "events-16",
		n: 16,
		title: secTitle,
		exportData: secExp,
		render: () => (
			<Frame common={common(secTitle)} exp={secExp}>
				<RowBars ctx={ctx} label={secTitle} rows={bs.rows.map((r) => ({ key: r.sectorId, label: r.label, bars: [{ cell: countCell(r.events) }] }))} />
				{bs.eventsWithoutSector > 0 && <p className="m-0 text-sm text-brand-text-muted">{noSec}</p>}
			</Frame>
		),
	};

	// DE-20 Events with several hazards (Analytics ac42bc55): co-occurrence
	// only; a pair in one event is never read as one hazard causing another.
	const mixTitle = tr(t, "dashboard.events_20", "Events with several hazards");
	const mix = d.hazardMix;
	const topPairs = mix.pairs.slice(0, 5);
	const coNote = tr(t, "dashboard.cooccurrence_note", "Hazards found in the same event, not a cause and effect.");
	const mixExp: PanelExport = {
		rows: [
			...mix.bins.map((b) => countRow(b.label, b.events, "events", tr(t, "dashboard.hazard_clusters", "Hazard clusters per event"))),
			...mix.pairs.map((p) => countRow(`${p.a} + ${p.b}`, p.events, "events", tr(t, "dashboard.hazard_pairs", "Hazard pairs"))),
		],
		method: m.hazardMix.method,
		notes: panelNotes(m.hazardMix, [
			coNote,
			mix.eventsWithoutHazard > 0 ? tr(t, "dashboard.events_without_hazard", "{n} events have no hazard on their records and are left out.", { n: n(mix.eventsWithoutHazard) }) : undefined,
		]),
	};
	const hazardMix: DashboardPanel = {
		id: "events-20",
		n: 20,
		title: mixTitle,
		exportData: mixExp,
		render: () => (
			<Frame common={common(mixTitle)} exp={mixExp}>
				<RowBars ctx={ctx} label={mixTitle} order="given" rows={mix.bins.map((b) => ({ key: b.label, label: b.label, bars: [{ cell: countCell(b.events) }] }))} />
				{topPairs.length > 0 && (
					<ul className="m-0 list-none p-0 text-sm">
						{topPairs.map((p) => <li key={`${p.a}|${p.b}`}>{`${p.a} + ${p.b}: ${n(p.events)}`}</li>)}
					</ul>
				)}
				<p className="m-0 text-xs text-brand-text-muted">{coNote}</p>
			</Frame>
		),
	};

	return [register, completeness, perEvent, bySector, exceedancePanel(ctx, d, common), hazardMix];
}

/**
 * DE-17 Exceedance and return period (Analytics fe24a633): how often an
 * event of each size or larger occurs in the period recorded. Empirical
 * counts on log-log axes; under ten events it says so and draws nothing.
 * Not a hazard or risk model.
 */
function exceedancePanel(ctx: ViewContext, d: EventPanels8to16, common: (title: string) => Common): DashboardPanel {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const title = tr(t, "dashboard.events_17", "Exceedance and return period");
	const x = d.exceedance;
	const measure = effectLabel(t, x.measure as never);
	const notModel = tr(t, "dashboard.exceedance_not_model", "Counts of recorded events only. Not a hazard or risk model.");
	const exp: PanelExport = {
		rows: x.points.map((p) => ({ label: p.name, series: tr(t, "dashboard.return_period_years", "Return period (years)"), value: p.returnPeriodYears, valueState: p.returnPeriodYears === null ? "not_reported" : "reported", unit: `${measure}: ${n(p.value)}` })),
		method: d.meta.exceedance.method,
		notes: panelNotes(d.meta.exceedance, [
			notModel,
			x.eventsNotReported > 0 ? tr(t, "dashboard.exceedance_left_out", "{n} events report no {measure} and are left out.", { n: n(x.eventsNotReported), measure }) : undefined,
		]),
	};
	const W = 480, H = 220, L = 48, B = 32, T = 8, R = 12;
	const pts = x.points.filter((p) => p.value > 0 && p.returnPeriodYears !== null && p.returnPeriodYears > 0);
	const lx = (v: number) => Math.log10(v);
	const [x0, x1] = [Math.floor(Math.min(...pts.map((p) => lx(p.value)), 0)), Math.ceil(Math.max(...pts.map((p) => lx(p.value)), 1))];
	const [y0, y1] = [Math.floor(Math.min(...pts.map((p) => lx(p.returnPeriodYears!)), 0)), Math.ceil(Math.max(...pts.map((p) => lx(p.returnPeriodYears!)), 1))];
	const sx = (v: number) => L + ((lx(v) - x0) / Math.max(1, x1 - x0)) * (W - L - R);
	const sy = (v: number) => H - B - ((lx(v) - y0) / Math.max(1, y1 - y0)) * (H - B - T);
	const ticks = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => 10 ** (a + i));
	return {
		id: "events-17",
		n: 17,
		title,
		exportData: exp,
		render: () => (
			<Frame common={common(title)} exp={exp}>
				{x.tooFewEvents || pts.length === 0 ? (
					<p className="m-0 text-sm">{tr(t, "dashboard.exceedance_too_few", "Fewer than ten events report {measure}, too few for a return period.", { measure })}</p>
				) : (
					<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} fontSize={10} className="block max-w-full">
						{ticks(x0, x1).map((v) => (
							<g key={`x${v}`}>
								<line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} stroke={DASHBOARD_RAMP[1]} />
								<text x={sx(v)} y={H - B + 14} textAnchor="middle" fill="currentColor">{n(v)}</text>
							</g>
						))}
						{ticks(y0, y1).map((v) => (
							<g key={`y${v}`}>
								<line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke={DASHBOARD_RAMP[1]} />
								<text x={L - 4} y={sy(v) + 3} textAnchor="end" fill="currentColor">{n(v)}</text>
							</g>
						))}
						{pts.map((p) => (
							<circle key={p.eventId} cx={sx(p.value)} cy={sy(p.returnPeriodYears!)} r={3.5} fill={DASHBOARD_RAMP[3]}>
								<title>{`${p.name}: ${measure} ${n(p.value)}, ${tr(t, "dashboard.once_in", "about once in {y} years", { y: n(Math.round(p.returnPeriodYears! * 10) / 10) })}`}</title>
							</circle>
						))}
						<text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" fill="currentColor">{measure}</text>
						<text x={10} y={(T + H - B) / 2} textAnchor="middle" fill="currentColor" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>
							{tr(t, "dashboard.return_period_years", "Return period (years)")}
						</text>
					</svg>
				)}
				<p className="m-0 text-xs text-brand-text-muted">{notModel}</p>
			</Frame>
		),
	};
}
