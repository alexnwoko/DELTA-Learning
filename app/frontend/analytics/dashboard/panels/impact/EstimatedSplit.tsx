// Estimated sex and age split of people affected (Alex, 2026-10-19;
// Analytics' getEstimatedDisaggregation). No disaster record carries a sex
// or age split, so the country's population structure (UN DESA WPP) is
// applied to the reported people affected. These are estimates, never
// reported figures: every bar is hatched and the panel carries an
// "Estimated" tag; the footnote travels in small print and in its own CSV;
// and the panel gives the page CSV nothing, so no estimate is ever summed
// with reported data. Deaths, missing, injured and displaced are refused
// with the reason.
import { Button } from "react-aria-components";
import { saveBlob } from "~/frontend/charts/ChartFrame";
import { PanelIcon, usePanelIcon } from "~/frontend/charts/PanelIcon";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import { SECONDARY_BUTTON_SM } from "~/frontend/buttonStyles";
import type { ViewContext } from "~/frontend/context";
import type { EstimatedCell, EstimatedDisaggregation } from "~/utils/dashboard/estimatedDisaggregation";
import type { DashboardPanel } from "../../types";

const est = (c: EstimatedCell) => (c.state === "estimated" && c.value !== null ? c.value : null);

/** The estimates as their own CSV: an "estimated" column on every row, the footnote last. */
export function estimatedSplitCsv(d: EstimatedDisaggregation, title: string): string {
	const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
	const rows: string[] = ["panel,group,sex,value,state"];
	for (const g of d.groups) {
		for (const [sex, c] of [["female", g.female], ["male", g.male]] as const) {
			rows.push([title, g.group, sex, c.value === null ? "" : String(Math.round(c.value)), c.state].map(q).join(","));
		}
	}
	rows.push("", q(d.footnote), q("Not a basis for targeting."));
	return `﻿${rows.join("\r\n")}\r\n`;
}

function Pyramid({ ctx, d, label }: { ctx: ViewContext; d: EstimatedDisaggregation; label: string }) {
	const n = (x: number) => Math.round(x).toLocaleString(ctx.lang);
	const groups = [...d.groups].reverse(); // oldest on top
	const max = Math.max(1, ...groups.flatMap((g) => [est(g.female) ?? 0, est(g.male) ?? 0]));
	const W = 420;
	const MID = W / 2;
	const LABEL = 44; // the age label sits in the middle
	const ROW = 13;
	const half = MID - LABEL / 2 - 4;
	const H = groups.length * ROW + 18;
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	return (
		<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} fontSize={9} className="block max-w-full">
			<defs>
				{/* Hatching marks every estimated bar (Alex: never read as reported). */}
				<pattern id="est-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
					<rect width="5" height="5" fill={DASHBOARD_RAMP[2]} />
					<line x1="0" y1="0" x2="0" y2="5" stroke={DASHBOARD_RAMP[4]} strokeWidth="1.6" />
				</pattern>
			</defs>
			<text x={MID - LABEL / 2 - 4} y={9} textAnchor="end" fill="currentColor" fontWeight={700}>{t("dashboard.female", "Female")}</text>
			<text x={MID + LABEL / 2 + 4} y={9} fill="currentColor" fontWeight={700}>{t("dashboard.male", "Male")}</text>
			{groups.map((g, i) => {
				const y = 14 + i * ROW;
				const f = est(g.female);
				const m = est(g.male);
				const fw = f === null ? 0 : (f / max) * half;
				const mw = m === null ? 0 : (m / max) * half;
				return (
					<g key={g.group}>
						<text x={MID} y={y + 9} textAnchor="middle" fill="currentColor">{g.group}</text>
						{f !== null && (
							<rect x={MID - LABEL / 2 - fw} y={y + 1} width={fw} height={ROW - 3} fill="url(#est-hatch)">
								<title>{`${g.group}, ${t("dashboard.female", "Female")}: ${n(f)} (${t("dashboard.estimated", "Estimated")})`}</title>
							</rect>
						)}
						{m !== null && (
							<rect x={MID + LABEL / 2} y={y + 1} width={mw} height={ROW - 3} fill="url(#est-hatch)">
								<title>{`${g.group}, ${t("dashboard.male", "Male")}: ${n(m)} (${t("dashboard.estimated", "Estimated")})`}</title>
							</rect>
						)}
					</g>
				);
			})}
		</svg>
	);
}

function EstimatedSplitView({ ctx, d, title }: { ctx: ViewContext; d: EstimatedDisaggregation; title: string }) {
	const icon = usePanelIcon();
	const t = (code: string, msg: string, r?: Record<string, unknown>) => ctx.t({ code, msg }, r);
	const n = (x: number) => Math.round(x).toLocaleString(ctx.lang);
	const ex = d.excluded;
	const excludedTotal = ex.biological + ex.underReview + ex.noYear + ex.before1950 + ex.noReference;
	return (
		<figure aria-label={title} data-print="flow" className="m-0 flex flex-1 flex-col gap-2">
			<div className="flex items-start justify-between gap-2 border-b border-data-dashboard-border pb-2.5">
				<h3 className="delta-panel-title m-0 flex items-center gap-2 text-[1.0625rem]">
					{icon && (
						<span className="delta-panel-iconbox flex h-16 w-16 shrink-0 items-center justify-center rounded-[0.714rem] border">
							<PanelIcon name={icon} size={35} />
						</span>
					)}
					{title}
					{/* The figures are estimates: the tag says so beside the title. */}
					<span className="rounded-full border border-data-dashboard-border bg-data-dashboard-tint px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
						{t("dashboard.estimated", "Estimated")}
					</span>
				</h3>
				{!d.refused && (
					<Button data-print="hide" className={SECONDARY_BUTTON_SM}
						onPress={() => saveBlob(new Blob([estimatedSplitCsv(d, title)], { type: "text/csv;charset=utf-8" }), "delta-estimated-sex-age-split.csv")}>
						{t("dashboard.download_estimates", "Download estimates (CSV)")}
					</Button>
				)}
			</div>
			{d.refused ? (
				<p className="m-0 text-sm">{t("dashboard.estimate_refused", "No estimate for {measure}: {reason}", { measure: d.refused.measure, reason: d.refused.reason })}</p>
			) : (
				<>
					<Pyramid ctx={ctx} d={d} label={title} />
					<ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 text-sm">
						{d.bands.map((b) => {
							const f = est(b.female);
							const m = est(b.male);
							return (
								<li key={b.band} className="delta-panel-tile rounded-[0.714rem] border p-2">
									<span className="delta-panel-title block text-xs">{b.band}</span>
									<span className="block tabular-nums">♀ {f === null ? "—" : n(f)}</span>
									<span className="block tabular-nums">♂ {m === null ? "—" : n(m)}</span>
								</li>
							);
						})}
					</ul>
				</>
			)}
			{/* Small print (Alex, 2026-10-19): the footnote, the basis and what was left out. */}
			<p className="m-0 text-brand-text-muted" style={{ fontSize: "7.5pt", lineHeight: 1.35 }}>
				{d.baseTotal !== null && (
					<span className="block">
						{t("dashboard.estimate_base", "{total} people reported in {records} records, split by the national population structure.", { total: n(d.baseTotal), records: n(d.recordsUsed) })}
					</span>
				)}
				{excludedTotal > 0 && (
					<span className="block">
						{t("dashboard.estimate_excluded", "Left out: {n} records ({under} under review, {noYear} without a year, {early} before 1950, {noRef} with no reference, {bio} biological hazards).", {
							n: n(excludedTotal), under: n(ex.underReview), noYear: n(ex.noYear), early: n(ex.before1950), noRef: n(ex.noReference), bio: n(ex.biological),
						})}
					</span>
				)}
				<span className="block">{d.footnote}</span>
				<span className="block font-bold">{t("dashboard.not_for_targeting", "Not a basis for targeting.")}</span>
				<span className="block">{`${d.reference.source}, ${d.reference.release} (${d.reference.licence}).`}</span>
			</p>
		</figure>
	);
}

/**
 * The estimate panel. It has no exportData on purpose: the page CSV holds
 * reported data only, and estimates download from the panel itself.
 */
export function estimatedSplitPanel(ctx: ViewContext, d: EstimatedDisaggregation): DashboardPanel {
	const title = ctx.t({ code: "dashboard.estimated_split", msg: "Estimated sex and age split" });
	return { id: "impact-estimated", n: 30, title, render: () => <EstimatedSplitView ctx={ctx} d={d} title={title} /> };
}
