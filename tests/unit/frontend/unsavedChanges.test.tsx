import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ViewContext } from "~/frontend/context";
import {
	UnsavedChangesDialog,
	shouldBlockNavigation,
	useUnsavedChangesGuard,
} from "~/frontend/form/unsavedChanges";

const base = { dirty: true, submitting: false, currentPathname: "/en/disaster-record/edit/1", nextPathname: "/en/analytics" };

describe("shouldBlockNavigation (TR-251)", () => {
	it("asks when leaving a form with unsaved edits", () => {
		expect(shouldBlockNavigation(base)).toBe(true);
	});
	it("does not ask when nothing was edited", () => {
		expect(shouldBlockNavigation({ ...base, dirty: false })).toBe(false);
	});
	it("does not ask while the form is being saved", () => {
		expect(shouldBlockNavigation({ ...base, submitting: true })).toBe(false);
	});
	it("does not ask for a change of query string on the same page", () => {
		expect(shouldBlockNavigation({ ...base, nextPathname: base.currentPathname })).toBe(false);
	});
});

describe("useUnsavedChangesGuard", () => {
	it("renders on the server inside a router, idle until the user edits", () => {
		const ctx = { t: ({ msg }: { msg: string }) => msg, lang: "en" } as unknown as ViewContext;
		function Probe() {
			const ref = useRef<HTMLDivElement>(null);
			const blocker = useUnsavedChangesGuard(ref);
			return (
				<form>
					<div ref={ref} data-blocker={blocker.state}>
						<input name="x" />
					</div>
					<UnsavedChangesDialog ctx={ctx} blocker={blocker} />
				</form>
			);
		}
		const Stub = createRoutesStub([{ path: "/", Component: Probe }]);
		const html = renderToString(<Stub initialEntries={["/"]} />);
		expect(html).toContain('data-blocker="unblocked"');
		expect(html).not.toContain("Leave without saving?");
	});
});
