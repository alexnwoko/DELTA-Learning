// Hazard by month (Alex, 2026-10-19): every HIPs cluster by calendar
// month, years pooled, on Disaster impact (records) and Disaster events
// (events). One switch moves every box between the number of occurrences
// and the people affected, so a month where few occurrences carry a high
// toll stands out: the rare severe outliers, a lead toward cascades and an
// anticipatory action window. The "rare" flag is the server's rule
// (Analytics, meta.method). An empty month is blank, never 0, and a month
// whose occurrences report no people figure says so on hover.
import { useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import type { ViewContext } from "~/frontend/context";
import type { HazardMonth } from "~/utils/dashboard/hazardMonth";
import { cellRow, cellText, panelNotes, type PanelExport } from "../panelCell";
import type { DashboardPanel } from "../types";
import { shadeFor } from "./blocks";
import { effectLabel } from "./impact/panels5to16";

type Mode = "count" | "people";

const focusRing =
	"data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";

function monthNames(lang: string): string[] {
	return Array.from({ length: 12 }, (_, i) =>
		new Date(Date.UTC(2000, i, 1)).toLocaleString(lang, { month: "short", timeZone: "UTC" }),
	);
}

const peopleValue = (c: HazardMonth["rows"][number]["cells"][number]) =>
	c.people.valueState === "reported" && c.people.value !== null && c.people.value > 0 ? c.people.value : null;

/** The panel's rows and notes, for its frame and the page CSV: both counts, every month. */
export function hazardMonthExport(ctx: ViewContext, d: HazardMonth): PanelExport {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const months = monthNames(ctx.lang);
	const occ = d.unit === "disaster_event" ? t({ code: "dashboard.events", msg: "Disaster events" }) : t({ code: "dashboard.records", msg: "Records" });
	const measure = effectLabel(t, d.measure as never);
	// Months with no occurrence stay out, so the table never shows a 0 month.
	const rows: ChartExportRow[] = d.rows.flatMap((r) =>
		r.cells.filter((c) => c.count > 0).flatMap((c) => [
			{ label: `${r.label}, ${months[c.month - 1]}`, series: occ, value: c.count, valueState: "reported" as const, unit: occ.toLowerCase() },
			{ ...cellRow(`${r.label}, ${months[c.month - 1]}`, c.people, measure), unit: c.rare ? t({ code: "dashboard.rare_flag", msg: "rare and severe" }) : undefined },
		]),
	);
	return {
		rows,
		method: d.meta.method,
		notes: panelNotes(d.meta, [
			d.years ? t({ code: "dashboard.years_pooled", msg: "{from} to {to}, all years together." }, { from: d.years.from, to: d.years.to }) : undefined,
			d.withoutMonth > 0 ? t({ code: "dashboard.without_month", msg: "{n} have no start month and are left out." }, { n: n(d.withoutMonth) }) : undefined,
			d.placeholderDates > 0
				? t({ code: "dashboard.placeholder_dates", msg: "{n} sit on a placeholder date and are left out, not counted in any month." }, { n: n(d.placeholderDates) })
				: undefined,
		]),
	};
}

function HazardMonthView({ ctx, d, title, exp, common }: { ctx: ViewContext; d: HazardMonth; title: string; exp: PanelExport; common: Common }) {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const [mode, setMode] = useState<Mode>("count");
	const months = monthNames(ctx.lang);
	const occLabel = d.unit === "disaster_event" ? t({ code: "dashboard.mode_events", msg: "Number of events" }) : t({ code: "dashboard.mode_records", msg: "Number of records" });
	// The switch names people plainly (Alex, 2026-10-19: directly affected by default).
	const peopleLabel =
		d.measure === "affected_direct"
			? t({ code: "dashboard.people_directly_affected", msg: "People directly affected" })
			: effectLabel(t, d.measure as never);
	const rows = [...d.rows].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
	const value = (c: HazardMonth["rows"][number]["cells"][number]) => (mode === "count" ? (c.count > 0 ? c.count : null) : peopleValue(c));
	const max = Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => value(c) ?? 0)));
	const anyRare = rows.some((r) => r.cells.some((c) => c.rare));
	return (
		<ChartFrame ctx={ctx} title={title} rows={exp.rows}
			meta={{ source: common.source, scope: common.scope, method: exp.method, basis: common.provisional ? "provisional" : "published", notes: exp.notes }}>
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
				{([["count", occLabel], ["people", peopleLabel]] as const).map(([id, label]) => (
					<ToggleButton key={id} id={id}
						className={`rounded-full border border-brand-border-control bg-brand-surface px-3 py-0.5 text-sm data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive ${focusRing}`}>
						{label}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
			<div className="max-w-full overflow-x-auto">
				<table className="border-collapse text-xs">
					<caption className="sr-only">{`${title}: ${mode === "count" ? occLabel : peopleLabel}`}</caption>
					<thead>
						<tr>
							<th scope="col" className="px-1 py-1 text-start">{t({ code: "dashboard.hazard", msg: "Hazard" })}</th>
							{months.map((m) => <th key={m} scope="col" className="px-1 py-1 text-center font-semibold">{m}</th>)}
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.hipClusterId}>
								<th scope="row" className="px-1 py-1 text-start font-normal whitespace-nowrap">{r.label}</th>
								{r.cells.map((c) => {
									const v = value(c);
									const hover = `${r.label}, ${months[c.month - 1]}: ${n(c.count)} · ${peopleLabel} ${cellText(ctx, c.people)}${c.rare ? ` · ${t({ code: "dashboard.rare_flag", msg: "rare and severe" })}` : ""}`;
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
											{c.rare && <span className="sr-only">{t({ code: "dashboard.rare_flag", msg: "rare and severe" })}</span>}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
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
