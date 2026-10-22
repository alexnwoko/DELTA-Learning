// The waiting screen of the Analysis and Geoportal pages (Alex, 2026-10-22): a ring of
// blue dots that rolls round, each dot fading in turn, with "Hold...
// putting together your analysis" (or "your map") on three lines inside the
// ring. It shows while the page loads (opened, or a view or filter changed) and
// the 150 ms delay of the route progress bar has passed, so quick changes
// do not flash. Reduced motion: the ring stands still. The message is a
// polite live region, so a screen reader announces it once.
import type { ViewContext } from "~/frontend/context";

const DOTS = 8;
const RING = 84; // radius of the dot ring, px
const DOT = 7; // dot radius, px

export type LoaderSection = "analysis" | "geoportal";

export function AnalysisLoader({ ctx, section = "analysis" }: { ctx: Pick<ViewContext, "t">; section?: LoaderSection }) {
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const size = (RING + DOT) * 2 + 4;
	const c = size / 2;
	return (
		<div
			role="status"
			aria-live="polite"
			data-print="hide"
			className="delta-analysis-loader fixed inset-0 z-[9998] flex items-center justify-center bg-data-dashboard-canvas/80 backdrop-blur-[1px]"
		>
			<div className="relative" style={{ width: size, height: size }}>
				<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false" className="delta-loader-ring absolute inset-0">
					{Array.from({ length: DOTS }, (_, i) => {
						const a = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
						return (
							<circle
								key={i}
								cx={c + RING * Math.cos(a)}
								cy={c + RING * Math.sin(a)}
								r={DOT}
								className="delta-loader-dot"
								style={{ animationDelay: `${(i * 1.2) / DOTS - 1.2}s` }}
							/>
						);
					})}
				</svg>
				<p className="delta-panel-title absolute inset-0 m-0 flex flex-col items-center justify-center text-center text-sm leading-snug">
					<span>{t("dashboard.loading_hold", "Hold...")}</span>
					<span>{t("dashboard.loading_putting", "putting together")}</span>
					<span>
						{section === "geoportal"
							? t("dashboard.loading_your_map", "your map")
							: t("dashboard.loading_your_analysis", "your analysis")}
					</span>
				</p>
			</div>
		</div>
	);
}

/** The section whose waiting screen a path shows while it loads: Analysis or Geoportal (Alex, 2026-10-22). */
export function loaderSection(pathname: string): LoaderSection | null {
	const m = /^\/[a-z]{2}(?:-debug)?\/(analytics|geoportal)(?:\/|$)/.exec(pathname);
	return m ? (m[1] === "analytics" ? "analysis" : "geoportal") : null;
}
