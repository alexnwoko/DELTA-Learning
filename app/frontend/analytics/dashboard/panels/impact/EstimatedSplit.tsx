// Estimated sex and age split of people affected (Alex, 2026-10-19;
// Analytics' getEstimatedDisaggregation). No disaster record carries a sex
// or age split, so the country's population structure (UN DESA WPP) is
// applied to the reported people affected. These are estimates, never
// reported figures: every bar is hatched and the panel carries an
// "Estimated" tag; the footnote travels in small print and in its own CSV;
// and the panel gives the page CSV nothing, so no estimate is ever summed
// with reported data. Deaths, missing, injured and displaced are refused
// with the reason.
// Four named models (Alex, 2026-10-22; Analytics edaa715b): DELTA (the
// default), SFM, UN five-year groups and life-stage, picked on the panel.
import { useState } from "react";
import { Button, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { saveBlob } from "~/frontend/charts/ChartFrame";
import { PanelIcon, usePanelIcon } from "~/frontend/charts/PanelIcon";
import { DASHBOARD_RAMP } from "~/frontend/charts/sectionPalette";
import { FOCUS_RING, SECONDARY_BUTTON_SM } from "~/frontend/buttonStyles";
import type { ViewContext } from "~/frontend/context";
import type { EstimatedCell, EstimatedDisaggregation } from "~/utils/dashboard/estimatedDisaggregation";
import type { DisaggregationModelId } from "~/utils/disaggregationModels";
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

type Model = EstimatedDisaggregation["byModel"][number];

/** Short names on the model picker; the full name is in the chart description. */
export const MODEL_SHORT: Record<DisaggregationModelId, [string, string]> = {
	delta: ["dashboard.model_delta", "DELTA"],
	sfm: ["dashboard.model_sfm", "SFM"],
	un: ["dashboard.model_un", "UN"],
	life_stage: ["dashboard.model_life_stage", "Life-stage"],
};

/**
 * One fixed axis per model, the same for every country (Alex, 2026-10-22):
 * each bar is its share of the country's estimated total, so pyramids from
 * different countries compare by shape. Wide bands need a wider axis than
 * five-year groups; a share past the edge is capped and marked.
 */
export const PYRAMID_AXIS_MAX: Record<DisaggregationModelId, number> = { delta: 40, sfm: 40, un: 10, life_stage: 25 };

/** The model a view shows: the one asked for, else the payload's default, else the first. */
export function pickModel(d: EstimatedDisaggregation, id: DisaggregationModelId | null): Model | undefined {
	return d.byModel.find((m) => m.id === id) ?? d.byModel.find((m) => m.id === d.defaultModel) ?? d.byModel[0];
}

/** Each band's share of the model's estimated total, in percent; null where suppressed. */
export function pyramidShares(model: Model): { key: string; label: string; split: boolean; female: number | null; male: number | null }[] {
	const total = model.bands.reduce((sum, b) => sum + (est(b.female) ?? 0) + (est(b.male) ?? 0), 0);
	const pct = (c: EstimatedCell) => {
		const v = est(c);
		return v === null || total <= 0 ? null : (v / total) * 100;
	};
	return model.bands.map((b) => ({ key: b.key, label: b.label, split: b.split, female: pct(b.female), male: pct(b.male) }));
}

function Pyramid({ ctx, model, label }: { ctx: ViewContext; model: Model; label: string }) {
	const pct = (x: number) => `${x.toLocaleString(ctx.lang, { maximumFractionDigits: 1 })}%`;
	const shares = pyramidShares(model).reverse(); // oldest on top
	const max = PYRAMID_AXIS_MAX[model.id];
	const ticks = [max / 4, max / 2, (max * 3) / 4];
	const W = 420;
	const MID = W / 2;
	const LABEL = 44; // the age label sits in the middle
	// Few wide bands get taller rows, so every model fills a similar height.
	const ROW = Math.max(13, Math.min(40, Math.round(273 / Math.max(1, shares.length))));
	const half = MID - LABEL / 2 - 4;
	const TOP = 14;
	const H = TOP + shares.length * ROW + 14;
	const w = (share: number) => (Math.min(share, max) / max) * half;
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const capped = (share: number) => (share > max ? " ▸" : "");
	const axisY = TOP + shares.length * ROW;
	return (
		<svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} fontSize={9} className="block max-w-full">
			<defs>
				{/* Hatching marks every estimated bar (Alex: never read as reported). */}
				<pattern id="est-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
					<rect width="5" height="5" fill={DASHBOARD_RAMP[2]} />
					<line x1="0" y1="0" x2="0" y2="5" stroke={DASHBOARD_RAMP[4]} strokeWidth="1.6" />
				</pattern>
			</defs>
			{/* The model's fixed axis: a quarter, half and three quarters, the edge at the maximum. */}
			{[...ticks, max].map((tick) => (
				<g key={tick}>
					<line x1={MID - LABEL / 2 - w(tick)} x2={MID - LABEL / 2 - w(tick)} y1={TOP} y2={axisY} stroke={DASHBOARD_RAMP[1]} />
					<line x1={MID + LABEL / 2 + w(tick)} x2={MID + LABEL / 2 + w(tick)} y1={TOP} y2={axisY} stroke={DASHBOARD_RAMP[1]} />
					<text x={MID - LABEL / 2 - w(tick)} y={axisY + 10} textAnchor="middle" fill="currentColor">{pct(tick)}</text>
					<text x={MID + LABEL / 2 + w(tick)} y={axisY + 10} textAnchor="middle" fill="currentColor">{pct(tick)}</text>
				</g>
			))}
			<text x={MID - LABEL / 2 - 4} y={9} textAnchor="end" fill="currentColor" fontWeight={700}>{t("dashboard.female", "Female")}</text>
			<text x={MID + LABEL / 2 + 4} y={9} fill="currentColor" fontWeight={700}>{t("dashboard.male", "Male")}</text>
			{shares.map((g, i) => {
				const y = TOP + i * ROW;
				const bar = ROW - 3;
				// A band that takes a share of a five-year group carries a marker (*).
				const mark = g.split ? "*" : "";
				return (
					<g key={g.key}>
						<text x={MID} y={y + bar / 2 + 4} textAnchor="middle" fill="currentColor">{`${g.key}${mark}`}</text>
						{g.female !== null && (
							<rect x={MID - LABEL / 2 - w(g.female)} y={y + 1} width={w(g.female)} height={bar} rx={2} fill="url(#est-hatch)">
								<title>{`${g.label}${mark}, ${t("dashboard.female", "Female")}: ${pct(g.female)} ${t("dashboard.of_total", "of the total")}${capped(g.female)} (${t("dashboard.estimated", "Estimated")})`}</title>
							</rect>
						)}
						{g.male !== null && (
							<rect x={MID + LABEL / 2} y={y + 1} width={w(g.male)} height={bar} rx={2} fill="url(#est-hatch)">
								<title>{`${g.label}${mark}, ${t("dashboard.male", "Male")}: ${pct(g.male)} ${t("dashboard.of_total", "of the total")}${capped(g.male)} (${t("dashboard.estimated", "Estimated")})`}</title>
							</rect>
						)}
						{/* A bar past the axis edge is clamped and says its value at the edge (Analytics, 2026-10-22). */}
						{g.female !== null && g.female > max && (
							<text x={MID - LABEL / 2 - half + 3} y={y + bar / 2 + 4} fill="white" fontWeight={700} stroke={DASHBOARD_RAMP[4]} strokeWidth={2.5} paintOrder="stroke">{`◂ ${pct(g.female)}`}</text>
						)}
						{g.male !== null && g.male > max && (
							<text x={MID + LABEL / 2 + half - 3} y={y + bar / 2 + 4} textAnchor="end" fill="white" fontWeight={700} stroke={DASHBOARD_RAMP[4]} strokeWidth={2.5} paintOrder="stroke">{`${pct(g.male)} ▸`}</text>
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
	const [modelId, setModelId] = useState<DisaggregationModelId | null>(null);
	const model = pickModel(d, modelId);
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
					{model && (
						<>
							{/* The model picker (Alex, 2026-10-22): DELTA by default. */}
							<ToggleButtonGroup
								aria-label={t("dashboard.model", "Model")}
								selectionMode="single"
								disallowEmptySelection
								selectedKeys={[model.id]}
								onSelectionChange={(keys) => setModelId((Array.from(keys)[0] as DisaggregationModelId | undefined) ?? null)}
								className="flex flex-wrap items-center gap-1"
								data-print="hide"
							>
								<span aria-hidden="true" className="me-1 text-xs font-bold text-data-dashboard-ink">{t("dashboard.model", "Model")}:</span>
								{d.byModel.map((m) => (
									<ToggleButton key={m.id} id={m.id} aria-label={m.name}
										className={`min-h-[28px] rounded-lg border border-brand-border-control bg-data-dashboard-surface px-2.5 text-xs font-bold text-brand-interactive data-[hovered]:border-data-dashboard-hover data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive ${FOCUS_RING}`}>
										{t(...MODEL_SHORT[m.id])}
									</ToggleButton>
								))}
							</ToggleButtonGroup>
							{/* The model named in the chart description. */}
							<p className="m-0 text-xs text-brand-text-muted">
								{t("dashboard.model_named", "{name}: {source}.", { name: model.name, source: model.source })}
							</p>
							<Pyramid ctx={ctx} model={model} label={t("dashboard.pyramid_label", "{title}, {model}", { title, model: model.name })} />
							{/* Counts per band, for the models with a few wide bands. */}
							{model.bands.length <= 6 && (
								<ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 text-sm sm:grid-cols-3">
									{model.bands.map((b) => {
										const f = est(b.female);
										const m = est(b.male);
										return (
											<li key={b.key} className="delta-panel-tile rounded-[0.714rem] border p-2">
												<span className="delta-panel-title block text-xs">{b.label}{b.split ? "*" : ""}</span>
												<span className="block tabular-nums">♀ {f === null ? "—" : n(f)}</span>
												<span className="block tabular-nums">♂ {m === null ? "—" : n(m)}</span>
											</li>
										);
									})}
								</ul>
							)}
							{model.bands.some((b) => b.split) && (
								<p className="m-0 text-xs">{`* ${t("dashboard.band_split", "Includes an even share of ages 15-19 (the source gives five-year groups).")}`}</p>
							)}
						</>
					)}
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
