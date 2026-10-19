// The page heading of each main section (Alex, 2026-10-19): "Delta
// Resilience | Data Entry", "Data Analysis" (2026-10-20) and "Delta
// Resilience | Geoportal", in capitals,
// extra bold, 4pt above the Analysis heading's old size (text-2xl, 21px,
// 15.75pt, so 19.75pt). The words stay in normal case for screen readers
// and translation; the capitals are CSS.
import { useLocation } from "react-router";
import type { ViewContext } from "~/frontend/context";

export type BrandSection = "data" | "analysis" | "geoportal";

/** Paths whose pages are Data Entry: the three record lists and every page under them. */
export const DATA_ENTRY_PATHS = ["/hazardous-event", "/disaster-event", "/disaster-record"] as const;

export function isDataEntryPath(pathname: string): boolean {
	// Paths carry the language first: /en/disaster-record/...
	const rest = pathname.replace(/^\/[a-z]{2}(-debug)?(?=\/|$)/, "");
	return DATA_ENTRY_PATHS.some((p) => rest === p || rest.startsWith(`${p}/`));
}

/** True on a Data Entry page, where the page's own title steps down to a second-level heading. */
export function useIsDataEntryPage(): boolean {
	return isDataEntryPath(useLocation().pathname);
}

export function brandTitle(ctx: Pick<ViewContext, "t">, section: BrandSection): string {
	// Analysis reads "Data Analysis" alone (Alex, 2026-10-20); the logo above names DELTA Resilience.
	if (section === "analysis") return ctx.t({ code: "brand.data_analysis", msg: "Data Analysis" });
	const name = ctx.t({ code: "brand.name", msg: "Delta Resilience" });
	const part =
		section === "data"
			? ctx.t({ code: "brand.data_entry", msg: "Data Entry" })
			: ctx.t({ code: "brand.geoportal", msg: "Geoportal" });
	return `${name} | ${part}`;
}

export function PageBrand({ ctx, section, className = "" }: { ctx: Pick<ViewContext, "t">; section: BrandSection; className?: string }) {
	return (
		<h1 className={`delta-page-brand m-0 ${className}`} data-brand-section={section}>
			{brandTitle(ctx, section)}
		</h1>
	);
}
