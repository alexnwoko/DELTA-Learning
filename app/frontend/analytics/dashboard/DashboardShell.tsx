// The D1 Analysis dashboard shell (D1 build brief, section 2): title and
// scope line, Print at the top right, the dimension tabs, then the shared
// filter bar, map M0, the panel grid, the Sendai section (FR-AN-024) and
// "About the data". With the Sendai toggle on, only the Sendai section shows. The shell owns
// no data and no URL: the route passes the query and writes the next one
// to the URL (delta.query/1), so every view has a shareable link.
// In print, the layout columns carry data-print="flow" and print as plain
// blocks (print.css), so each section starts below the one before it.
import React from "react";
import { Tab, TabList, TabPanel, Tabs, type Key } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import { PrintButton } from "~/frontend/print/PrintButton";
import type { QueryDimension } from "~/utils/deltaQuery";
import { PanelGrid } from "./PanelGrid";
import { collapsesGaps, type DashboardPanel } from "./types";
import { DASHBOARD_VIEWS, type DashboardView } from "./views";

export function dimensionLabel(ctx: ViewContext, dimension: QueryDimension): string {
	switch (dimension) {
		case "hazardous_event":
			return ctx.t({ code: "dashboard.dim_hazardous_events", msg: "Hazardous events" });
		case "disaster_event":
			return ctx.t({ code: "dashboard.dim_disaster_events", msg: "Disaster events" });
		case "disaster_impact":
			return ctx.t({ code: "dashboard.dim_disaster_impact", msg: "Disaster impact" });
	}
}

/** The button label of a view: the three dimensions and Sectors. */
export function viewLabel(ctx: ViewContext, view: DashboardView): string {
	return view === "sectors"
		? ctx.t({ code: "dashboard.view_sectors", msg: "Sectors" })
		: dimensionLabel(ctx, view);
}

export interface DashboardShellProps {
	ctx: ViewContext;
	/** The view shown: one of the four buttons, in Alex's order. */
	view: DashboardView;
	onViewChange: (view: DashboardView) => void;
	/** The reviewer queue, for signed-in users who may open it; omitted otherwise. */
	reviewHref?: string;
	/** One line of scope and basis, e.g. "Angola · 2015 to 2024 · Basis: published". */
	summary: string;
	provisional: boolean;
	/** The left hazard rail (mockup option A); beside everything below the notices. */
	rail?: React.ReactNode;
	/** The Sendai Framework Monitoring section, the same on every view; after the view's panels, or alone when on (FR-AN-024). */
	sendai?: React.ReactNode;
	/** Toggle on: only the Sendai section shows; the view buttons are disabled (FR-AN-022, 023). */
	sfmOn?: boolean;
	/** The shared filter bar (GeoFilterBar, owned by Geoportal). */
	filterBar?: React.ReactNode;
	/** Map M0, drawn through MapChart. */
	map?: React.ReactNode;
	panels: DashboardPanel[];
	/** The Basis switch, for reviewers with ValidateData only. */
	basisControl?: React.ReactNode;
	/** One notice above the views, e.g. no published records yet (G-00). */
	notice?: React.ReactNode;
	/** Page-level CSV download; the route passes it to signed-in readers only (D6). */
	download?: React.ReactNode;
	/** "About the data": disclaimer, partners and contact. */
	about?: React.ReactNode;
}

export function DashboardShell({
	ctx,
	view,
	onViewChange,
	reviewHref,
	basisControl,
	notice,
	summary,
	provisional,
	rail,
	sendai,
	sfmOn = false,
	filterBar,
	map,
	panels,
	download,
	about,
}: DashboardShellProps) {
	const t = ctx.t;
	const tabClass =
		"cursor-pointer border-b-4 border-transparent px-3 py-2 text-sm font-semibold text-brand-text-muted outline-none data-[hovered]:text-brand-text data-[selected]:border-brand-interactive data-[selected]:text-brand-text data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";

	return (
		<div data-print="flow" className="flex flex-col gap-4 text-brand-text">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="m-0 text-2xl font-semibold">
						{t({ code: "dashboard.title", msg: "Analysis" })}
					</h1>
					<p className="m-0 text-sm text-brand-text-muted">{summary}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{basisControl}
					{reviewHref && (
						<a
							href={reviewHref}
							data-print="hide"
							className="rounded border border-brand-border-control bg-brand-surface px-3 py-1 text-sm text-brand-interactive no-underline hover:bg-brand-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus-ring"
						>
							{t({ code: "dashboard.review_flagged", msg: "Review flagged records" })}
						</a>
					)}
					{download}
					<PrintButton ctx={ctx} />
				</div>
			</header>

			{provisional && (
				<p
					role="note"
					className="m-0 border-s-4 border-data-notice-provisional-border bg-data-notice-provisional-background px-3 py-2 text-sm"
				>
					{t({
						code: "dashboard.provisional_banner",
						msg: "Provisional: includes records not yet validated or published. Not for publication.",
					})}
				</p>
			)}

			{notice}

			{/* The rail sits left of the views on wide screens, above them on phones. */}
			<div data-print="flow" className="flex flex-col gap-4 lg:flex-row lg:items-start">
			{rail}
			<Tabs
				selectedKey={view}
				onSelectionChange={(key: Key) => onViewChange(key as DashboardView)}
				isDisabled={sfmOn}
				data-print="flow"
				className="flex min-w-0 flex-1 flex-col gap-4"
			>
				<TabList
					aria-label={t({ code: "dashboard.view", msg: "What to analyse" })}
					data-print="hide"
					className="flex flex-wrap gap-1 border-b border-brand-border"
				>
					{DASHBOARD_VIEWS.map((v) => (
						<Tab key={v} id={v} className={tabClass}>
							{viewLabel(ctx, v)}
						</Tab>
					))}
				</TabList>
				{sfmOn && (
					<p className="m-0 text-sm text-brand-text-muted" data-print="hide">
						{t({
							code: "dashboard.sfm_tabs_off",
							msg: "The Sendai view reads disaster records of all dimensions; the dimension switch applies when the view is off.",
						})}
					</p>
				)}
				{/* Filters and the Sendai section are the same on every view. */}
				{filterBar}
				{/* Only the selected panel mounts; the others hold nothing. With
				    the Sendai toggle on, no panel mounts, so the Sendai section
				    below sits directly under the filter bar (FR-AN-024). */}
				{!sfmOn &&
					DASHBOARD_VIEWS.map((v) => (
					<TabPanel key={v} id={v} data-print="flow" className="flex flex-col gap-4 outline-none">
						<h2 className="sr-only print:not-sr-only print:m-0 print:text-xl print:font-semibold">
							{viewLabel(ctx, v)}
						</h2>
						{map && (
							<div className="min-h-[260px] overflow-hidden rounded border border-brand-border">{map}</div>
						)}
						<PanelGrid ctx={ctx} panels={panels} collapseGaps={collapsesGaps(v)} />
					</TabPanel>
				))}
				{/* Toggle off: after the view's map and panels. Toggle on: alone, at the top. */}
				{sendai}
			</Tabs>
			</div>

			{about}
		</div>
	);
}

export default DashboardShell;
