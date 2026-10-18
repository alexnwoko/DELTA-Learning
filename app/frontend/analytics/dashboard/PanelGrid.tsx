// The panel grid of the D1 dashboard: two columns on wide screens, one on
// phones and on paper. Panels 1 to 12 show; 13 to 16 wait under "Show
// more", and print open. Panels with no data either keep their own frame
// with the reason, or fold into one "Not yet available" strip (decision 1);
// a panel with a grey placeholder chart (ghost) always keeps its frame.
import { useId } from "react";
import { Button, Disclosure, DisclosurePanel } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import { GhostChart } from "./GhostChart";
import { DEFAULT_PANEL_COUNT, type DashboardPanel, type PanelGap } from "./types";

const focusRing =
	"data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";

export interface PanelGridProps {
	ctx: ViewContext;
	panels: DashboardPanel[];
	/** Fold gap panels into one strip (event dimensions while G-01 holds). */
	collapseGaps: boolean;
}

function gapCountText(ctx: ViewContext, gap: PanelGap): string | null {
	// A count of 0 explains nothing and reads as a figure: leave it out.
	if (!gap.count) return null;
	return `${gap.count.toLocaleString(ctx.lang)}${gap.countLabel ? ` ${gap.countLabel}` : ""}`;
}

function GapBody({ ctx, gap }: { ctx: ViewContext; gap: PanelGap }) {
	const count = gapCountText(ctx, gap);
	return (
		<p className="m-0 text-sm text-brand-text-muted">
			{gap.text}
			{gap.code && <span className="whitespace-nowrap"> ({gap.code})</span>}
			{count && <span className="block">{count}</span>}
		</p>
	);
}

function PanelCard({ ctx, panel }: { ctx: ViewContext; panel: DashboardPanel }) {
	const headingId = useId();
	if (panel.gap) {
		return (
			<section
				id={panel.id}
				aria-labelledby={headingId}
				data-panel-state={panel.gap.ghost ? "ghost" : "gap"}
				className={`flex min-w-0 flex-col gap-2 rounded border border-dashed border-brand-border-control bg-brand-surface-subtle p-4${panel.wide ? " lg:col-span-2" : ""}`}
			>
				<h3 id={headingId} className="m-0 text-base font-semibold text-brand-text">
					{panel.title}
				</h3>
				{panel.gap.ghost && <GhostChart ctx={ctx} shape={panel.gap.ghost} />}
				<GapBody ctx={ctx} gap={panel.gap} />
			</section>
		);
	}
	return (
		// ChartFrame carries its own heading, so the card is a plain region.
		<div
			id={panel.id}
			data-panel-state="ready"
			className={`min-w-0 break-inside-avoid rounded border border-brand-border bg-brand-surface p-4${panel.wide ? " lg:col-span-2" : ""}`}
		>
			{panel.render?.()}
		</div>
	);
}

/** One strip listing the panels that have nothing to show yet. */
export function NotYetAvailableStrip({ ctx, panels }: { ctx: ViewContext; panels: DashboardPanel[] }) {
	const headingId = useId();
	if (panels.length === 0) return null;
	return (
		<section
			aria-labelledby={headingId}
			className="rounded border border-dashed border-brand-border-control bg-brand-surface-subtle p-4"
		>
			<h3 id={headingId} className="m-0 mb-2 text-base font-semibold text-brand-text">
				{ctx.t({ code: "dashboard.not_yet_available", msg: "Not yet available" })}
			</h3>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{panels.map((p) => {
					const gap = p.gap as PanelGap;
					const count = gapCountText(ctx, gap);
					return (
						<li key={p.id} id={p.id} className="text-sm">
							<span className="font-semibold text-brand-text">{p.title}</span>
							<span className="text-brand-text-muted">
								{": "}
								{gap.text}
								{gap.code && ` (${gap.code})`}
								{count && ` · ${count}`}
							</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function Grid({ ctx, panels }: { ctx: ViewContext; panels: DashboardPanel[] }) {
	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
			{panels.map((p) => (
				<PanelCard key={p.id} ctx={ctx} panel={p} />
			))}
		</div>
	);
}

export function PanelGrid({ ctx, panels, collapseGaps }: PanelGridProps) {
	const sorted = [...panels].sort((a, b) => a.n - b.n);
	// A strip lists several gaps; a lone gap (a whole view with no data, such
	// as G-01) keeps its own frame across the view.
	// Ghost panels and full-width notices keep their own place.
	const foldable = (p: DashboardPanel) => !!p.gap && !p.gap.ghost && !p.wide;
	const fold = collapseGaps && sorted.filter(foldable).length > 1;
	const visible = fold ? sorted.filter((p) => !foldable(p)) : sorted;
	const strip = fold ? sorted.filter(foldable) : [];
	const main = visible.filter((p) => p.n <= DEFAULT_PANEL_COUNT);
	const more = visible.filter((p) => p.n > DEFAULT_PANEL_COUNT);

	return (
		<div className="flex flex-col gap-4">
			<Grid ctx={ctx} panels={main} />
			{more.length > 0 && (
				// Printing opens it (print.css), so paper carries every panel.
				<Disclosure data-print="expand" className="flex flex-col gap-4">
					{({ isExpanded }) => (
						<>
							<Button
								slot="trigger"
								data-print="hide"
								className={`self-start rounded border border-brand-border-control bg-brand-surface px-3 py-1 text-sm text-brand-interactive data-[hovered]:bg-brand-surface-subtle ${focusRing}`}
							>
								{isExpanded
									? ctx.t({ code: "dashboard.show_fewer", msg: "Show fewer panels" })
									: ctx.t(
											{ code: "dashboard.show_more", msg: "Show {n} more panels" },
											{ n: more.length },
										)}
							</Button>
							<DisclosurePanel>
								<Grid ctx={ctx} panels={more} />
							</DisclosurePanel>
						</>
					)}
				</Disclosure>
			)}
			<NotYetAvailableStrip ctx={ctx} panels={strip} />
		</div>
	);
}

export default PanelGrid;
