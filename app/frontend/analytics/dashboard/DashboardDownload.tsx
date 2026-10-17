// Page-level download of the D1 dashboard: every panel's data in one CSV
// (ruling D6: the query table with CSV export is for signed-in users). The
// shell shows it only when the route says the reader is signed in; each
// panel keeps its own PNG, SVG and CSV downloads for everyone.
import { Button } from "react-aria-components";
import { saveBlob } from "~/frontend/charts/ChartFrame";
import { chartFileName, dashboardCsv, type ExportBasis } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { DashboardPanel } from "./types";

export interface DashboardDownloadProps {
	ctx: ViewContext;
	/** Already translated, e.g. "Analysis: Disaster impact". */
	title: string;
	scopeLine: string;
	source: string;
	basis: ExportBasis;
	panels: DashboardPanel[];
}

/** The CSV for the panels that have data, in panel order. */
export function dashboardPanelsCsv(
	panels: DashboardPanel[],
	scopeLine: string,
	source: string,
	basis: ExportBasis,
	generatedAt: Date,
): string {
	return dashboardCsv(
		scopeLine,
		[...panels]
			.sort((a, b) => a.n - b.n)
			.filter((p) => !p.gap && p.exportData)
			.map((p) => ({
				title: p.title,
				rows: p.exportData!.rows,
				meta: {
					source,
					scope: scopeLine,
					method: p.exportData!.method,
					basis,
					notes: p.exportData!.notes,
					generatedAt,
				},
			})),
	);
}

export function DashboardDownload({ ctx, title, scopeLine, source, basis, panels }: DashboardDownloadProps) {
	return (
		<Button
			data-print="hide"
			onPress={() => {
				const at = new Date();
				const csv = dashboardPanelsCsv(panels, scopeLine, source, basis, at);
				saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), chartFileName(title, "csv", at));
			}}
			className="rounded border border-brand-border-control bg-brand-surface px-3 py-1 text-sm text-brand-interactive data-[hovered]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
		>
			{ctx.t({ code: "dashboard.download_all", msg: "Download all panels (CSV)" })}
		</Button>
	);
}

export default DashboardDownload;
