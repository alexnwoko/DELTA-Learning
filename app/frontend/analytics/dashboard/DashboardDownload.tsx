// Page-level download of the D1 dashboard: every panel's data in one CSV
// (ruling D6: the query table with CSV export is for signed-in users). The
// shell shows it only when the route says the reader is signed in; each
// panel keeps its own PNG, SVG and CSV downloads for everyone.
import { Button } from "react-aria-components";
import { saveBlob } from "~/frontend/charts/ChartFrame";
import { chartFileName, dashboardCsv, type ExportBasis } from "~/frontend/charts/chartExport";
import type { ViewContext } from "~/frontend/context";
import type { DashboardPanel } from "./types";
import { SECONDARY_BUTTON } from "~/frontend/buttonStyles";

export interface DashboardDownloadProps {
	ctx: ViewContext;
	/** Already translated, e.g. "Analysis: Disaster impact". */
	title: string;
	scopeLine: string;
	source: string;
	basis: ExportBasis;
	panels: DashboardPanel[];
}

/** The CSV for the panels that have data, in the page's order (the Sendai section first). */
export function dashboardPanelsCsv(
	panels: DashboardPanel[],
	scopeLine: string,
	source: string,
	basis: ExportBasis,
	generatedAt: Date,
): string {
	return dashboardCsv(
		scopeLine,
		panels
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
			className={SECONDARY_BUTTON}
		>
			{ctx.t({ code: "dashboard.download_all", msg: "Download all panels (CSV)" })}
		</Button>
	);
}

export default DashboardDownload;
