// Sectors view, panels 1 to 7 (DELTA_Dashboard_Sectors_Panels.md, section
// 3): disaster-impact records read by level-2 sector. Damage and losses
// never share a cell, axis or total; money stays gap G-06 until the money
// convention (D-04). An unlinked sector reads "No records linked", never a
// zero bar. Sendai Targets C and D codes appear only on the national view
// (TR-060), and every figure is a count DELTA holds, not an indicator value.
import type React from "react";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { SectorGap, SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import { cellRow, cellText, coverageText, emptyViewPanel, panelNotes, type PanelExport } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { RowBars, ShadedTable, type BarSeries } from "../blocks";
import { YearColumns } from "../impact/ImpactTimeline";
import { sendaiNotice } from "../impact/panels5to16";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import { arrangeByLayout, SECTORS_LAYOUT } from "../../layout";

type T = ViewContext["t"];
const tr = (t: T, code: string, msg: string, r?: Record<string, unknown>) => t({ code, msg }, r);
const gapText = (g: SectorGap) => `${g.reason} (${g.code})`;
const gapRow = (label: string, g: SectorGap, series?: string): ChartExportRow => ({
	label,
	series,
	value: null,
	valueState: "not_applicable",
	unit: gapText(g),
});

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

export function sectorDashboardPanels(
	ctx: ViewContext,
	d: SectorPanels1to7,
	opts: { source: string; scope: string; provisional: boolean; country: string },
): DashboardPanel[] {
	const t = ctx.t;
	if (d.empty) {
		return [emptyViewPanel("sectors", tr(t, "dashboard.view_sectors", "Sectors"), tr(t, "dashboard.sectors_empty", d.empty.reason))];
	}
	const m = d.meta;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const noLinked = tr(t, "dashboard.no_records_linked", "No records linked");
	const L = {
		records: tr(t, "dashboard.sec_records", "Records reporting sector damage"),
		damaged: tr(t, "dashboard.houses_damaged", "Houses damaged"),
		destroyed: tr(t, "dashboard.houses_destroyed", "Houses destroyed"),
		losses: tr(t, "dashboard.sec_losses", "Records reporting losses"),
		money: tr(t, "dashboard.sec_money", "Damage and losses in money"),
		physical: tr(t, "dashboard.sec_damage_physical", "Damage (physical)"),
		damageMoney: tr(t, "dashboard.sec_damage_money", "Damage (money)"),
		lossesCol: tr(t, "dashboard.sec_losses_col", "Losses"),
		disruption: tr(t, "dashboard.sec_disruption", "Disruption"),
	};
	const h = d.headline;
	const s = d.sendai;
	const statusText = (st: "COUNT" | "MONEY" | "NOT_HELD") =>
		st === "COUNT"
			? tr(t, "dashboard.status_count", "Count held")
			: st === "MONEY"
				? tr(t, "dashboard.status_money", "Money: not shown (G-06)")
				: tr(t, "dashboard.status_not_held", "Not held");
	const houseSeries: BarSeries[] = [
		{ name: L.destroyed, fill: DASHBOARD_RAMP[4] },
		{ name: L.damaged, fill: DASHBOARD_RAMP[3] },
	];

	const exports: Record<number, PanelExport> = {
		1: {
			rows: [
				cellRow(L.records, h.recordsAnySector),
				{ label: tr(t, "dashboard.sec_linked", "Level-2 sectors with records"), series: tr(t, "dashboard.of_n", "of {n}", { n: h.sectorsLinked.level2Total }), value: h.sectorsLinked.linked, valueState: "reported", unit: "sectors" },
				cellRow(L.damaged, h.dwellingsDamaged),
				cellRow(L.destroyed, h.dwellingsDestroyed),
				cellRow(L.losses, h.losses),
				gapRow(L.money, h.money),
			],
			method: m.headline.method,
			notes: panelNotes(m.headline, [tr(t, "dashboard.damage_losses_apart", "Damage and losses are separate figures and never added.")]),
		},
		2: {
			rows: d.reporting.groups.flatMap((g) => g.rows.map((r) => ({ ...cellRow(r.sector.label, r.records, g.level1.label), unit: "records" }))),
			method: m.reporting.method,
			notes: panelNotes(m.reporting, [tr(t, "dashboard.sec_unlinked", "A sector with no linked record reads ‘No records linked’, not 0.")]),
		},
		3: {
			rows: d.effectTypes.rows.flatMap((r) => [
				cellRow(r.sector.label, r.damagePhysical, L.physical),
				gapRow(r.sector.label, r.damageMoney, L.damageMoney),
				cellRow(r.sector.label, r.losses, L.lossesCol),
				cellRow(r.sector.label, r.disruption, L.disruption),
			]),
			method: m.effectTypes.method,
			notes: panelNotes(m.effectTypes, [tr(t, "dashboard.damage_losses_apart", "Damage and losses are separate figures and never added.")]),
		},
		4: {
			rows: d.hazardBySector.rows.flatMap((r) => r.cells.map((c, i) => ({ ...cellRow(r.label, c, d.hazardBySector.sectors[i]?.label), unit: "records" }))),
			method: m.hazardBySector.method,
			notes: panelNotes(m.hazardBySector, [tr(t, "dashboard.sectors_overlap", "A record can report several sectors, so columns do not add up to records.")]),
		},
		5: {
			rows: d.byYear.series.flatMap((sr) => sr.years.map((y) => ({ ...cellRow(String(y.year), y.records, sr.sector.label), unit: "records" }))),
			method: m.byYear.method,
			notes: panelNotes(m.byYear, [
				d.byYear.recordsWithoutYear > 0
					? tr(t, "dashboard.sec_without_year", "{n} sector-linked records have no start year and are left out.", { n: d.byYear.recordsWithoutYear })
					: undefined,
			]),
		},
		6: {
			rows: d.dwellings.rows.flatMap((r) => [
				{ ...cellRow(r.label, r.destroyed, L.destroyed), unit: "houses" },
				{ ...cellRow(r.label, r.damaged, L.damaged), unit: "houses" },
			]),
			method: m.dwellings.method,
			notes: panelNotes(m.dwellings, [tr(t, "dashboard.houses_inputs", "Dwelling counts are inputs to Sendai B-3 and B-4 and carry no indicator code.")]),
		},
		7: {
			rows: s.rows.map((r) => {
				const label = r.code ? `${r.code} ${r.indicator}` : r.indicator;
				return r.held ? cellRow(label, r.held, r.heldLabel) : { label, series: r.heldLabel, value: null, valueState: "not_applicable" as const, unit: r.gap ? gapText(r.gap) : statusText(r.status) };
			}),
			method: m.sendai.method,
			notes: panelNotes(m.sendai, [
				sendaiNotice(t, opts.country),
				s.nationalOnly ? undefined : tr(t, "dashboard.sec_subnational", "Sub-national view: indicator codes are not shown (TR-060)."),
			]),
		},
	};

	const tile = (label: string, value: React.ReactNode, sub?: React.ReactNode, dashed = false) => (
		<li className={`flex min-w-0 flex-col gap-1 rounded border p-3 ${dashed ? "border-dashed border-brand-border-control bg-brand-surface-subtle" : "border-brand-border bg-brand-surface-card"}`}>
			<span className="text-sm text-brand-text-muted">{label}</span>
			<span className="text-xl font-semibold tabular-nums">{value}</span>
			{sub && <span className="text-xs text-brand-text-muted">{sub}</span>}
		</li>
	);

	const views: Record<number, (c: Common, e: PanelExport) => React.ReactNode> = {
		1: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
					{tile(L.records, cellText(ctx, h.recordsAnySector), coverageText(ctx, h.recordsAnySector))}
					{tile(tr(t, "dashboard.sec_linked", "Level-2 sectors with records"), n(h.sectorsLinked.linked), tr(t, "dashboard.of_n_sectors", "of {n} level-2 sectors", { n: n(h.sectorsLinked.level2Total) }))}
					{tile(L.damaged, cellText(ctx, h.dwellingsDamaged), coverageText(ctx, h.dwellingsDamaged))}
					{tile(L.destroyed, cellText(ctx, h.dwellingsDestroyed), coverageText(ctx, h.dwellingsDestroyed))}
					{tile(L.losses, cellText(ctx, h.losses), coverageText(ctx, h.losses))}
					{tile(L.money, <span className="text-sm">{h.money.reason}</span>, h.money.code, true)}
				</ul>
			</Frame>
		),
		2: (c, e) => (
			<Frame common={c} exp={e}>
				<div className="flex flex-col gap-3">
					{d.reporting.groups.map((g) => (
						<section key={g.level1.sectorId} aria-label={g.level1.label}>
							<h4 className="m-0 mb-1 text-sm font-semibold">{g.level1.label}</h4>
							<RowBars ctx={ctx} label={g.level1.label} notReportedText={noLinked}
								rows={g.rows.map((r) => ({ key: r.sector.sectorId, label: r.sector.label, bars: [{ cell: r.records }] }))} />
						</section>
					))}
				</div>
			</Frame>
		),
		3: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<div className="max-w-full overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">{c.title}</caption>
						<thead>
							<tr>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.sector", "Sector")}</th>
								{[L.physical, L.damageMoney, L.lossesCol, L.disruption].map((x) => (
									<th key={x} scope="col" className={`${th} text-end`}>{x}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{d.effectTypes.rows.map((r) => (
								<tr key={r.sector.sectorId}>
									<th scope="row" className={`${td} text-start font-normal`}>{r.sector.label}</th>
									<td className={`${td} text-end tabular-nums`}>{cellText(ctx, r.damagePhysical)}</td>
									<td className={`${td} text-end text-brand-text-muted`}>{r.damageMoney.code}</td>
									<td className={`${td} text-end tabular-nums`}>{cellText(ctx, r.losses)}</td>
									<td className={`${td} text-end tabular-nums`}>{cellText(ctx, r.disruption)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Frame>
		),
		4: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<ShadedTable ctx={ctx} caption={c.title} rowHeader={tr(t, "dashboard.hazard_type", "Hazard type")}
					columns={d.hazardBySector.sectors.map((x) => x.label)}
					rows={d.hazardBySector.rows.map((r) => ({ key: r.hipTypeId, label: r.label, cells: r.cells }))}
					normalise="table" />
			</Frame>
		),
		5: (c, e) => (
			<Frame common={c} exp={e}>
				<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
					{d.byYear.series.slice(0, 6).map((sr) => (
						<li key={sr.sector.sectorId} className="flex flex-col gap-1">
							<span className="text-sm font-semibold">{sr.sector.label}</span>
							<YearColumns years={sr.years.map((y) => ({ year: y.year, cell: y.records }))} height={90} width={240}
								label={`${sr.sector.label}: ${c.title}`} noDataText={noLinked} />
						</li>
					))}
				</ul>
				{d.byYear.series.length > 6 && (
					<p className="m-0 text-xs text-brand-text-muted">
						{tr(t, "dashboard.sec_more_series", "{n} more sectors are in the data table.", { n: d.byYear.series.length - 6 })}
					</p>
				)}
			</Frame>
		),
		6: (c, e) => (
			<Frame common={c} exp={e}>
				<RowBars ctx={ctx} label={c.title} series={houseSeries}
					rows={d.dwellings.rows.map((r) => ({ key: r.key, label: r.label, bars: [{ series: houseSeries[0], cell: r.destroyed }, { series: houseSeries[1], cell: r.damaged }] }))} />
			</Frame>
		),
		7: (c, e) => (
			<Frame common={c} exp={e} pictures={false}>
				<p role="note" className="m-0 mb-2 border-s-4 border-brand-warning-border bg-brand-warning-background px-3 py-2 text-sm">
					{sendaiNotice(t, opts.country)}
				</p>
				<div className="max-w-full overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">{c.title}</caption>
						<thead>
							<tr>
								{s.nationalOnly && <th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.indicator", "Indicator")}</th>}
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.measure", "Measure")}</th>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.delta_holds", "What DELTA holds")}</th>
								<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.count", "Count")}</th>
							</tr>
						</thead>
						<tbody>
							{s.rows.map((r, i) => (
								<tr key={`${r.code ?? "x"}-${i}`}>
									{s.nationalOnly && <th scope="row" className={`${td} text-start font-semibold`}>{r.code ?? ""}</th>}
									<td className={td}>{r.indicator}</td>
									<td className={td}>{r.heldLabel}</td>
									<td className={`${td} text-end`}>
										{r.held ? (
											<span className="tabular-nums">{cellText(ctx, r.held)}</span>
										) : (
											<span className="text-brand-text-muted">{r.gap ? gapText(r.gap) : statusText(r.status)}</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Frame>
		),
	};

	const titles: Record<number, string> = {
		1: tr(t, "dashboard.sectors_1", "Sectors at a glance"),
		2: tr(t, "dashboard.sectors_2", "Sector ranking by records reporting damage"),
		3: tr(t, "dashboard.sectors_3", "Damage, losses and disruption by sector"),
		4: tr(t, "dashboard.sectors_4", "Hazard by sector"),
		5: tr(t, "dashboard.sectors_5", "Sector damage by year"),
		6: tr(t, "dashboard.sectors_6", "Houses destroyed and damaged"),
		7: tr(t, "dashboard.sectors_7", "Sector inputs to Sendai Targets C and D"),
	};
	const common = (x: string): Common => ({ ctx, title: x, source: opts.source, scope: opts.scope, provisional: opts.provisional });
	return arrangeByLayout(
		[1, 2, 3, 4, 5, 6, 7].map((k): DashboardPanel => ({
			id: `sectors-${k}`,
			n: k,
			title: titles[k],
			exportData: exports[k],
			render: () => views[k](common(titles[k]), exports[k]),
		})),
		SECTORS_LAYOUT,
	);
}
