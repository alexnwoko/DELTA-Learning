// The page heading of each main section (Alex, 2026-10-19 and 20): the
// section and the country, "Data Analysis | Mozambique", in capitals, extra
// bold, 17.75pt, with 2pt of padding above the text and 1pt below. The words
// stay in normal case for screen readers and translation; the capitals are CSS.
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

/**
 * "Data Entry | Mozambique", "Data Analysis | Mozambique", "Geoportal |
 * Mozambique" (Alex, 2026-10-20): the section, then the country; the logo
 * above names DELTA Resilience. No country, the section alone.
 */
export function brandTitle(ctx: Pick<ViewContext, "t">, section: BrandSection, country?: string | null): string {
	const part =
		section === "data"
			? ctx.t({ code: "brand.data_entry", msg: "Data Entry" })
			: section === "analysis"
				? ctx.t({ code: "brand.data_analysis", msg: "Data Analysis" })
				: ctx.t({ code: "brand.geoportal", msg: "Geoportal" });
	// En spaces round the bar, the spacing Alex wrote.
	return country ? `${part}\u2002|\u2002${country}` : part;
}

export function PageBrand({
	ctx,
	section,
	country,
	className = "",
}: {
	ctx: Pick<ViewContext, "t">;
	section: BrandSection;
	/** The instance's country, shown after the section. */
	country?: string | null;
	className?: string;
}) {
	return (
		<h1 className={`delta-page-brand m-0 ${className}`} data-brand-section={section}>
			{brandTitle(ctx, section, country)}
		</h1>
	);
}
