// Unsaved-change warning for data-entry forms (TR-251). Once the user has
// edited a field, leaving the page asks first: the browser's own prompt
// when the tab is closed or reloaded, and a dialog for a move inside DELTA.
// Saving the form never asks.
import React, { useCallback, useEffect, useRef } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useBlocker, useNavigation, type Blocker, type BlockerFunction } from "react-router";
import type { ViewContext } from "~/frontend/context";

export interface NavigationGuardState {
	dirty: boolean;
	submitting: boolean;
	currentPathname: string;
	nextPathname: string;
}

/**
 * True when a navigation should stop to ask: there are edits, the form is
 * not being saved, and the move leaves the page (a change of query string
 * on the same page, such as a tab, does not ask).
 */
export function shouldBlockNavigation(s: NavigationGuardState): boolean {
	return s.dirty && !s.submitting && s.currentPathname !== s.nextPathname;
}

/**
 * Watches the inputs inside `containerRef` (edits bubble up as input and
 * change events) and the form that contains them. Returns the router
 * blocker for UnsavedChangesDialog.
 */
export function useUnsavedChangesGuard(containerRef: React.RefObject<HTMLElement | null>): Blocker {
	const dirty = useRef(false);
	const submitting = useRef(false);
	const navigation = useNavigation();

	// A save that comes back with errors stays on the page: guard again.
	useEffect(() => {
		if (navigation.state === "idle") submitting.current = false;
	}, [navigation.state]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const form = container.closest("form");
		const onEdit = () => {
			dirty.current = true;
		};
		const onSubmit = () => {
			submitting.current = true;
		};
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!dirty.current || submitting.current) return;
			event.preventDefault();
			// Older browsers need returnValue set to show their prompt.
			event.returnValue = "";
		};
		container.addEventListener("input", onEdit);
		container.addEventListener("change", onEdit);
		form?.addEventListener("submit", onSubmit);
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			container.removeEventListener("input", onEdit);
			container.removeEventListener("change", onEdit);
			form?.removeEventListener("submit", onSubmit);
			window.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, [containerRef]);

	const shouldBlock = useCallback<BlockerFunction>(
		({ currentLocation, nextLocation }) =>
			shouldBlockNavigation({
				dirty: dirty.current,
				submitting: submitting.current,
				currentPathname: currentLocation.pathname,
				nextPathname: nextLocation.pathname,
			}),
		[],
	);
	return useBlocker(shouldBlock);
}

/** Asks before leaving a form with unsaved changes. */
export function UnsavedChangesDialog({ ctx, blocker }: { ctx: ViewContext; blocker: Blocker }) {
	const isOpen = blocker.state === "blocked";
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const buttonClass =
		"rounded border px-3 py-1 data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";
	return (
		<ModalOverlay
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open && blocker.state === "blocked") blocker.reset();
			}}
			isDismissable
			className="fixed inset-0 z-50 flex items-center justify-center bg-brand-text/30 p-4"
		>
			<Modal className="w-full max-w-md rounded border border-brand-border bg-brand-surface p-4 shadow">
				<Dialog role="alertdialog" className="flex flex-col gap-3 outline-none">
					<Heading slot="title" className="m-0 text-lg font-semibold text-brand-text">
						{t("form.unsaved_title", "Leave without saving?")}
					</Heading>
					<p className="m-0 text-sm text-brand-text-muted">
						{t("form.unsaved_body", "Your changes on this form are not saved. If you leave now, they are lost.")}
					</p>
					<div className="flex justify-end gap-2">
						<Button
							autoFocus
							onPress={() => blocker.state === "blocked" && blocker.reset()}
							className={`${buttonClass} border-brand-interactive bg-brand-interactive text-brand-text-on-interactive`}
						>
							{t("form.unsaved_stay", "Stay on this form")}
						</Button>
						<Button
							onPress={() => blocker.state === "blocked" && blocker.proceed()}
							className={`${buttonClass} border-brand-border-control bg-brand-surface text-brand-text`}
						>
							{t("form.unsaved_leave", "Leave without saving")}
						</Button>
					</div>
				</Dialog>
			</Modal>
		</ModalOverlay>
	);
}
