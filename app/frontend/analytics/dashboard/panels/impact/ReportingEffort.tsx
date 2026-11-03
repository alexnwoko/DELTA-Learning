// Reporting effort (FR-AN-090): per start year, the records, reporting
// divisions and sources behind the data, so a rise in records can be read
// apart from a rise in disasters. Years stay in order; the ratio is withheld
// under the minimum number of divisions, in words and never as 0.
import { ChartFrame } from "~/frontend/charts/ChartFrame";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { ReportingEffort } from "~/utils/dashboard/reportingEffort";
import { cellRow, panelNotes } from "../../panelCell";
import type { DashboardPanel } from "../../types";
import { ShadedTable } from "../blocks";

const count = (n: number): PanelCell => ({ value: n, valueState: "reported", recordsReported: n, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: n, recordsFlagged: 0 });
const ratio = (v: number | null, n: number): PanelCell => (v === null ? { ...count(n), value: null, valueState: "insufficient_reporting" } : { ...count(n), value: v });

export function reportingEffortPanel(ctx: ViewContext, d: ReportingEffort, common: { source: string; scope: string; provisional: boolean }): DashboardPanel {
	const t = (code: string, msg: string, r?: Record<string, unknown>) => ctx.t({ code, msg }, r);
	const title = t("dashboard.reporting_effort", "Reporting effort");
	const columns = [t("dashboard.records", "Records"), t("dashboard.effort_divisions", "Divisions reporting"), t("dashboard.effort_sources", "Sources"), t("dashboard.effort_per_division", "Records per division")];
	const rows = d.years.map((y) => ({ key: String(y.year), label: String(y.year), cells: [count(y.records), count(y.divisions), count(y.sources), ratio(y.recordsPerDivision, y.divisions)] }));
	const own = [
		d.note,
		t("dashboard.effort_min", "Records per division is withheld for a year with under {n} divisions reporting.", { n: d.minDivisions }),
		d.recordsNoYear > 0 ? t("dashboard.effort_no_year", "{n} records have no start year and are not listed.", { n: d.recordsNoYear.toLocaleString(ctx.lang) }) : undefined,
	];
	const exportData = { rows: rows.flatMap((r) => r.cells.map((c, i) => cellRow(r.label, c, columns[i]))), method: d.meta.method, notes: panelNotes(d.meta, own) };
	return {
		id: "impact-effort",
		n: 33,
		title,
		exportData,
		render: () => (
			<ChartFrame ctx={ctx} title={title} rows={exportData.rows} pictures={false}
				meta={{ source: common.source, scope: common.scope, method: d.meta.method, basis: common.provisional ? "provisional" : "published", notes: exportData.notes }}>
				{/* Years are a time series and the columns are different counts: order as given, shaded per column. */}
				<ShadedTable ctx={ctx} caption={title} rowHeader={t("dashboard.year", "Year")} columns={columns} rows={rows} normalise="column" order="given" />
			</ChartFrame>
		),
	};
}
