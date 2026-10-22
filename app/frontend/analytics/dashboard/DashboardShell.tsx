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
import { PageBrand } from "~/frontend/PageBrand";
import { PanelIcon } from "~/frontend/charts/PanelIcon";
import { VIEW_ICONS } from "~/frontend/charts/dashboardIcons";
import { SECONDARY_BUTTON } from "~/frontend/buttonStyles";
import { DashboardTools, FILTERS_ID, WhatChanged } from "./DashboardTools";
import { UX } from "~/frontend/uxFeatures";

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
	/** The instance's country, after the page title. */
	country?: string | null;
	provisional: boolean;
	/** The left hazard rail (mockup option A); beside everything below the notices. */
	rail?: React.ReactNode;
	/** The Sendai Framework Monitoring section, the same on every view; after the view's panels, or alone when on (FR-AN-024). */
	sendai?: React.ReactNode;
	/** Toggle on: only the Sendai section shows; the view buttons are disabled (FR-AN-022, 023). */
	sfmOn?: boolean;
	/** UX-3: a click on a ranked division or hazard row sets the page filter. */
	onFilterRow?: (kind: "division" | "hazard", id: string) => void;
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
	country,
	provisional,
	rail,
	sendai,
	sfmOn = false,
	onFilterRow,
	filterBar,
	map,
	panels,
	download,
	about,
}: DashboardShellProps) {
	const t = ctx.t;
	// The view buttons (FE-Proposal-03, Alex 2026-10-19): bold, 2pt larger,
	// at least 44 x 44 px, with distinct hover, pressed, selected, focus and
	// disabled states; the selected one is filled in the dashboard ink. 32 px
	// side padding makes each 30% wider than at first (Alex, 2026-10-20: 113-137 px
	// measured, +36 px each).
	const tabClass =
		"group inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg px-[32px] text-[1.0625rem] font-bold leading-tight text-data-dashboard-ink outline-none transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none data-[hovered]:bg-data-dashboard-border data-[pressed]:bg-data-dashboard-accent data-[selected]:bg-data-dashboard-ink data-[selected]:text-brand-text-on-interactive data-[selected]:shadow-[inset_0_-3px_0_var(--delta-data-dashboard-accent)] data-[selected]:data-[hovered]:bg-data-dashboard-ink data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";
	// The scope line as chips: querySummary joins its parts with " · ".
	const chips = summary.split(" · ").filter(Boolean);

	return (
		// UX-3: rows that name a division or hazard (data-filter-*) filter the page on click.
		<div
			data-print="flow"
			className="delta-dashboard-canvas flex flex-col gap-4 text-brand-text"
			onClick={(e) => {
				if (!UX[3] || !onFilterRow) return;
				const row = (e.target as Element).closest?.("[data-filter-kind]");
				const kind = row?.getAttribute("data-filter-kind");
				const id = row?.getAttribute("data-filter-id");
				if ((kind === "division" || kind === "hazard") && id) onFilterRow(kind, id);
			}}
		>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<PageBrand ctx={ctx} section="analysis" country={country} />
					<ul aria-label={t({ code: "dashboard.scope", msg: "Scope" })} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
						{chips.map((c, i) => (
							<li key={c}
								className={`rounded-full border border-data-dashboard-border bg-data-dashboard-surface px-2.5 py-0.5 text-sm text-data-dashboard-ink ${i === 0 ? "font-extrabold" : "font-semibold"}`}>
								{c}
							</li>
						))}
					</ul>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{basisControl}
					{reviewHref && (
						<a
							href={reviewHref}
							data-print="hide"
							className={SECONDARY_BUTTON}
						>
							{t({ code: "dashboard.review_flagged", msg: "Review flagged records" })}
						</a>
					)}
					{download}
					<PrintButton ctx={ctx} />
					<DashboardTools ctx={ctx} onViewChange={onViewChange} viewsDisabled={sfmOn} />
				</div>
			</header>
			<WhatChanged ctx={ctx} summary={summary} />

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
					className="delta-layer flex w-max max-w-full flex-wrap gap-1 self-start p-1 max-sm:grid max-sm:w-full max-sm:grid-cols-2"
				>
					{DASHBOARD_VIEWS.map((v) => (
						<Tab key={v} id={v} className={tabClass}>
							<span className="inline-flex text-data-dashboard-icon group-data-[hovered]:text-data-dashboard-ink group-data-[selected]:text-brand-text-on-interactive">
								<PanelIcon name={VIEW_ICONS[v]} size={22} colour="currentColor" />
							</span>
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
				<div id={FILTERS_ID}>{filterBar}</div>
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
							<div className="delta-layer min-h-[260px] overflow-hidden">{map}</div>
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
