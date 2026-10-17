// Hazardous events panels 1 to 7 (panels paper v0.3, section 4.1). Counts
// are plain counts of recorded hazardous events. Migrated tenants hold
// none (G-01): the view then shows one frame with the reason, never seven
// panels of zeros. DELTA issues no warnings: the status column reads
// "Recorded status", and a forecasted status shows to signed-in users only,
// labelled as a recorded status, not a forecast (EWS reserved words).
import type React from "react";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import { panelNotes, type PanelExport } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { RowBars, ShadedTable, shadeFor } from "../blocks";
import { countCell } from "../events/eventPanels";
import { YearColumns } from "../impact/ImpactTimeline";

type T = ViewContext["t"];
const tr = (t: T, code: string, msg: string, r?: Record<string, unknown>) => t({ code, msg }, r);
const countRow = (label: string, n: number, series?: string): ChartExportRow => ({
	label,
	series,
	value: n,
	valueState: "reported",
	unit: "hazardous events",
});
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every year from the first to the last; a year with no event is a gap. */
export function yearSpan(years: { year: number; events: number }[]): { year: number; cell: PanelCell }[] {
	if (years.length === 0) return [];
	const by = new Map(years.map((y) => [y.year, y.events]));
	const first = Math.min(...years.map((y) => y.year));
	const last = Math.max(...years.map((y) => y.year));
	return Array.from({ length: last - first + 1 }, (_, i) => {
		const n = by.get(first + i);
		return { year: first + i, cell: n ? countCell(n) : { ...countCell(0), value: null, valueState: "not_reported" as const } };
	});
}

/** Rows the signed-out reader may see: no forecasted status in public. */
export function visibleOngoing(d: HazardEventPanels1to7, signedIn: boolean) {
	return d.ongoing.rows.filter((r) => signedIn || r.status !== "forecasted");
}

function statusText(t: T, s: "ongoing" | "forecasted"): string {
	return s === "ongoing"
		? tr(t, "dashboard.status_ongoing", "Recorded as ongoing")
		: tr(t, "dashboard.status_forecasted", "Recorded as forecasted (recorded status, not a forecast)");
}

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

const th = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
const td = "border-b border-brand-border px-2 py-1";

export function hazardEventDashboardPanels(
	ctx: ViewContext,
	d: HazardEventPanels1to7,
	opts: { source: string; scope: string; provisional: boolean; signedIn: boolean },
): DashboardPanel[] {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const title = (k: number, msg: string) => tr(t, `dashboard.hazard_events_${k}`, msg);

	// G-01: one frame across the view, with the reason.
	if (d.empty) {
		return [
			{
				id: "hazard-events-empty",
				n: 1,
				title: tr(t, "dashboard.dim_hazardous_events", "Hazardous events"),
				gap: { code: d.empty.code, text: tr(t, "dashboard.hazard_events_empty", d.empty.reason) },
			},
		];
	}

	const common = (x: string): Common => ({ ctx, title: x, source: opts.source, scope: opts.scope, provisional: opts.provisional });
	const notes = (own: (string | undefined)[] = []) => panelNotes(d.meta, own);
	const h = d.headline;
	const share = (x: number) => tr(t, "dashboard.n_of_events", "{n} of {total} hazardous events", { n: n(x), total: n(h.events) });
	const ongoing = visibleOngoing(d, opts.signedIn);

	const exports: Record<number, PanelExport> = {
		1: {
			rows: [
				countRow(title(1, "Hazardous events"), h.events),
				countRow(tr(t, "dashboard.he_ongoing", "Recorded as ongoing or forecasted"), h.ongoingOrForecasted),
				countRow(tr(t, "dashboard.he_linked", "Linked to a disaster event"), h.linkedToDisasterEvent),
				countRow(tr(t, "dashboard.he_footprint", "With a footprint"), h.withFootprint),
				countRow(tr(t, "dashboard.he_coded", "Coded at hazard level"), h.codedAtHazardLevel),
			],
			method: d.meta.method,
			notes: notes(),
		},
		2: {
			rows: ongoing.map((r) => ({ ...countRow(r.hazardLabel, r.divisions, statusText(t, r.status)), unit: "divisions" })),
			method: d.meta.method,
			notes: notes([
				tr(t, "dashboard.no_warnings", "DELTA Resilience issues no warnings."),
				opts.signedIn ? undefined : tr(t, "dashboard.forecast_signed_in", "Forecasted statuses show to signed-in users only."),
			]),
		},
		3: {
			rows: d.byYear.years.map((y) => countRow(String(y.year), y.events)),
			method: d.meta.method,
			notes: notes([
				d.byYear.eventsWithoutYear > 0 ? tr(t, "dashboard.he_without_year", "{n} hazardous events have no start year.", { n: d.byYear.eventsWithoutYear }) : undefined,
				tr(t, "dashboard.more_recording", "More events in later years can reflect more recording."),
			]),
		},
		4: {
			rows: d.season.cells.map((c) => countRow(`${c.year}-${String(c.month).padStart(2, "0")}`, c.events)),
			method: d.meta.method,
			notes: notes([
				d.season.eventsWithoutMonth > 0 ? tr(t, "dashboard.he_without_month", "{n} hazardous events have no month and are left out.", { n: d.season.eventsWithoutMonth }) : undefined,
			]),
		},
		5: { rows: d.byHazard.rows.map((r) => countRow(r.label, r.events)), method: d.meta.method, notes: notes() },
		6: {
			rows: d.depth.rows.flatMap((r) => [
				countRow(r.label, r.typeOnly, tr(t, "dashboard.depth_type", "Type only")),
				countRow(r.label, r.cluster, tr(t, "dashboard.depth_cluster", "Cluster")),
				countRow(r.label, r.specificHazard, tr(t, "dashboard.depth_specific", "Specific hazard")),
			]),
			method: d.meta.method,
			notes: notes(),
		},
		7: {
			rows: d.divisions.rows.map((r) => countRow(r.name, r.events)),
			method: d.meta.method,
			notes: notes([
				d.divisions.divisionsWithoutEvents > 0
					? tr(t, "dashboard.he_div_none", "{n} divisions: no events recorded.", { n: d.divisions.divisionsWithoutEvents })
					: undefined,
				d.divisions.multiDivisionEvents > 0
					? tr(t, "dashboard.he_multi_div", "{n} hazardous events touch several divisions and count in each.", { n: d.divisions.multiDivisionEvents })
					: undefined,
			]),
		},
	};

	const tile = (label: string, value: number, sub?: string) => (
		<li className="flex min-w-0 flex-col gap-1 rounded border border-brand-border bg-brand-surface-card p-3">
			<span className="text-sm text-brand-text-muted">{label}</span>
			<span className="text-2xl font-semibold tabular-nums">{n(value)}</span>
			{sub && <span className="text-xs text-brand-text-muted">{sub}</span>}
		</li>
	);
	const seasonYears = [...new Set(d.season.cells.map((c) => c.year))].sort((a, b) => a - b);
	const seasonMax = Math.max(0, ...d.season.cells.map((c) => c.events));

	const views: Record<number, (c: Common, e: PanelExport) => React.ReactNode> = {
		1: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
					{tile(title(1, "Hazardous events"), h.events)}
					{tile(tr(t, "dashboard.he_ongoing", "Recorded as ongoing or forecasted"), h.ongoingOrForecasted, share(h.ongoingOrForecasted))}
					{tile(tr(t, "dashboard.he_linked", "Linked to a disaster event"), h.linkedToDisasterEvent, share(h.linkedToDisasterEvent))}
					{tile(tr(t, "dashboard.he_footprint", "With a footprint"), h.withFootprint, share(h.withFootprint))}
					{tile(tr(t, "dashboard.he_coded", "Coded at hazard level"), h.codedAtHazardLevel, share(h.codedAtHazardLevel))}
				</ul>
			</Frame>
		),
		2: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				{ongoing.length === 0 ? (
					<p className="m-0 text-sm text-brand-text-muted">
						{tr(t, "dashboard.no_ongoing", "No ongoing or forecast hazardous events recorded.")}
					</p>
				) : (
					<div className="max-w-full overflow-x-auto">
						<table className="w-full border-collapse text-sm">
							<caption className="sr-only">{c.title}</caption>
							<thead>
								<tr>
									<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.hazard", "Hazard")}</th>
									<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.recorded_status", "Recorded status")}</th>
									<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.start", "Start")}</th>
									<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.divisions", "Divisions")}</th>
									<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.source", "Source")}</th>
									<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.last_update", "Last update")}</th>
								</tr>
							</thead>
							<tbody>
								{ongoing.map((r) => (
									<tr key={r.eventId}>
										<th scope="row" className={`${td} text-start font-normal`}>{r.hazardLabel}</th>
										<td className={td}>{statusText(t, r.status)}</td>
										<td className={td}>{r.startDate ?? tr(t, "dashboard.no_date", "No date")}</td>
										<td className={`${td} text-end tabular-nums`}>{n(r.divisions)}</td>
										<td className={td}>{r.dataSource ?? tr(t, "dashboard.not_recorded", "Not recorded")}</td>
										<td className={td}>{r.lastUpdate ?? tr(t, "dashboard.not_recorded", "Not recorded")}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Frame>
		),
		3: (c, e) => (
			<Frame common={c} exp={e}>
				<YearColumns years={yearSpan(d.byYear.years)} height={180} width={480} label={c.title}
					noDataText={tr(t, "dashboard.no_events_year", "No events recorded")} />
			</Frame>
		),
		4: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<div className="max-w-full overflow-x-auto">
					<table className="border-collapse text-xs">
						<caption className="sr-only">{c.title}</caption>
						<thead>
							<tr>
								<th scope="col" className="px-1 py-1 text-start">{tr(t, "dashboard.year", "Year")}</th>
								{MONTHS.map((m) => <th key={m} scope="col" className="px-1 py-1 text-center font-semibold">{m}</th>)}
							</tr>
						</thead>
						<tbody>
							{seasonYears.map((y) => (
								<tr key={y}>
									<th scope="row" className="px-1 py-1 text-start font-semibold">{y}</th>
									{MONTHS.map((m, i) => {
										const cell = d.season.cells.find((x) => x.year === y && x.month === i + 1);
										return (
											<td key={m} className="h-7 min-w-7 border border-brand-border px-0.5 text-center tabular-nums"
												style={{ background: shadeFor(cell?.events || null, seasonMax) }}
												title={`${m} ${y}: ${cell ? n(cell.events) : tr(t, "dashboard.no_events_year", "No events recorded")}`}>
												{cell ? n(cell.events) : ""}
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="m-0 text-xs text-brand-text-muted">{tr(t, "dashboard.he_season_key", "Blank: no hazardous event began that month.")}</p>
			</Frame>
		),
		5: (c, e) => (
			<Frame common={c} exp={e}>
				<RowBars ctx={ctx} label={c.title} rows={d.byHazard.rows.map((r) => ({ key: r.hipTypeId, label: r.label, bars: [{ cell: countCell(r.events) }] }))} />
			</Frame>
		),
		6: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<ShadedTable ctx={ctx} caption={c.title} rowHeader={tr(t, "dashboard.hazard_type", "Hazard type")}
					columns={[tr(t, "dashboard.depth_type", "Type only"), tr(t, "dashboard.depth_cluster", "Cluster"), tr(t, "dashboard.depth_specific", "Specific hazard")]}
					rows={d.depth.rows.map((r) => ({ key: r.hipTypeId, label: r.label, cells: [countCell(r.typeOnly), countCell(r.cluster), countCell(r.specificHazard)] }))}
					normalise="table" />
			</Frame>
		),
		7: (c, e) => (
			<Frame common={c} exp={e}>
				<RowBars ctx={ctx} label={c.title} rows={d.divisions.rows.map((r) => ({ key: r.divisionId, label: r.name, bars: [{ cell: countCell(r.events) }] }))} />
			</Frame>
		),
	};

	const titles: Record<number, string> = {
		1: title(1, "Hazardous events at a glance"),
		2: title(2, "Recorded as ongoing or forecasted"),
		3: title(3, "Hazardous events by year"),
		4: title(4, "Season of onset"),
		5: title(5, "Hazard ranking"),
		6: title(6, "Classification depth"),
		7: title(7, "Ranked divisions"),
	};
	const drawn = [1, 2, 3, 4, 5, 6, 7].map((k): DashboardPanel => ({
		id: `hazard-events-${k}`,
		n: k,
		title: titles[k],
		exportData: exports[k],
		render: () => views[k](common(titles[k]), exports[k]),
	}));
	const later: [number, string][] = [
		[8, title(8, "Multi-hazard places")],
		[9, title(9, "From hazard to disaster")],
		[10, title(10, "Cascade and multi-hazard links")],
		[11, title(11, "Hazardous event register")],
		[12, title(12, "Field completeness")],
		[13, title(13, "Hazard hierarchy")],
		[14, title(14, "Trends per hazard type")],
		[15, title(15, "Duration by onset class")],
		[16, title(16, "Magnitude by hazard")],
	];
	return [
		...drawn,
		...later.map(([k, x]): DashboardPanel => ({
			id: `hazard-events-${k}`,
			n: k,
			title: x,
			gap:
				k === 16
					? { code: "G-19", text: tr(t, "dashboard.g19", "Magnitude is free text with no unit field.") }
					: { code: "D1 hazardous events", text: tr(t, "dashboard.panel_in_build", "This panel is being built.") },
		})),
	];
}
