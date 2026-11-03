// "Records behind this cell" on Hazard by month (FR-AN-068): the disaster
// records a rare severe or Under review box is built from, so a reader can
// check the figure against its sources. A record that does not report the
// measure says so in words, never 0; flagged records are listed and marked,
// and their values stay as recorded.
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { FOCUS_RING, SECONDARY_BUTTON_SM } from "~/frontend/buttonStyles";
import type { ViewContext } from "~/frontend/context";
import type { CellRecord, CellRecords } from "~/utils/dashboard/cellRecords";
import { STATE_ENCODING } from "~/utils/mapState";

export const CELL_KEY_PARAM = "cellKey";
export const CELL_MONTH_PARAM = "cellMonth";

/** The cell asked for in a request, or null when the month or key cannot be read. */
export function parseCellRequest(params: URLSearchParams): { key: string; month: number } | null {
	const key = params.get(CELL_KEY_PARAM)?.trim();
	const month = Number(params.get(CELL_MONTH_PARAM));
	return key && Number.isInteger(month) && month >= 1 && month <= 12 ? { key, month } : null;
}

/** The value as the list shows it: a number, or the state in words. */
export function recordValueText(ctx: Pick<ViewContext, "lang">, r: Pick<CellRecord, "value" | "valueState">): string {
	if (r.valueState === "reported" && r.value !== null) return r.value.toLocaleString(ctx.lang);
	const state = r.valueState === "reported" ? "not_reported" : r.valueState;
	return (STATE_ENCODING as Record<string, { label: string }>)[state].label;
}

export function CellRecordsTable({ ctx, d, title, valueLabel }: { ctx: ViewContext; d: CellRecords; title: string; valueLabel: string }) {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const th = "border-b border-brand-border bg-brand-surface-subtle px-2 py-1 text-start font-semibold";
	const td = "border-b border-brand-border px-2 py-1 align-top";
	return (
		<>
			<p className="m-0 text-xs text-brand-text-muted">
				{d.records.length < d.total
					? t({ code: "dashboard.cell_records_some", msg: "Showing {shown} of {total} records, largest value first." }, { shown: n(d.records.length), total: n(d.total) })
					: t({ code: "dashboard.cell_records_all", msg: "{total} records, largest value first." }, { total: n(d.total) })}
			</p>
			<div className="max-w-full overflow-x-auto">
				<table className="w-full border-collapse text-xs">
					<caption className="sr-only">{title}</caption>
					<thead>
						<tr>
							<th scope="col" className={th}>{t({ code: "dashboard.date", msg: "Date" })}</th>
							<th scope="col" className={th}>{t({ code: "dashboard.place", msg: "Place" })}</th>
							<th scope="col" className={`${th} text-end`}>{valueLabel}</th>
							<th scope="col" className={th}>{t({ code: "dashboard.flags", msg: "Flags" })}</th>
							<th scope="col" className={th}>{t({ code: "dashboard.source", msg: "Source" })}</th>
						</tr>
					</thead>
					<tbody>
						{d.records.map((r) => (
							<tr key={r.recordId}>
								<th scope="row" className={`${td} text-start font-normal`}>
									<a href={ctx.url(`/disaster-record/${r.recordId}`)} className="text-brand-interactive underline">
										{r.startDate ?? t({ code: "dashboard.no_date", msg: "No date" })}
									</a>
								</th>
								<td className={td}>{r.places.length > 0 ? r.places.join(", ") : t({ code: "dashboard.no_division", msg: "Division not recorded" })}</td>
								<td className={`${td} text-end tabular-nums ${r.valueState === "reported" ? "" : "italic text-brand-text-muted"}`}>{recordValueText(ctx, r)}</td>
								<td className={td}>
									{r.underReview && <span className="me-1 inline-block rounded bg-data-flag-review-chip-background px-1 font-semibold text-data-flag-review-chip-text">{t({ code: "dashboard.under_review", msg: "Under review" })}</span>}
									{r.flags.map((f) => <span key={f} className="me-1 inline-block rounded bg-data-flag-review-chip-background px-1 text-data-flag-review-chip-text">{f}</span>)}
								</td>
								<td className={td}>{r.source ?? t({ code: "dashboard.no_source", msg: "No source recorded" })}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{d.meta.notApplied.map((f) => <p key={f} className="m-0 text-xs text-brand-text-muted">{t({ code: "dashboard.not_applied", msg: "Not applied: {f}" }, { f })}</p>)}
		</>
	);
}

/** Loads and lists the records of the selected box, with the page's own filters. */
export function CellRecordsPanel({ ctx, cell, heading, valueLabel, onClose }: { ctx: ViewContext; cell: { key: string; month: number }; heading: string; valueLabel: string; onClose: () => void }) {
	const t = ctx.t;
	const [state, setState] = useState<{ for: string; data: CellRecords | null; failed: boolean } | null>(null);
	const id = `${cell.key}|${cell.month}`;
	useEffect(() => {
		const ctrl = new AbortController();
		const params = new URLSearchParams(window.location.search);
		params.set(CELL_KEY_PARAM, cell.key);
		params.set(CELL_MONTH_PARAM, String(cell.month));
		fetch(ctx.url(`/analytics/cell-records?${params}`), { signal: ctrl.signal })
			.then((r) => {
				if (!r.ok) throw new Error(String(r.status));
				return r.json() as Promise<CellRecords>;
			})
			.then((data) => setState({ for: id, data, failed: false }))
			.catch((e: unknown) => {
				if ((e as { name?: string })?.name !== "AbortError") setState({ for: id, data: null, failed: true });
			});
		return () => ctrl.abort();
	}, [id]);
	const current = state?.for === id ? state : null;
	return (
		<section aria-live="polite" data-print="hide" className="flex flex-col gap-2 rounded-lg border border-data-dashboard-border p-2">
			<div className="flex items-start justify-between gap-2">
				<h4 className="delta-panel-title m-0 text-sm">{t({ code: "dashboard.cell_records_title", msg: "Records behind this cell" })}: {heading}</h4>
				<Button onPress={onClose} className={`${SECONDARY_BUTTON_SM} ${FOCUS_RING}`}>{t({ code: "dashboard.close", msg: "Close" })}</Button>
			</div>
			{!current && <p className="m-0 text-xs text-brand-text-muted">{t({ code: "dashboard.cell_records_loading", msg: "Loading the records" })}</p>}
			{current?.failed && <p role="alert" className="m-0 text-xs">{t({ code: "dashboard.cell_records_failed", msg: "The records could not be loaded. The figures on this page are not affected; try again." })}</p>}
			{current?.data && <CellRecordsTable ctx={ctx} d={current.data} title={`${t({ code: "dashboard.cell_records_title", msg: "Records behind this cell" })}: ${heading}`} valueLabel={valueLabel} />}
		</section>
	);
}
