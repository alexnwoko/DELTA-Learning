// Hazard by month (Alex, 2026-10-19; heatmap redesign approved the same
// day): one row per specific HIPs hazard under its cluster heading, the 12
// calendar months with years pooled, a 13th "Month unknown" column so a
// hazard dated only by a source default (Ethiopia's drought on 7 September)
// never disappears, and a row-total bar. One switch moves every box between
// the number of occurrences and the people affected; rows sort by the
// switch. Rare severe months (server rule, meta.method) are ringed. An empty
// month is blank, never 0. Only hazards with a reported number of people
// affected, the top 20 by it (Alex, 2026-10-19).
import { useState } from "react";
import { Button, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import type { ViewContext } from "~/frontend/context";
import type { HazardMonth, HazardMonthRow } from "~/utils/dashboard/hazardMonth";
import { cellRow, cellText, panelNotes, type PanelExport } from "../panelCell";
import type { DashboardPanel } from "../types";
import { shadeFor } from "./blocks";
import { effectLabel } from "./impact/panels5to16";

type Mode = "count" | "people";
type Cell = HazardMonthRow["cells"][number];

/** The chart keeps the top 20 hazards by people affected (Alex, 2026-10-19). */
export const TOP_ROWS = 20;

const focusRing =
	"data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";

function monthNames(lang: string): string[] {
	return Array.from({ length: 12 }, (_, i) =>
		new Date(Date.UTC(2000, i, 1)).toLocaleString(lang, { month: "short", timeZone: "UTC" }),
	);
}

const reported = (c: { valueState: string; value: number | null }) =>
	c.valueState === "reported" && c.value !== null && c.value > 0 ? c.value : null;
const unknownMonth = (r: HazardMonthRow) => r.unplaced.placeholder + r.unplaced.noMonth;

/** "09-07" as "7 September". */
function dayLabel(lang: string, day: string): string {
	const [m, d] = day.split("-").map(Number);
	return new Date(Date.UTC(2000, m - 1, d)).toLocaleString(lang, { day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * The hazards the chart keeps (Alex, 2026-10-19): only those with a reported
 * number of people affected, the top 20 by that number.
 */
export function topHazards(rows: HazardMonthRow[]): HazardMonthRow[] {
	return rows
		.filter((r) => reported(r.people) !== null)
		.sort((a, b) => (reported(b.people) ?? 0) - (reported(a.people) ?? 0) || a.label.localeCompare(b.label))
		.slice(0, TOP_ROWS);
}

/** Rows in display order: clusters by their largest row, rows within by the switch. */
export function orderRows(rows: HazardMonthRow[], mode: Mode): HazardMonthRow[] {
	const size = (r: HazardMonthRow) => (mode === "people" ? reported(r.people) ?? -1 : r.allOccurrences);
	const sorted = [...rows].sort((a, b) => size(b) - size(a) || a.label.localeCompare(b.label));
	const groupOf = (r: HazardMonthRow) => r.clusterLabel ?? r.label;
	const order: string[] = [];
	for (const r of sorted) if (!order.includes(groupOf(r))) order.push(groupOf(r));
	return order.flatMap((g) => sorted.filter((r) => groupOf(r) === g));
}

function peopleLabel(ctx: ViewContext, d: HazardMonth): string {
	// The switch names people plainly (Alex, 2026-10-19: directly affected by default).
	return d.measure === "affected_direct"
		? ctx.t({ code: "dashboard.people_directly_affected", msg: "People directly affected" })
		: effectLabel(ctx.t, d.measure as never);
}

/** The panel's rows and notes, for its frame and the page CSV. */
export function hazardMonthExport(ctx: ViewContext, d: HazardMonth): PanelExport {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const months = monthNames(ctx.lang);
	const occ = d.unit === "disaster_event" ? t({ code: "dashboard.events", msg: "Disaster events" }) : t({ code: "dashboard.records", msg: "Records" });
	const measure = peopleLabel(ctx, d);
	const unknown = t({ code: "dashboard.month_unknown", msg: "Month unknown" });
	const total = t({ code: "dashboard.total", msg: "Total" });
	// Months with no occurrence stay out, so the table never shows a 0 month.
	const rows: ChartExportRow[] = orderRows(topHazards(d.rows), "count").flatMap((r) => [
		...r.cells.filter((c) => c.count > 0).flatMap((c) => [
			{ label: `${r.label}, ${months[c.month - 1]}`, series: occ, value: c.count, valueState: "reported" as const, unit: occ.toLowerCase() },
			{ ...cellRow(`${r.label}, ${months[c.month - 1]}`, c.people, measure), unit: c.rare ? t({ code: "dashboard.rare_flag", msg: "rare and severe" }) : undefined },
		]),
		...(unknownMonth(r) > 0 ? [{ label: `${r.label}, ${unknown}`, series: occ, value: unknownMonth(r), valueState: "reported" as const, unit: occ.toLowerCase() }] : []),
		{ label: `${r.label}, ${total}`, series: occ, value: r.allOccurrences, valueState: "reported" as const, unit: occ.toLowerCase() },
		cellRow(`${r.label}, ${total}`, r.people, measure),
	]);
	const occWord = d.unit === "disaster_event" ? t({ code: "dashboard.events_lower", msg: "events" }) : t({ code: "dashboard.records_lower", msg: "records" });
	return {
		rows,
		method: d.meta.method,
		notes: panelNotes(d.meta, [
			d.years ? t({ code: "dashboard.years_pooled", msg: "{from} to {to}, all years together." }, { from: d.years.from, to: d.years.to }) : undefined,
			// Each source default date named, so the reader sees why a month is unknown.
			...d.placeholderDays.map((p) =>
				t({ code: "dashboard.placeholder_day", msg: "{n} {what} dated {day}, a source default: month unknown." }, { n: n(p.occurrences), what: occWord, day: dayLabel(ctx.lang, p.day) }),
			),
			d.withoutMonth > 0 ? t({ code: "dashboard.without_month", msg: "{n} have no start month: month unknown." }, { n: n(d.withoutMonth) }) : undefined,
			t({ code: "dashboard.people_dated_only", msg: "People are counted over occurrences with a usable month." }),
			t({ code: "dashboard.top20_note", msg: "The top {n} hazards by people affected; hazards with no reported figure are left out." }, { n: TOP_ROWS }),
		]),
	};
}

function HazardMonthView({ ctx, d, title, exp, common }: { ctx: ViewContext; d: HazardMonth; title: string; exp: PanelExport; common: Common }) {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const [mode, setMode] = useState<Mode>("count");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const months = monthNames(ctx.lang);
	const occLabel = d.unit === "disaster_event" ? t({ code: "dashboard.mode_events", msg: "Number of events" }) : t({ code: "dashboard.mode_records", msg: "Number of records" });
	const pLabel = peopleLabel(ctx, d);
	const unknown = t({ code: "dashboard.month_unknown", msg: "Month unknown" });
	const rare = t({ code: "dashboard.rare_flag", msg: "rare and severe" });

	const shown = orderRows(topHazards(d.rows), mode);
	const value = (c: Cell) => (mode === "count" ? (c.count > 0 ? c.count : null) : reported(c.people));
	const rowTotal = (r: HazardMonthRow) => (mode === "count" ? r.allOccurrences : reported(r.people));
	const max = Math.max(0, ...shown.flatMap((r) => [...r.cells.map((c) => value(c) ?? 0), mode === "count" ? unknownMonth(r) : 0]));
	const maxTotal = Math.max(1, ...shown.map((r) => rowTotal(r) ?? 0));
	const anyRare = shown.some((r) => r.cells.some((c) => c.rare));
	const groupOf = (r: HazardMonthRow) => r.clusterLabel ?? r.label;
	const groups: { name: string; rows: HazardMonthRow[] }[] = [];
	for (const r of shown) {
		const g = groups.find((x) => x.name === groupOf(r));
		if (g) g.rows.push(r);
		else groups.push({ name: groupOf(r), rows: [r] });
	}
	const toggle = (g: string) =>
		setCollapsed((s) => {
			const next = new Set(s);
			if (next.has(g)) next.delete(g);
			else next.add(g);
			return next;
		});

	return (
		<ChartFrame ctx={ctx} title={title} rows={exp.rows}
			meta={{ source: common.source, scope: common.scope, method: exp.method, basis: common.provisional ? "provisional" : "published", notes: exp.notes }}>
			{/* Under the title, small (Alex, 2026-10-19). */}
			<p className="m-0 -mt-1 text-brand-text-muted" style={{ fontSize: "7.5pt" }}>
				{t({ code: "dashboard.top_n", msg: "Top {n}" }, { n: TOP_ROWS })}
			</p>
			<ToggleButtonGroup
				aria-label={t({ code: "dashboard.hazard_month_switch", msg: "Show in each box" })}
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[mode]}
				onSelectionChange={(keys) => {
					const k = Array.from(keys)[0];
					if (k === "count" || k === "people") setMode(k);
				}}
				data-print="hide"
				className="flex flex-wrap gap-1"
			>
				{([["count", occLabel], ["people", pLabel]] as const).map(([id, label]) => (
					<ToggleButton key={id} id={id}
						className={`rounded-full border border-brand-border-control bg-brand-surface px-3 py-0.5 text-sm font-semibold data-[hovered]:bg-brand-surface-subtle data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive ${focusRing}`}>
						{label}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-xs">
					<caption className="sr-only">{`${title}: ${mode === "count" ? occLabel : pLabel}`}</caption>
					<thead>
						<tr>
							<th scope="col" className="px-1 py-1 text-start">{t({ code: "dashboard.hazard", msg: "Hazard" })}</th>
							{months.map((m) => <th key={m} scope="col" className="px-1 py-1 text-center font-semibold">{m}</th>)}
							<th scope="col" className="px-1 py-1 text-center font-semibold" title={t({ code: "dashboard.month_unknown_hint", msg: "Source default dates and records without a month" })}>{unknown}</th>
							<th scope="col" className="px-1 py-1 text-start font-semibold">{t({ code: "dashboard.total", msg: "Total" })}</th>
						</tr>
					</thead>
					{groups.map((g) => {
						const isOpen = !collapsed.has(g.name);
						// A heading only when the cluster holds specific hazards (a lone row names itself).
						const heading = g.rows.length > 1 || g.rows[0].level === "hazard";
						return (
							<tbody key={g.name}>
								{heading && (
									<tr>
										<th scope="colgroup" colSpan={15} className="px-1 pt-2 pb-0.5 text-start">
											<Button onPress={() => toggle(g.name)} aria-expanded={isOpen}
												className={`delta-panel-title inline-flex items-center gap-1 rounded text-xs uppercase tracking-wide ${focusRing}`}>
												<span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
												{g.name}
											</Button>
										</th>
									</tr>
								)}
								{isOpen && g.rows.map((r) => {
									const tot = rowTotal(r);
									return (
										<tr key={r.key}>
											<th scope="row" className="px-1 py-1 ps-3 text-start font-normal whitespace-nowrap">{r.label}</th>
											{r.cells.map((c) => {
												const v = value(c);
												const hover = `${r.label}, ${months[c.month - 1]}: ${n(c.count)} · ${pLabel} ${cellText(ctx, c.people)}${c.rare ? ` · ${rare}` : ""}`;
												return (
													<td key={c.month} title={hover}
														className="h-7 min-w-8 border border-brand-border px-0.5 text-center tabular-nums"
														style={{
															background: shadeFor(v, max),
															// Rare and severe: a dark ring in both modes, so it stays found.
															outline: c.rare ? `2px solid ${DASHBOARD_RAMP[4]}` : undefined,
															outlineOffset: c.rare ? "-2px" : undefined,
														}}>
														{v !== null ? n(v) : ""}
														{c.rare && <span aria-hidden="true" className="ms-0.5">◆</span>}
														{c.rare && <span className="sr-only">{rare}</span>}
													</td>
												);
											})}
											{/* People are not split by month for undated occurrences: the box counts occurrences only. */}
											<td className="h-7 min-w-10 border border-dashed border-brand-border px-0.5 text-center tabular-nums text-brand-text-muted"
												title={`${r.label}, ${unknown}: ${n(unknownMonth(r))}`}>
												{mode === "count" && unknownMonth(r) > 0 ? n(unknownMonth(r)) : ""}
											</td>
											<td className="min-w-24 px-1 py-1">
												<span className="flex items-center gap-1">
													<svg width="60" height="8" aria-hidden="true" focusable="false" className="shrink-0">
														<rect x={0} y={0} width={60} height={8} rx={4} fill={DASHBOARD_RAMP[1]} />
														{tot !== null && tot > 0 && <rect x={0} y={0} width={Math.max(2, (tot / maxTotal) * 60)} height={8} rx={4} fill={DASHBOARD_RAMP[3]} />}
													</svg>
													<span className="tabular-nums">{tot !== null ? n(tot) : cellText(ctx, r.people)}</span>
												</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						);
					})}
				</table>
			</div>
			<p className="m-0 text-xs text-brand-text-muted">
				{t({ code: "dashboard.hazard_month_key", msg: "Blank: none that month, or no figure reported." })}
				{anyRare && ` ${t({ code: "dashboard.rare_key", msg: "◆ ringed: few occurrences with a high toll, by the rule in the method note." })}`}
			</p>
		</ChartFrame>
	);
}

interface Common {
	source: string;
	scope: string;
	provisional: boolean;
}

/** Hazard by month as a dashboard panel, on Disaster impact or Disaster events. */
export function hazardMonthPanel(ctx: ViewContext, d: HazardMonth, id: string, n: number, common: Common): DashboardPanel {
	const title = ctx.t({ code: "dashboard.hazard_by_month", msg: "Hazard by month" });
	const exp = hazardMonthExport(ctx, d);
	return { id, n, title, exportData: exp, render: () => <HazardMonthView ctx={ctx} d={d} title={title} exp={exp} common={common} /> };
}
