// The Sendai Framework Monitoring section (DELTA_Analytics_SFM_Requirements
// v0.1, sections 4.2, 4.3 and 6.2; Analytics' mockup Analytics_SFM_Layout).
// Nine fixed slots in target rows, the same on every view: S0 counts table
// (full width), then two slots each for Targets A, B, C and D. A slot with
// no data keeps its place and shows its gap; nothing reflows (FR-AN-025,
// FR-AN-031). Under a place filter no figure carries an indicator code
// (TR-060, FR-AN-009). Figures are Sendai-aligned counts from national
// records, never the country's official SFM submission (FR-AN-026).
import type React from "react";
import { useState } from "react";
import { ToggleButton } from "react-aria-components";
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import { SECTION_ICONS, TARGET_ICONS, panelIcon } from "~/frontend/charts/dashboardIcons";
import { PanelIcon, PanelIconContext } from "~/frontend/charts/PanelIcon";
import type { ChartExportRow } from "~/frontend/charts/chartExport";
import { roundedBarPath } from "~/frontend/charts/roundedBar";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type { SendaiGap, SendaiSection as SendaiPayload } from "~/utils/dashboard/sendaiPanels";
import { dataTokens } from "~/utils/designTokens.generated";
import { STATE_ENCODING } from "~/utils/mapState";
import { cellRow, cellText, coverageText, noRecordsText, panelNotes, type PanelExport } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { ShadedTable } from "../blocks";
import { sendaiNotice, subnationalNote } from "../impact/panels5to16";

type T = ViewContext["t"];
const tr = (t: T, code: string, msg: string, r?: Record<string, unknown>) => t({ code, msg }, r);

const known = (c: PanelCell) => c.valueState === "reported" || c.valueState === "zero_confirmed";
const val = (c: PanelCell) => (known(c) ? c.value : null);
const gapText = (g: SendaiGap) => `${g.reason} (${g.code})`;
const stateWord = (c: PanelCell) => (c.valueState === "reported" ? "Reported" : STATE_ENCODING[c.valueState].label);

interface Common {
	ctx: ViewContext;
	title: string;
	source: string;
	scope: string;
	provisional: boolean;
	/** The Sendai notice, kept in downloads and out of each caption. */
	notice: string;
}

function Frame({ common, exp, pictures = true, children }: { common: Common; exp: PanelExport; pictures?: boolean; children: React.ReactNode }) {
	return (
		<ChartFrame
			ctx={common.ctx}
			title={common.title}
			rows={exp.rows}
			pictures={pictures}
			// The section header states the notice once on screen (FR-AN-026);
			// every download still carries it.
			quietNotes={[common.notice]}
			meta={{ source: common.source, scope: common.scope, method: exp.method, basis: common.provisional ? "provisional" : "published", notes: exp.notes }}
		>
			{children}
		</ChartFrame>
	);
}

/** The target codes a slot speaks to, as tags under its title; none under a place filter. */
function Tags({ codes }: { codes: string[] }) {
	if (codes.length === 0) return null;
	return (
		<span className="flex flex-wrap gap-1">
			{codes.map((c) => (
				<span key={c} className="rounded bg-brand-surface-subtle px-1.5 text-xs font-semibold text-brand-text">
					{c}
				</span>
			))}
		</span>
	);
}

const th = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 font-semibold";
const td = "border-b border-brand-border px-2 py-1";

// ---------------------------------------------------------------------------
// Grouped columns per year (A1, B2): two series side by side, never added.

function PairedColumns({
	ctx,
	label,
	rows,
	series,
	reference,
}: {
	ctx: ViewContext;
	label: string;
	rows: { year: number; cells: [PanelCell, PanelCell] }[];
	series: [{ name: string; fill: string }, { name: string; fill: string }];
	reference?: { value: number; text: string } | null;
}) {
	const W = 480;
	const H = 190;
	const top = 18;
	const base = H - 18;
	const plot = base - top;
	const max = Math.max(1, reference?.value ?? 0, ...rows.flatMap((r) => r.cells.map((c) => val(c) ?? 0)));
	const slot = Math.min(48, W / Math.max(1, rows.length));
	const offset = (W - slot * rows.length) / 2;
	const bar = Math.max(2, (slot * 0.8) / 2);
	const nr = STATE_ENCODING.not_reported;
	const y = (v: number) => base - (v / max) * plot;
	const tickEvery = rows.length > 12 ? Math.ceil(rows.length / 8) : 1;
	return (
		<div className="flex flex-col gap-1">
			<ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-sm">
				{series.map((s) => (
					<li key={s.name} className="flex items-center gap-1">
						<span aria-hidden="true" className="inline-block h-3 w-3" style={{ background: s.fill }} />
						{s.name}
					</li>
				))}
				{reference && (
					<li className="flex items-center gap-1">
						<svg width={16} height={6} aria-hidden="true"><line x1={0} x2={16} y1={3} y2={3} stroke={dataTokens.chart.axis} strokeDasharray="4 3" strokeWidth={2} /></svg>
						{reference.text}
					</li>
				)}
			</ul>
			<svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} fontSize={10} className="block max-w-full">
				<line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke={dataTokens.chart.axis} />
				{rows.map((r, i) => {
					const x0 = offset + i * slot + slot * 0.1;
					return (
						<g key={r.year}>
							{r.cells.map((c, k) => {
								const x = x0 + k * bar;
								const v = val(c);
								if (v !== null && v > 0) {
									return <path key={k} d={roundedBarPath(x, y(v), bar - 1, base - y(v), "up", 3)} fill={series[k].fill}><title>{`${r.year} ${series[k].name}: ${cellText(ctx, c)}`}</title></path>;
								}
								if (c.valueState === "zero_confirmed") {
									return <rect key={k} x={x} y={base - 2} width={bar - 1} height={2} fill="#fff" stroke={STATE_ENCODING.zero_confirmed.stroke} />;
								}
								// Not reported: an outlined empty slot, never a drop to 0 (W-7).
								return (
									<rect key={k} x={x + 0.5} y={top} width={bar - 2} height={plot} fill="none" stroke={nr.stroke} strokeDasharray="2 2">
										<title>{`${r.year} ${series[k].name}: ${cellText(ctx, c)}`}</title>
									</rect>
								);
							})}
							{i % tickEvery === 0 && (
								<text x={offset + i * slot + slot / 2} y={H - 4} textAnchor="middle" fill="currentColor">
									{r.year}
								</text>
							)}
						</g>
					);
				})}
				{reference && (
					<line x1={0} x2={W} y1={y(reference.value)} y2={y(reference.value)} stroke={dataTokens.chart.axis} strokeDasharray="4 3" strokeWidth={1.5} />
				)}
			</svg>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Line with gaps (B1): the line breaks at a year no record reported.

function GapLine({ ctx, label, points }: { ctx: ViewContext; label: string; points: { year: number; cell: PanelCell }[] }) {
	const W = 480;
	const H = 170;
	const top = 12;
	const base = H - 18;
	const max = Math.max(1, ...points.map((p) => val(p.cell) ?? 0));
	const step = points.length > 1 ? W / (points.length - 1) : W;
	const x = (i: number) => (points.length > 1 ? i * step : W / 2);
	const y = (v: number) => base - (v / max) * (base - top);
	const segments: string[] = [];
	let current: string[] = [];
	points.forEach((p, i) => {
		const v = val(p.cell);
		if (v === null) {
			if (current.length) segments.push(current.join(" "));
			current = [];
		} else current.push(`${x(i)},${y(v)}`);
	});
	if (current.length) segments.push(current.join(" "));
	const ink = dataTokens.ramp.people[4];
	const tickEvery = points.length > 12 ? Math.ceil(points.length / 8) : 1;
	return (
		<svg viewBox={`-8 0 ${W + 16} ${H}`} width="100%" height={H} role="img" aria-label={label} fontSize={10} className="block max-w-full">
			<line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke={dataTokens.chart.axis} />
			{segments.map((pts, i) => (
				<polyline key={i} points={pts} fill="none" stroke={ink} strokeWidth={2} />
			))}
			{points.map((p, i) => {
				const v = val(p.cell);
				return (
					<g key={p.year}>
						{v !== null ? (
							<circle cx={x(i)} cy={y(v)} r={3} fill={ink}><title>{`${p.year}: ${cellText(ctx, p.cell)}`}</title></circle>
						) : (
							<line x1={x(i)} x2={x(i)} y1={top} y2={base} stroke={STATE_ENCODING.not_reported.stroke} strokeDasharray="2 3"><title>{`${p.year}: ${cellText(ctx, p.cell)}`}</title></line>
						)}
						{i % tickEvery === 0 && (
							<text x={x(i)} y={H - 4} textAnchor="middle" fill="currentColor">{p.year}</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}

// ---------------------------------------------------------------------------
// Paired dots per hazard type (A2): deaths filled, missing hollow, one axis.

function PairedDots({ ctx, rows, names }: { ctx: ViewContext; rows: { key: string; label: string; a: PanelCell; b: PanelCell }[]; names: [string, string] }) {
	const W = 380;
	const L = 150;
	const ROW = 26;
	const max = Math.max(1, ...rows.flatMap((r) => [val(r.a) ?? 0, val(r.b) ?? 0]));
	const x = (v: number) => L + (v / max) * (W - L - 16);
	const ink = dataTokens.ramp.people[4];
	return (
		<div className="flex flex-col gap-1">
			<ul className="m-0 flex list-none gap-3 p-0 text-sm">
				<li className="flex items-center gap-1"><svg width={12} height={12} aria-hidden="true"><circle cx={6} cy={6} r={5} fill={ink} /></svg>{names[0]}</li>
				<li className="flex items-center gap-1"><svg width={12} height={12} aria-hidden="true"><circle cx={6} cy={6} r={4.5} fill="#fff" stroke={ink} strokeWidth={2} /></svg>{names[1]}</li>
			</ul>
			<svg viewBox={`0 0 ${W} ${rows.length * ROW + 4}`} width="100%" height={rows.length * ROW + 4} preserveAspectRatio="xMinYMin meet" role="img"
				aria-label={rows.map((r) => `${r.label}: ${names[0]} ${cellText(ctx, r.a)}, ${names[1]} ${cellText(ctx, r.b)}`).join("; ")} fontSize={11} className="block max-w-full">
				{rows.map((r, i) => {
					const cy = i * ROW + 14;
					const a = val(r.a);
					const b = val(r.b);
					return (
						<g key={r.key}>
							<text x={0} y={cy + 4} fill="currentColor">{r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}<title>{r.label}</title></text>
							<line x1={L} x2={W - 16} y1={cy} y2={cy} stroke={dataTokens.chart.axis} strokeOpacity={0.25} />
							{a !== null && <circle cx={x(a)} cy={cy} r={5} fill={ink}><title>{`${names[0]}: ${cellText(ctx, r.a)}`}</title></circle>}
							{b !== null && <circle cx={x(b)} cy={cy} r={4.5} fill="#fff" stroke={ink} strokeWidth={2}><title>{`${names[1]}: ${cellText(ctx, r.b)}`}</title></circle>}
							{a === null && b === null && <text x={L} y={cy + 4} fill="currentColor" fontStyle="italic" fontSize={10}>{cellText(ctx, r.a)}</text>}
						</g>
					);
				})}
			</svg>
		</div>
	);
}

// ---------------------------------------------------------------------------
// The nine slots.

export interface SendaiOptions {
	source: string;
	scope: string;
	country: string;
}

export function sendaiSectionPanels(ctx: ViewContext, d: SendaiPayload, opts: SendaiOptions): DashboardPanel[] {
	const t = ctx.t;
	const national = d.nationalOnly;
	const codes = (list: string[]) => (national ? list : []);
	const common = (title: string): Common => ({
		ctx,
		title,
		source: opts.source,
		scope: opts.scope,
		provisional: d.provisional,
		notice: sendaiNotice(t, opts.country),
	});
	const notes = (m: PanelMeta, own: (string | undefined)[] = []) =>
		panelNotes(m, [sendaiNotice(t, opts.country), national ? undefined : subnationalNote(t), ...own]);
	const L = {
		deaths: tr(t, "dashboard.measure_deaths", "Deaths"),
		missing: tr(t, "dashboard.sfm_missing", "Missing persons"),
		injured: tr(t, "dashboard.measure_injured", "Injured or ill"),
		affected: tr(t, "dashboard.sfm_affected_direct", "Directly affected, as recorded"),
		destroyed: tr(t, "dashboard.houses_destroyed", "Dwellings destroyed"),
		damaged: tr(t, "dashboard.houses_damaged", "Dwellings damaged"),
	};
	const people = dataTokens.ramp.people;
	const housing = dataTokens.ramp.housing;

	// S0 rows: indicators, inputs, directly affected, then refused lines.
	const s0Rows: ChartExportRow[] = [
		...d.s0.indicators.map((i) => cellRow(i.code && national ? `${i.code} ${i.label}` : i.label, i.cell)),
		...d.s0.inputs.map((i) => cellRow(i.inputTo && national ? `${i.label} (input to ${i.inputTo}; no indicator value)` : i.label, i.cell)),
		cellRow(L.affected, d.s0.directlyAffected),
	];
	const s0Exp: PanelExport = {
		rows: s0Rows,
		method: d.meta.s0.method,
		notes: notes(d.meta.s0, d.s0.refused.map((r) => (r.code && national ? `${r.code}: ${r.reason}` : r.reason))),
	};
	const a1Exp: PanelExport = {
		rows: d.a1.years.flatMap((y) => [cellRow(String(y.year), y.deaths, L.deaths), cellRow(String(y.year), y.missing, L.missing)]),
		method: d.meta.a1.method,
		notes: notes(d.meta.a1, [
			d.a1.reference
				? tr(t, "dashboard.sfm_reference", "Dashed line: {from} to {to} annual average of deaths ({years} years). An analytical reference, not a Sendai performance measure.", d.a1.reference)
				: undefined,
		]),
	};
	const a2Exp: PanelExport = {
		rows: d.a2.rows.flatMap((r) => [cellRow(r.label, r.deaths, L.deaths), cellRow(r.label, r.missing, L.missing)]),
		method: d.meta.a2.method,
		notes: notes(d.meta.a2),
	};
	const b1Exp: PanelExport = {
		rows: [...d.b1.injured.map((p) => cellRow(String(p.year), p.cell, L.injured)), ...d.b1.affectedDirect.map((p) => cellRow(String(p.year), p.cell, L.affected))],
		method: d.meta.b1.method,
		notes: notes(d.meta.b1, [
			national
				? tr(t, "dashboard.sfm_affected_nocode", "Directly affected is shown as recorded and carries no indicator code; B-1 is not built from its parts (TR-216).")
				: tr(t, "dashboard.sfm_affected_recorded", "Directly affected is shown as recorded."),
		]),
	};
	const b2Exp: PanelExport = {
		rows: d.b2.rows.flatMap((r) => [
			{ ...cellRow(String(r.year), r.destroyed, L.destroyed), unit: "dwellings" },
			{ ...cellRow(String(r.year), r.damaged, L.damaged), unit: "dwellings" },
		]),
		method: d.meta.b2.method,
		notes: notes(d.meta.b2, [national ? tr(t, "dashboard.houses_inputs", "Dwelling counts are inputs to Sendai B-3 and B-4 and carry no indicator code.") : undefined]),
	};
	const c1Exp: PanelExport = {
		rows: d.c1.units.map((u) => ({ label: u.label, series: u.status, value: u.records, valueState: "reported" as const, unit: "records" })),
		method: d.meta.c1.method,
		notes: notes(d.meta.c1, [
			gapText(d.c1.gap),
			d.c1.untypedMoneyRecords > 0
				? tr(t, "dashboard.sfm_untyped_money", "{n} records carry an untyped money value from the source, without currency; they are not used.", { n: d.c1.untypedMoneyRecords })
				: undefined,
		]),
	};
	const c2Exp: PanelExport = {
		rows: d.c2.rows.flatMap((r) => r.cells.map((c, i) => ({ ...cellRow(`${r.decade}s`, c, d.c2.sectors[i]?.label), unit: "records" }))),
		method: d.meta.c2.method,
		notes: notes(d.meta.c2, [tr(t, "dashboard.sectors_overlap", "A record can report several sectors, so columns do not add up to records.")]),
	};
	const d1Exp: PanelExport = {
		rows: d.d1.sourceFields.map((f) => ({ label: f.label, series: f.field, value: f.records, valueState: "reported" as const, unit: "records" })),
		method: d.meta.d1.method,
		notes: notes(d.meta.d1, [gapText(d.d1.gap)]),
	};
	const d2Exp: PanelExport = { rows: [], method: d.meta.d2.method, notes: notes(d.meta.d2, [gapText(d.d2.gap)]) };

	const titles = {
		s0: tr(t, "dashboard.sfm_s0", "Targets A and B counts"),
		a1: tr(t, "dashboard.sfm_a1", "Deaths and missing persons per year"),
		a2: tr(t, "dashboard.sfm_a2", "Deaths and missing persons by hazard type"),
		b1: tr(t, "dashboard.sfm_b1", "Injured or ill people per year"),
		b2: tr(t, "dashboard.sfm_b2", "Dwellings damaged and destroyed per year"),
		c1: tr(t, "dashboard.sfm_c1", "Direct economic loss"),
		c2: tr(t, "dashboard.sfm_c2", "Records reporting damage by sector and decade"),
		d1: tr(t, "dashboard.sfm_d1", "Health and education facilities damaged or destroyed"),
		d2: tr(t, "dashboard.sfm_d2", "Disruption to basic services"),
	};

	const GapBody = ({ gap, children }: { gap: SendaiGap; children?: React.ReactNode }) => (
		<div className="flex flex-col gap-2 rounded border border-dashed border-brand-border-control bg-brand-surface-subtle p-3 text-sm">
			<p className="m-0">{gap.reason} <span className="whitespace-nowrap text-brand-text-muted">({gap.code})</span></p>
			{children}
		</div>
	);

	const views: Record<string, () => React.ReactNode> = {
		s0: () => (
			<Frame common={common(titles.s0)} exp={s0Exp} pictures={false}>
				<Tags codes={codes(["A-2", "A-3", "B-2"])} />
				<div className="max-w-full overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">{titles.s0}</caption>
						<thead>
							<tr>
								{national && <th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.indicator", "Indicator")}</th>}
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.measure", "Measure")}</th>
								<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.count", "Count")}</th>
								<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.records_reporting", "Records reporting")}</th>
								<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.state", "State")}</th>
							</tr>
						</thead>
						<tbody>
							{[
								...d.s0.indicators.map((i) => ({ key: i.label, code: i.code, label: i.label, cell: i.cell })),
								...d.s0.inputs.map((i) => ({ key: i.label, code: null as string | null, label: i.inputTo ? tr(t, "dashboard.sfm_input_label", "{label}, input to {code}", { label: i.label, code: i.inputTo }) : i.label, cell: i.cell })),
								{ key: "affected", code: null as string | null, label: L.affected, cell: d.s0.directlyAffected },
							].map((r) => (
								<tr key={r.key}>
									{national && <th scope="row" className={`${td} text-start font-semibold`}>{r.code ?? tr(t, "dashboard.no_code", "(no code)")}</th>}
									<td className={td}>{r.label}</td>
									<td className={`${td} text-end tabular-nums`}>{cellText(ctx, r.cell)}</td>
									<td className={`${td} text-end tabular-nums`}>{coverageText(ctx, r.cell).replace(/ report this$/, "")}</td>
									<td className={td}>{stateWord(r.cell)}</td>
								</tr>
							))}
							{d.s0.refused.map((r) => (
								<tr key={r.reason}>
									{national && <th scope="row" className={`${td} text-start font-semibold`}>{r.code ?? ""}</th>}
									<td className={`${td} text-brand-text-muted`} colSpan={3}>{tr(t, "dashboard.sfm_refused", "Not computed")}</td>
									<td className={`${td} italic text-brand-text-muted`}>{r.reason}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Frame>
		),
		a1: () => (
			<Frame common={common(titles.a1)} exp={a1Exp}>
				<Tags codes={codes(["A-2", "A-3"])} />
				<PairedColumns ctx={ctx} label={titles.a1}
					rows={d.a1.years.map((y) => ({ year: y.year, cells: [y.deaths, y.missing] }))}
					series={[{ name: L.deaths, fill: people[4] }, { name: L.missing, fill: people[2] }]}
					reference={d.a1.reference && val(d.a1.reference.deaths) !== null
						? { value: val(d.a1.reference.deaths) as number, text: tr(t, "dashboard.sfm_reference_short", "{from} to {to} annual average of deaths ({years} years)", d.a1.reference) }
						: null} />
			</Frame>
		),
		a2: () => (
			<Frame common={common(titles.a2)} exp={a2Exp}>
				<Tags codes={codes(["A-2", "A-3"])} />
				<PairedDots ctx={ctx} names={[L.deaths, L.missing]} rows={d.a2.rows.map((r) => ({ key: r.hipTypeId, label: r.label, a: r.deaths, b: r.missing }))} />
			</Frame>
		),
		b1: () => <B1View common={common(titles.b1)} exp={b1Exp} d={d} labels={L} codes={codes(["B-2"])} />,
		b2: () => (
			<Frame common={common(titles.b2)} exp={b2Exp}>
				<Tags codes={codes(["B-3", "B-4"]).map((c) => tr(t, "dashboard.input_to", "Input to {code}", { code: c }))} />
				<PairedColumns ctx={ctx} label={titles.b2}
					rows={d.b2.rows.map((r) => ({ year: r.year, cells: [r.destroyed, r.damaged] }))}
					series={[{ name: L.destroyed, fill: housing[4] }, { name: L.damaged, fill: housing[2] }]} />
			</Frame>
		),
		c1: () => (
			<Frame common={common(titles.c1)} exp={c1Exp} pictures={false}>
				<Tags codes={codes(["C-1 to C-6"])} />
				<GapBody gap={d.c1.gap}>
					{d.c1.untypedMoneyRecords > 0 && (
						<p className="m-0 text-brand-text-muted">
							{tr(t, "dashboard.sfm_untyped_money", "{n} records carry an untyped money value from the source, without currency; they are not used.", { n: d.c1.untypedMoneyRecords.toLocaleString(ctx.lang) })}
						</p>
					)}
					<table className="w-full border-collapse text-sm">
						<caption className="sr-only">{tr(t, "dashboard.sfm_units", "Physical units held")}</caption>
						<thead><tr>
							<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.sfm_unit", "Unit")}</th>
							<th scope="col" className={`${th} text-start`}>{tr(t, "dashboard.status", "Status")}</th>
							<th scope="col" className={`${th} text-end`}>{tr(t, "dashboard.records", "Records")}</th>
						</tr></thead>
						<tbody>
							{d.c1.units.map((u) => (
								<tr key={u.label}>
									<th scope="row" className={`${td} text-start font-normal`}>{u.label}</th>
									<td className={td}>{u.status === "held" ? tr(t, "dashboard.sfm_held", "Held") : tr(t, "dashboard.sfm_not_loaded", "Source field, not loaded")}</td>
									<td className={`${td} text-end tabular-nums`}>{u.records > 0 ? u.records.toLocaleString(ctx.lang) : noRecordsText(ctx)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</GapBody>
			</Frame>
		),
		c2: () => (
			<Frame common={common(titles.c2)} exp={c2Exp} pictures={false}>
				<Tags codes={codes(["C-3", "C-4"]).map((c) => tr(t, "dashboard.input_to", "Input to {code}", { code: c }))} />
				{d.c2.rows.length === 0 ? (
					<p className="m-0 text-sm text-brand-text-muted">{noRecordsText(ctx)}</p>
				) : (
					<ShadedTable ctx={ctx} caption={titles.c2} rowHeader={tr(t, "dashboard.decade", "Decade")}
						columns={d.c2.sectors.map((s) => s.label)}
						rows={d.c2.rows.map((r) => ({ key: String(r.decade), label: `${r.decade}s`, cells: r.cells }))}
						normalise="table" />
				)}
			</Frame>
		),
		d1: () => (
			<Frame common={common(titles.d1)} exp={d1Exp} pictures={false}>
				<Tags codes={codes(["D-2", "D-3"])} />
				<GapBody gap={d.d1.gap}>
					<ul className="m-0 list-none p-0 text-brand-text-muted">
						{d.d1.sourceFields.map((f) => (
							<li key={f.field}>
								{tr(t, "dashboard.sfm_source_field", "{label}: held in source field {field} for {n} records", { label: f.label, field: f.field, n: f.records.toLocaleString(ctx.lang) })}
							</li>
						))}
					</ul>
				</GapBody>
			</Frame>
		),
		d2: () => (
			<Frame common={common(titles.d2)} exp={d2Exp} pictures={false}>
				<Tags codes={codes(["D-5 to D-8"])} />
				<GapBody gap={d.d2.gap} />
			</Frame>
		),
	};

	const spec: [string, number, DashboardPanel["group"], PanelExport][] = [
		["s0", 1, "S", s0Exp],
		["a1", 2, "A", a1Exp],
		["a2", 3, "A", a2Exp],
		["b1", 4, "B", b1Exp],
		["b2", 5, "B", b2Exp],
		["c1", 6, "C", c1Exp],
		["c2", 7, "C", c2Exp],
		["d1", 8, "D", d1Exp],
		["d2", 9, "D", d2Exp],
	];
	return spec.map(([key, n, group, exp]) => ({
		id: `sfm-${key}`,
		n,
		group,
		title: titles[key as keyof typeof titles],
		exportData: exp,
		render: views[key],
	}));
}

/** B1 with its toggle: injured or ill (B-2), or directly affected as recorded (no code). */
function B1View({ common, exp, d, labels, codes }: { common: Common; exp: PanelExport; d: SendaiPayload; labels: { injured: string; affected: string }; codes: string[] }) {
	const [affected, setAffected] = useState(false);
	const t = common.ctx.t;
	return (
		<Frame common={common} exp={exp}>
			<div className="flex items-center justify-between gap-2">
				<Tags codes={affected ? [] : codes} />
				<ToggleButton
					isSelected={affected}
					onChange={setAffected}
					data-print="hide"
					className="rounded border border-brand-border-control bg-brand-surface px-2 py-1 text-sm text-brand-interactive data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
				>
					{tr(t, "dashboard.sfm_show_affected", "Show directly affected")}
				</ToggleButton>
			</div>
			<span className="text-sm text-brand-text-muted">{affected ? labels.affected : labels.injured}</span>
			<GapLine ctx={common.ctx} label={common.title} points={affected ? d.b1.affectedDirect : d.b1.injured} />
		</Frame>
	);
}

const TARGET_HEADINGS: Record<Exclude<DashboardPanel["group"], undefined | "S">, [string, string]> = {
	A: ["dashboard.sfm_target_a", "Target A: mortality"],
	B: ["dashboard.sfm_target_b", "Target B: affected people"],
	C: ["dashboard.sfm_target_c", "Target C: direct economic loss"],
	D: ["dashboard.sfm_target_d", "Target D: critical infrastructure and basic services"],
};

/**
 * The section: heading, the notice once, basis and coverage, then S0 full
 * width and one row per target with its two slots, in fixed order.
 */
export function SendaiSectionView({
	ctx,
	d,
	panels,
	country,
}: {
	ctx: ViewContext;
	d: SendaiPayload;
	panels: DashboardPanel[];
	country: string;
}) {
	const t = ctx.t;
	const card = "min-w-0 break-inside-avoid rounded border border-brand-border bg-brand-surface p-4";
	const by = (g: DashboardPanel["group"]) => panels.filter((p) => p.group === g).sort((a, b) => a.n - b.n);
	const coverage =
		d.coverage.recordsTotal > 0
			? tr(t, "dashboard.sfm_coverage", "Based on {n} of {total} records.", {
					n: d.coverage.recordsWith.toLocaleString(ctx.lang),
					total: d.coverage.recordsTotal.toLocaleString(ctx.lang),
				})
			: noRecordsText(ctx);
	return (
		<section aria-labelledby="sfm-heading" className="flex flex-col gap-4 rounded border border-brand-border bg-brand-surface-subtle p-4">
			<header className="flex flex-col gap-1">
				<h2 id="sfm-heading" className="m-0 flex items-center gap-2 text-xl font-semibold">
					<PanelIcon name={SECTION_ICONS.sendai} size={22} />
					{tr(t, "dashboard.sfm_title", "Sendai Framework Monitoring")}
				</h2>
				<p role="note" className="m-0 text-sm">{sendaiNotice(t, country)}</p>
				<p className="m-0 text-sm text-brand-text-muted">
					{d.provisional ? `${tr(t, "dashboard.sfm_provisional", "Provisional.")} ` : ""}
					{coverage}
				</p>
				{!d.nationalOnly && <p className="m-0 text-sm font-semibold">{subnationalNote(t)}</p>}
			</header>
			{by("S").map((p) => (
				<div key={p.id} id={p.id} className={card}>
					<PanelIconContext.Provider value={panelIcon(p.id)}>{p.render?.()}</PanelIconContext.Provider>
				</div>
			))}
			{(["A", "B", "C", "D"] as const).map((g) => {
				const [code, msg] = TARGET_HEADINGS[g];
				return (
					<section key={g} aria-label={t({ code, msg })} className="flex flex-col gap-2">
						<h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-interactive">
							<PanelIcon name={TARGET_ICONS[g]} size={16} />
							{t({ code, msg })}
						</h3>
						{/* Each target is its own grid, so Target B never starts in Target A's row. */}
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
							{by(g).map((p) => (
								<div key={p.id} id={p.id} className={card}>
									<PanelIconContext.Provider value={panelIcon(p.id)}>{p.render?.()}</PanelIconContext.Provider>
								</div>
							))}
						</div>
					</section>
				);
			})}
		</section>
	);
}

/**
 * The "Sendai Framework Monitoring" button (FR-AN-020, 021): a toggle with
 * aria-pressed, at the end of the filter row. Its state is the page
 * parameter sfm=1, outside delta.query/1.
 */
export function SendaiToggle({ ctx, on, onChange }: { ctx: ViewContext; on: boolean; onChange: (on: boolean) => void }) {
	return (
		<ToggleButton
			isSelected={on}
			onChange={onChange}
			data-print="hide"
			className="rounded border-2 border-brand-interactive bg-brand-surface px-3 py-1.5 text-sm font-semibold text-brand-interactive data-[hovered]:bg-brand-surface-subtle data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
		>
			{ctx.t({ code: "dashboard.sfm_title", msg: "Sendai Framework Monitoring" })}
		</ToggleButton>
	);
}
