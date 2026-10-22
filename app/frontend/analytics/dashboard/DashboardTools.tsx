// The Analysis page's trial helpers (Alex, 2026-10-22), each behind its UX
// switch (app/frontend/uxFeatures.ts):
//   UX-2 Copy link: the address already holds the view and every filter.
//   UX-5 What changed: after a filter or view change, one line says what
//        is shown now, with Undo (the browser's back step).
//   UX-6 Saved views: name the current view and reopen it later; kept in
//        this browser only (localStorage), never sent anywhere.
//   UX-7 Keyboard shortcuts: 1 to 4 switch views, / goes to the filters,
//        ? lists the shortcuts. Ignored while typing in a field.
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogTrigger, Input, Label, Popover, TextField } from "react-aria-components";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { FOCUS_RING, SECONDARY_BUTTON } from "~/frontend/buttonStyles";
import type { ViewContext } from "~/frontend/context";
import { UX } from "~/frontend/uxFeatures";
import { DASHBOARD_VIEWS, type DashboardView } from "./views";

type T = (code: string, msg: string, r?: Record<string, unknown>) => string;

/** The element the "/" shortcut focuses: the filter row (DashboardShell). */
export const FILTERS_ID = "dashboard-filters";

const SAVED_KEY = "delta-saved-views";
export interface SavedView {
	name: string;
	/** Path and query, e.g. /en/analytics?dim=disaster_impact&from=2015. */
	href: string;
}

/** Saved views from this browser; empty when storage is unusable. */
export function readSavedViews(storage: Pick<Storage, "getItem"> | null): SavedView[] {
	try {
		const raw = storage?.getItem(SAVED_KEY);
		const list = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(list) ? list.filter((v): v is SavedView => typeof v?.name === "string" && typeof v?.href === "string") : [];
	} catch {
		return [];
	}
}

/** Adds or replaces a view by name, newest first, at most 20; false when storage fails. */
export function saveView(storage: Pick<Storage, "getItem" | "setItem"> | null, view: SavedView): boolean {
	if (!storage) return false;
	try {
		const list = [view, ...readSavedViews(storage).filter((v) => v.name !== view.name)].slice(0, 20);
		storage.setItem(SAVED_KEY, JSON.stringify(list));
		return true;
	} catch {
		return false;
	}
}

function safeLocalStorage(): Storage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/** The key a shortcut maps to, or null; never while typing in a field. */
export function shortcutFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, target: EventTarget | null): string | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return null;
	return ["1", "2", "3", "4", "/", "?"].includes(e.key) ? e.key : null;
}

function CopyLink({ t }: { t: T }) {
	const [copied, setCopied] = useState(false);
	return (
		<>
			<Button
				data-print="hide"
				className={SECONDARY_BUTTON}
				onPress={async () => {
					try {
						await navigator.clipboard.writeText(window.location.href);
						setCopied(true);
						setTimeout(() => setCopied(false), 2500);
					} catch {
						setCopied(false);
					}
				}}
			>
				{copied ? t("dashboard.link_copied", "Link copied") : t("dashboard.copy_link", "Copy link")}
			</Button>
			<span role="status" className="sr-only">{copied ? t("dashboard.link_copied", "Link copied") : ""}</span>
		</>
	);
}

function SavedViews({ t }: { t: T }) {
	const location = useLocation();
	const navigate = useNavigate();
	const [views, setViews] = useState<SavedView[]>([]);
	const [name, setName] = useState("");
	useEffect(() => setViews(readSavedViews(safeLocalStorage())), []);
	const save = () => {
		const n = name.trim();
		if (!n) return;
		if (saveView(safeLocalStorage(), { name: n, href: `${location.pathname}${location.search}` })) {
			setViews(readSavedViews(safeLocalStorage()));
			setName("");
		}
	};
	return (
		<DialogTrigger>
			<Button data-print="hide" className={SECONDARY_BUTTON}>{t("dashboard.saved_views", "Saved views")}</Button>
			<Popover className="delta-layer w-72 p-3">
				<Dialog aria-label={t("dashboard.saved_views", "Saved views")} className="flex flex-col gap-2 outline-none">
					{({ close }) => (
						<>
							<form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
								<TextField value={name} onChange={setName} className="flex min-w-0 flex-1 flex-col gap-1">
									<Label className="text-xs font-bold text-data-dashboard-ink">{t("dashboard.save_view_as", "Save this view as")}</Label>
									<Input className={`min-h-[36px] rounded-lg border border-brand-border-control px-2 text-sm ${FOCUS_RING}`} />
								</TextField>
								<Button type="submit" className={SECONDARY_BUTTON}>{t("dashboard.save", "Save")}</Button>
							</form>
							{views.length === 0 ? (
								<p className="m-0 text-xs text-brand-text-muted">{t("dashboard.no_saved_views", "No saved views yet. They stay in this browser.")}</p>
							) : (
								<ul className="m-0 flex list-none flex-col gap-1 p-0">
									{views.map((v) => (
										<li key={v.name}>
											<Button
												className={`w-full rounded-lg px-2 py-1 text-start text-sm text-brand-interactive data-[hovered]:bg-data-dashboard-tint ${FOCUS_RING}`}
												onPress={() => { close(); navigate(v.href); }}
											>
												{v.name}
											</Button>
										</li>
									))}
								</ul>
							)}
						</>
					)}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}

function ShortcutsHelp({ t, open, onOpenChange }: { t: T; open: boolean; onOpenChange: (o: boolean) => void }) {
	const rows: [string, string][] = [
		["1 – 4", t("dashboard.shortcut_views", "Switch view: Sectors, Hazardous events, Disaster events, Disaster impact")],
		["/", t("dashboard.shortcut_filters", "Go to the filters")],
		["?", t("dashboard.shortcut_help", "Show these shortcuts")],
	];
	return (
		<DialogTrigger isOpen={open} onOpenChange={onOpenChange}>
			<Button data-print="hide" aria-label={t("dashboard.keyboard_shortcuts", "Keyboard shortcuts")} className={SECONDARY_BUTTON}>?</Button>
			<Popover className="delta-layer w-80 p-3">
				<Dialog aria-label={t("dashboard.keyboard_shortcuts", "Keyboard shortcuts")} className="outline-none">
					<table className="w-full text-sm">
						<tbody>
							{rows.map(([k, what]) => (
								<tr key={k}>
									<th scope="row" className="py-1 pe-3 text-start"><kbd className="rounded border border-brand-border px-1.5 font-bold">{k}</kbd></th>
									<td className="py-1">{what}</td>
								</tr>
							))}
						</tbody>
					</table>
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}

/** UX-5: one line after a change, with Undo; gone after 10 s or when dismissed. */
export function WhatChanged({ ctx, summary }: { ctx: ViewContext; summary: string }) {
	const t: T = (code, msg, r) => ctx.t({ code, msg }, r);
	const location = useLocation();
	const navType = useNavigationType();
	const navigate = useNavigate();
	const first = useRef(true);
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		if (navType !== "PUSH") return;
		setShown(true);
		const timer = setTimeout(() => setShown(false), 10_000);
		return () => clearTimeout(timer);
	}, [location.search, navType]);
	if (!UX[5] || !shown) return null;
	return (
		<p role="status" data-print="hide" className="m-0 flex flex-wrap items-center gap-2 rounded-lg border border-data-dashboard-border bg-data-dashboard-surface px-3 py-1.5 text-sm text-data-dashboard-ink">
			<span>{t("dashboard.now_showing", "Now showing: {summary}", { summary })}</span>
			<Button className={`rounded px-1 font-bold text-brand-interactive underline ${FOCUS_RING}`} onPress={() => { setShown(false); navigate(-1); }}>
				{t("dashboard.undo", "Undo")}
			</Button>
			<Button aria-label={t("dashboard.dismiss", "Dismiss")} className={`ms-auto rounded px-1 ${FOCUS_RING}`} onPress={() => setShown(false)}>×</Button>
		</p>
	);
}

export function DashboardTools({
	ctx,
	onViewChange,
	viewsDisabled,
}: {
	ctx: ViewContext;
	onViewChange: (v: DashboardView) => void;
	/** The Sendai toggle turns the view buttons off; the shortcuts follow. */
	viewsDisabled?: boolean;
}) {
	const t: T = (code, msg, r) => ctx.t({ code, msg }, r);
	const [helpOpen, setHelpOpen] = useState(false);
	useEffect(() => {
		if (!UX[7]) return;
		const onKey = (e: KeyboardEvent) => {
			const k = shortcutFor(e, e.target);
			if (!k) return;
			if (k === "?") setHelpOpen(true);
			else if (k === "/") {
				const first = document.querySelector<HTMLElement>(`#${FILTERS_ID} select, #${FILTERS_ID} input, #${FILTERS_ID} button`);
				if (first) {
					e.preventDefault();
					first.focus();
				}
			} else if (!viewsDisabled) onViewChange(DASHBOARD_VIEWS[Number(k) - 1]);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onViewChange, viewsDisabled]);
	return (
		<>
			{UX[2] && <CopyLink t={t} />}
			{UX[6] && <SavedViews t={t} />}
			{UX[7] && <ShortcutsHelp t={t} open={helpOpen} onOpenChange={setHelpOpen} />}
		</>
	);
}
