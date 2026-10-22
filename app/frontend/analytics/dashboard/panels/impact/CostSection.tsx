// Disaster cost (Alex, 2026-10-22; Analytics' getCostPanels, 4b91b9ad and
// 183fbf12): its own section in the lower part of Disaster impact, above
// coverage and completeness. A one-line headline, one currency toggle for
// all four charts, then a 2x2 grid: how much is costed, which hazards cost
// most, cost per person affected, and cost over time. The disclaimer
// travels verbatim under the grid with what was left out. Values are
// source-reported, never Sendai C-1. Rounded bars only, never spikes.
// The illustrative projection is hatched, tagged, never added to a total
// and never in the CSV.
import { useState } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { PanelIcon, usePanelIcon } from "~/frontend/charts/PanelIcon";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import { FOCUS_RING } from "~/frontend/buttonStyles";
import type { ViewContext } from "~/frontend/context";
import type { CostPanels, Money } from "~/utils/dashboard/costPanels";
import { cellText } from "../../panelCell";
import type { DashboardPanel } from "../../types";

export type Currency = "local" | "usd";
type T = (code: string, msg: string, r?: Record<string, unknown>) => string;

/** Hazards drawn in the ranked charts (the payload holds at most 15). */
export const COST_TOP = 15;
/** Below this, cost per person shows "too few records" and no bar. */
export const PER_PERSON_MIN = 10;

const pick = (m: Money | null | undefined, cur: Currency): number | null => (m ? m[cur] : null);

/** A money figure in the chosen currency; compact for bars and axes. */
export function formatMoney(lang: string, value: number, cur: Currency, code: string, compact = false): string {
	const opts: Intl.NumberFormatOptions = compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 0 };
	try {
		return new Intl.NumberFormat(lang, { ...opts, style: "currency", currency: cur === "usd" ? "USD" : code, currencyDisplay: "code" }).format(value);
	} catch {
		// A code Intl does not know: the number, then the code.
		return `${new Intl.NumberFormat(lang, opts).format(value)} ${cur === "usd" ? "USD" : code}`;
	}
}

/** Hazards with a total, largest first; hazards with no value last, in payload order. */
export function rankedHazards(d: CostPanels, cur: Currency): CostPanels["byHazard"] {
	return [...d.byHazard]
		.sort((a, b) => (pick(b.total, cur) ?? -1) - (pick(a.total, cur) ?? -1))
		.slice(0, COST_TOP);
}

/** The page CSV: reported totals only, by hazard and by year; never the projection. */
export function costExport(d: CostPanels, cur: Currency): { label: string; series: string; value: number | null; valueState: "reported" | "not_reported" }[] {
	const unit = cur === "usd" ? "USD" : d.currency.code;
	const row = (label: string, series: string, v: number | null) => ({ label, series: `${series} (${unit})`, value: v, valueState: v === null ? ("not_reported" as const) : ("reported" as const) });
	return [
		...rankedHazards(d, cur).map((h) => row(h.label, "Reported cost by hazard", pick(h.total, cur))),
		...d.byYear.map((y) => row(String(y.year), "Reported cost by year", pick(y.total, cur))),
	];
}

const BAR = 12;
const GAP = 5;
const LABEL_W = 150;
const W = 380;

function CostedShare({ ctx, d, t }: { ctx: ViewContext; d: CostPanels; t: T }) {
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const rows = [
		{ key: "records", label: t("dashboard.cost_records", "Records"), ...d.coverage.records },
		{ key: "events", label: t("dashboard.cost_events", "Disaster events"), ...d.coverage.events },
	];
	const span = W - LABEL_W;
	const H = rows.length * (BAR + 18);
	const people = d.peopleMeasure === "affected_direct" ? t("dashboard.people_direct", "people directly affected") : t("dashboard.people_indirect", "people indirectly affected");
	return (
		<>
			<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="block max-w-full" fontSize={10}
				aria-label={t("dashboard.cost_costed_aria", "{costed} of {total} records and {ec} of {et} events have a cost.", { costed: n(d.coverage.records.costed), total: n(d.coverage.records.total), ec: n(d.coverage.events.costed), et: n(d.coverage.events.total) })}>
				{rows.map((r, i) => {
					const y = i * (BAR + 18) + 4;
					const w = r.total > 0 ? (r.costed / r.total) * span : 0;
					return (
						<g key={r.key}>
							<text x={0} y={y + BAR - 2} fill="currentColor" fontWeight={700}>{r.label}</text>
							{r.total > 0 && <path d={roundedBarPath(LABEL_W, y, span, BAR, "right")} fill={DASHBOARD_RAMP[1]} />}
							{w > 0 && <path d={roundedBarPath(LABEL_W, y, w, BAR, "right", w >= span ? 6 : 0)} fill={DASHBOARD_RAMP[3]} />}
							<text x={LABEL_W} y={y + BAR + 11} fill="currentColor">
								{r.total === 0
									? t("dashboard.no_records_in_scope", "No records in scope")
									: t("dashboard.cost_costed_line", "{costed} costed · {not} not costed", { costed: n(r.costed), not: n(r.notCosted) })}
							</text>
						</g>
					);
				})}
			</svg>
			<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs" aria-label={t("dashboard.cost_legend", "Legend")}>
				<li className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DASHBOARD_RAMP[3] }} />{t("dashboard.cost_costed", "Costed")}</li>
				<li className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DASHBOARD_RAMP[1] }} />{t("dashboard.cost_not_costed", "Not costed")}</li>
			</ul>
			<p className="m-0 text-sm">
				{t("dashboard.cost_people", "{people}: {costed} in costed records, {not} in records with no cost.", {
					people: people.charAt(0).toUpperCase() + people.slice(1),
					costed: cellText(ctx, d.coverage.people.costed),
					not: cellText(ctx, d.coverage.people.notCosted),
				})}
			</p>
		</>
	);
}

/** Horizontal rounded bars by hazard; a row with no value says why in words. */
function HazardBars({ label, rows, fmt }: {
	label: string;
	rows: { key: string; label: string; value: number | null; note: string; empty: string }[];
	fmt: (v: number) => string;
}) {
	const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
	const span = W - LABEL_W - 70;
	const ROW = BAR + GAP + 10;
	const H = Math.max(ROW, rows.length * ROW);
	return (
		<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="block max-w-full" fontSize={10}>
			{rows.map((r, i) => {
				const y = i * ROW;
				const w = r.value !== null && max > 0 ? Math.max(2, (r.value / max) * span) : 0;
				return (
					<g key={r.key}>
						<title>{`${r.label}: ${r.value === null ? r.empty : fmt(r.value)} (${r.note})`}</title>
						<text x={0} y={y + BAR - 2} fill="currentColor">{r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label}</text>
						{r.value !== null ? (
							<>
								<path d={roundedBarPath(LABEL_W, y, w, BAR, "right")} fill={DASHBOARD_RAMP[3]} />
								<text x={LABEL_W + w + 4} y={y + BAR - 2} fill="currentColor" fontWeight={700}>{fmt(r.value)}</text>
							</>
						) : (
							<text x={LABEL_W} y={y + BAR - 2} fill="currentColor" fontStyle="italic">{r.empty}</text>
						)}
						<text x={LABEL_W} y={y + BAR + 9} fill="currentColor" opacity={0.75} fontSize={8.5}>{r.note}</text>
					</g>
				);
			})}
		</svg>
	);
}

function CostOverTime({ ctx, d, cur, t, fmt }: { ctx: ViewContext; d: CostPanels; cur: Currency; t: T; fmt: (v: number) => string }) {
	const years = d.byYear;
	const max = Math.max(0, ...years.map((y) => pick(y.total, cur) ?? 0));
	const LEFT = 52;
	const TOP = 6;
	const PLOT = 130;
	const STRIP = 8;
	const H = TOP + PLOT + 6 + STRIP + 18;
	const step = (W - LEFT) / Math.max(1, years.length);
	const barW = Math.max(2, Math.min(18, step * 0.7));
	const every = Math.max(1, Math.ceil(years.length / 8));
	const ticks = max > 0 ? [0.5, 1].map((f) => f * max) : [];
	return (
		<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="block max-w-full" fontSize={9}
			aria-label={t("dashboard.cost_time_aria", "Reported cost per year from {from} to {to}; years with no value are gaps.", { from: years[0]?.year, to: years[years.length - 1]?.year })}>
			{ticks.map((v) => {
				const y = TOP + PLOT - (v / max) * PLOT;
				return (
					<g key={v}>
						<line x1={LEFT} x2={W} y1={y} y2={y} stroke={DASHBOARD_RAMP[1]} />
						<text x={LEFT - 4} y={y + 3} textAnchor="end" fill="currentColor">{fmt(v)}</text>
					</g>
				);
			})}
			<line x1={LEFT} x2={W} y1={TOP + PLOT} y2={TOP + PLOT} stroke={DASHBOARD_RAMP[2]} />
			{years.map((y, i) => {
				const v = pick(y.total, cur);
				const x = LEFT + i * step + (step - barW) / 2;
				const h = v !== null && max > 0 ? Math.max(1.5, (v / max) * PLOT) : 0;
				const share = y.records > 0 ? y.costedRecords / y.records : null;
				const shareText = share === null ? t("dashboard.cost_no_records_year", "no records") : `${Math.round(share * 100)}%`;
				return (
					<g key={y.year}>
						<title>{`${y.year}: ${v === null ? t("dashboard.cost_no_value", "No value recorded") : fmt(v)} · ${t("dashboard.cost_share_title", "{c} of {n} records costed", { c: y.costedRecords.toLocaleString(ctx.lang), n: y.records.toLocaleString(ctx.lang) })} (${shareText})`}</title>
						{h > 0 && <path d={roundedBarPath(x, TOP + PLOT - h, barW, h, "up", 3)} fill={DASHBOARD_RAMP[3]} />}
						{/* The costed share: a thin strip, darker where more records carry a value. */}
						<rect x={LEFT + i * step + 0.5} y={TOP + PLOT + 6} width={Math.max(1, step - 1)} height={STRIP} rx={2}
							fill={share === null ? "none" : DASHBOARD_RAMP[share >= 0.66 ? 4 : share >= 0.33 ? 3 : share > 0 ? 2 : 1]}
							stroke={share === null ? DASHBOARD_RAMP[1] : "none"} />
						{i % every === 0 && <text x={LEFT + i * step + step / 2} y={H - 2} textAnchor="middle" fill="currentColor">{y.year}</text>}
					</g>
				);
			})}
			<text x={LEFT - 4} y={TOP + PLOT + 6 + STRIP - 1} textAnchor="end" fill="currentColor" fontSize={8}>{t("dashboard.cost_share_label", "costed")}</text>
		</svg>
	);
}

function Quarter({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="delta-panel-tile flex min-w-0 flex-col gap-2 rounded-[0.714rem] border p-3">
			<h4 className="delta-panel-title m-0 text-[0.9375rem]">{title}</h4>
			{children}
		</section>
	);
}

function CostSectionView({ ctx, d, title, provisional }: { ctx: ViewContext; d: CostPanels; title: string; provisional: boolean }) {
	const icon = usePanelIcon();
	const t: T = (code, msg, r) => ctx.t({ code, msg }, r);
	const [cur, setCur] = useState<Currency>("local");
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const fmt = (v: number) => formatMoney(ctx.lang, v, cur, d.currency.code, true);
	const total = pick(d.total, cur);
	const empty = d.coverage.records.costed === 0 || total === null;
	const ex = d.excluded;
	const leftOut = [
		ex.beforeCurrencyChange > 0 && t("dashboard.cost_ex_currency", "{n} dated before the change of currency unit", { n: n(ex.beforeCurrencyChange) }),
		ex.copiedFromUsd > 0 && t("dashboard.cost_ex_copied", "{n} with a local value copied from the US dollar value", { n: n(ex.copiedFromUsd) }),
		ex.noRate > 0 && t("dashboard.cost_ex_rate", "{n} with no exchange rate for the year", { n: n(ex.noRate) }),
	].filter((x): x is string => Boolean(x));
	const hazards = rankedHazards(d, cur);
	const perPerson = [...d.byHazard]
		.sort((a, b) => (b.medianPerPerson.records >= PER_PERSON_MIN ? pick(b.medianPerPerson, cur) ?? -1 : -2) - (a.medianPerPerson.records >= PER_PERSON_MIN ? pick(a.medianPerPerson, cur) ?? -1 : -2))
		.slice(0, COST_TOP);
	const projections = perPerson.filter((h) => pick(h.projectionNotCosted, cur) !== null).slice(0, 5);
	const firstYear = d.byYear[0]?.year;

	return (
		<figure aria-label={title} data-print="flow" className="m-0 flex flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-start justify-between gap-2 border-b border-data-dashboard-border pb-2.5">
				<h3 className="delta-panel-title m-0 flex items-center gap-2 text-[1.0625rem]">
					{icon && (
						<span className="delta-panel-iconbox flex h-16 w-16 shrink-0 items-center justify-center rounded-[0.714rem] border">
							<PanelIcon name={icon} size={35} />
						</span>
					)}
					{title}
				</h3>
				{!empty && (
					<ToggleButtonGroup
						aria-label={t("dashboard.cost_currency", "Currency")}
						selectionMode="single"
						disallowEmptySelection
						selectedKeys={[cur]}
						onSelectionChange={(keys) => {
							const k = Array.from(keys)[0];
							if (k === "local" || k === "usd") setCur(k);
						}}
						className="flex gap-1"
						data-print="hide"
					>
						{([["local", `${d.currency.name} (${d.currency.code})`], ["usd", t("dashboard.us_dollars", "US dollars")]] as const).map(([id, label]) => (
							<ToggleButton key={id} id={id}
								className={`min-h-[32px] rounded-lg border border-brand-border-control bg-data-dashboard-surface px-3 text-sm font-bold text-brand-interactive data-[hovered]:border-data-dashboard-hover data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive ${FOCUS_RING}`}>
								{label}
							</ToggleButton>
						))}
					</ToggleButtonGroup>
				)}
			</div>

			{empty ? (
				// No costed record: one calm line, never a row of zeros (TR-076).
				<div className="flex flex-col gap-1 rounded-[0.714rem] border border-dashed border-data-dashboard-border p-4 text-sm">
					<p className="m-0 font-bold">{t("dashboard.cost_empty", "No record in scope carries a cost value yet.")}</p>
					<p className="m-0 text-brand-text-muted">
						{d.coverage.records.total > 0
							? t("dashboard.cost_empty_records", "{n} records are in scope; none of them reports a value.", { n: n(d.coverage.records.total) })
							: t("dashboard.no_records_in_scope", "No records in scope")}
						{!provisional && ` ${t("dashboard.cost_empty_published", "Only published records count here; drafts and records under review appear once they are published.")}`}
					</p>
				</div>
			) : (
				<>
					<p className="m-0 text-base">
						{t("dashboard.cost_headline", "Reported cost: {total} from {costed} of {records} records", {
							total: formatMoney(ctx.lang, total, cur, d.currency.code),
							costed: n(d.coverage.records.costed),
							records: n(d.coverage.records.total),
						})}
					</p>
					{cur === "usd" && (
						<p className="m-0 text-xs text-brand-text-muted">
							{d.fxRate.release
								? t("dashboard.cost_rate_release", "{label}, {source} release of {release}.", { label: d.fxRate.label, source: d.fxRate.source, release: d.fxRate.release })
								: t("dashboard.cost_rate", "{label} ({source}).", { label: d.fxRate.label, source: d.fxRate.source })}
						</p>
					)}
					<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
						<Quarter title={t("dashboard.cost_q1", "How much is costed")}>
							<p className="m-0 w-fit rounded-full border border-data-dashboard-border bg-data-dashboard-tint px-2 py-0.5 text-xs font-bold">
								{t("dashboard.cost_q1_tag", "{not} of {total} records ({events} events) have no cost recorded.", {
									not: n(d.coverage.records.notCosted), total: n(d.coverage.records.total), events: n(d.coverage.events.notCosted),
								})}
							</p>
							<CostedShare ctx={ctx} d={d} t={t} />
						</Quarter>
						<Quarter title={t("dashboard.cost_q2", "Which hazards cost most")}>
							<HazardBars
								label={t("dashboard.cost_q2", "Which hazards cost most")}
								fmt={fmt}
								rows={hazards.map((h) => ({
									key: h.key,
									label: h.label,
									value: pick(h.total, cur),
									note: t("dashboard.cost_n_records", "n = {n} costed records", { n: n(h.costedRecords) }),
									empty: t("dashboard.cost_no_value", "No value recorded"),
								}))}
							/>
						</Quarter>
						<Quarter title={t("dashboard.cost_q3", "Cost per person affected, by hazard")}>
							<HazardBars
								label={t("dashboard.cost_q3", "Cost per person affected, by hazard")}
								fmt={(v) => formatMoney(ctx.lang, v, cur, d.currency.code, true)}
								rows={perPerson.map((h) => {
									const few = h.medianPerPerson.records < PER_PERSON_MIN;
									return {
										key: h.key,
										label: h.label,
										value: few ? null : pick(h.medianPerPerson, cur),
										note: t("dashboard.cost_median_n", "median over {n} records", { n: n(h.medianPerPerson.records) }),
										empty: few ? t("dashboard.too_few_records", "too few records") : t("dashboard.cost_no_value", "No value recorded"),
									};
								})}
							/>
							{projections.length > 0 && (
								<div className="flex flex-col gap-1 border-t border-data-dashboard-border pt-2 text-xs">
									<span className="flex items-center gap-2 font-bold">
										<svg width="14" height="10" aria-hidden="true">
											<defs>
												<pattern id="cost-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
													<rect width="4" height="4" fill={DASHBOARD_RAMP[1]} />
													<line x1="0" y1="0" x2="0" y2="4" stroke={DASHBOARD_RAMP[3]} strokeWidth="1.4" />
												</pattern>
											</defs>
											<rect width="14" height="10" rx="2" fill="url(#cost-hatch)" />
										</svg>
										{t("dashboard.cost_illustrative", "Illustrative, not a loss estimate")}
									</span>
									<ul className="m-0 list-none p-0">
										{projections.map((h) => (
											<li key={h.key}>
												{t("dashboard.cost_projection_row", "{hazard}: about {value} for records with no value", { hazard: h.label, value: fmt(pick(h.projectionNotCosted, cur) as number) })}
											</li>
										))}
									</ul>
									<span className="text-brand-text-muted">{d.projectionNote}</span>
								</div>
							)}
						</Quarter>
						<Quarter title={t("dashboard.cost_q4", "Cost over time")}>
							{d.byYear.length > 0 ? (
								<>
									<CostOverTime ctx={ctx} d={d} cur={cur} t={t} fmt={fmt} />
									{firstYear !== undefined && (d.recordsBeforeFirstYear > 0 || d.recordsNoYear > 0) && (
										<p className="m-0 text-xs text-brand-text-muted">
											{t("dashboard.cost_time_note", "{before} records before {first} and {noYear} with no year carry no value on this chart.", { before: n(d.recordsBeforeFirstYear), first: firstYear, noYear: n(d.recordsNoYear) })}
										</p>
									)}
								</>
							) : (
								<p className="m-0 text-sm">{t("dashboard.cost_no_years", "No dated record carries a value.")}</p>
							)}
						</Quarter>
					</div>
				</>
			)}

			{/* Small print: the disclaimer verbatim, what was left out, and the method. */}
			<p className="m-0 text-brand-text-muted" style={{ fontSize: "7.5pt", lineHeight: 1.35 }}>
				<span className="block">{d.disclaimer}</span>
				{leftOut.length > 0 && <span className="block">{t("dashboard.cost_left_out", "Left out: {list}.", { list: leftOut.join("; ") })}</span>}
				<span className="block">{d.meta.method}</span>
				{d.meta.notApplied.map((f) => <span key={f} className="block">{t("dashboard.not_applied", "Not applied: {f}", { f })}</span>)}
			</p>
		</figure>
	);
}

/** The Disaster cost section: one full-width panel, placed above coverage and completeness. */
export function costSectionPanel(ctx: ViewContext, d: CostPanels, provisional: boolean): DashboardPanel {
	const title = ctx.t({ code: "dashboard.disaster_cost", msg: "Disaster cost" });
	return {
		id: "impact-cost",
		n: 31,
		title,
		wide: true,
		// The page CSV carries reported totals in the country's currency; never the projection.
		exportData: { rows: costExport(d, "local"), method: d.meta.method, notes: [d.disclaimer, ...(d.meta.coverage ? [d.meta.coverage] : [])] },
		render: () => <CostSectionView ctx={ctx} d={d} title={title} provisional={provisional} />,
	};
}
