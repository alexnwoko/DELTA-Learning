// The left hazard rail of the Analysis dashboard (Alex, 2026-10-17: the
// "Command Rail" of Geoportal mockup option A). One radio button per HIPs
// hazard type, with its identity glyph and colour (NFR-094: identity, never
// a series colour), a short name and, where it counts records, a count.
// Choosing a type sets the hazard filter for the whole page; "All hazards"
// clears it. On a phone the rail becomes a scrolling row above the content.
import type React from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { HAZARD_ICONS } from "~/frontend/charts/dashboardIcons";
import { PanelIcon } from "~/frontend/charts/PanelIcon";
import type { ViewContext } from "~/frontend/context";
import type { HazardTree } from "~/frontend/geoportal/GeoFilterBar";
import type { DeltaQuery } from "~/utils/deltaQuery";
import { hazardIdentity, type HazardIdentity } from "~/utils/hazardIdentity";

export const ALL_HAZARDS = "all";

/** Short names for the rail, as in mockup option A; the full name is the accessible name. */
const SHORT: Record<HazardIdentity, [string, string]> = {
	meteorologicalHydrological: ["dashboard.rail_hydromet", "Hydro-Met"],
	extraterrestrial: ["dashboard.rail_extraterrestrial", "Extra-terr."],
	geological: ["dashboard.rail_geological", "Geological"],
	environmental: ["dashboard.rail_environmental", "Environ."],
	chemical: ["dashboard.rail_chemical", "Chemical"],
	biological: ["dashboard.rail_biological", "Biological"],
	technological: ["dashboard.rail_technological", "Techno."],
	societal: ["dashboard.rail_societal", "Societal"],
	unclassified: ["dashboard.rail_unclassified", "Unclassified"],
};

/** Simple shapes, so a hazard reads by shape as well as colour (WCAG 1.4.1). */
function Glyph({ identity }: { identity: HazardIdentity | "all" }) {
	const fill =
		identity === "all"
			? "currentColor"
			: `var(--delta-data-hazard-${identity.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;
	const shape: Record<string, React.ReactNode> = {
		all: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
		meteorologicalHydrological: <path d="M10 2c3 4 6 7 6 10a6 6 0 0 1-12 0c0-3 3-6 6-10z" />,
		extraterrestrial: <path d="M10 1l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 14.6 4.6 17.5l1.2-6L1.3 7.3l6.1-.7z" />,
		geological: <path d="M10 2l8.5 15h-17z" />,
		environmental: <path d="M17 3C8 3 3 8 3 15c0 1 .2 1.6.5 2C5 11 9 8 13 7c-3 2-6 5-7.5 10H8c1-3 2-5 4-6 4-1 5-4 5-8z" />,
		chemical: <path d="M7 2h6v2h-1v4l5 8.5A1.7 1.7 0 0 1 15.5 19h-11A1.7 1.7 0 0 1 3 16.5L8 8V4H7z" />,
		biological: <path d="M10 1.5l7.4 4.25v8.5L10 18.5l-7.4-4.25v-8.5z" />,
		technological: <path d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM9 1h2l.5 2.6 2.2.9 2.2-1.5 1.4 1.4-1.5 2.2.9 2.2 2.6.5v2l-2.6.5-.9 2.2 1.5 2.2-1.4 1.4-2.2-1.5-2.2.9L11 19H9l-.5-2.6-2.2-.9-2.2 1.5-1.4-1.4 1.5-2.2-.9-2.2L1 11V9l2.6-.5.9-2.2L3 4.1l1.4-1.4 2.2 1.5 2.2-.9z" />,
		societal: <path d="M10 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM3 18c0-4 3-7 7-7s7 3 7 7z" />,
		unclassified: <circle cx="10" cy="10" r="7" />,
	};
	return (
		<svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={{ fill }}>
			{shape[identity]}
		</svg>
	);
}

/** The query with a hazard type chosen (finer levels cleared) or cleared. */
export function withHazardType(query: DeltaQuery, typeId: string | null): DeltaQuery {
	const where = { ...query.where };
	if (typeId) where.hazard = { typeId };
	else delete where.hazard;
	return { ...query, where };
}

export interface HazardRailProps {
	ctx: ViewContext;
	tree: HazardTree | null;
	/** The selected HIPs type, or null for all hazards. */
	selected: string | null;
	onChange: (typeId: string | null) => void;
	/** Show the record count per type (record views); false on event views. */
	showCounts: boolean;
}

export function HazardRail({ ctx, tree, selected, onChange, showCounts }: HazardRailProps) {
	const t = ctx.t;
	const n = (x: number) => x.toLocaleString(ctx.lang);
	const item =
		"group relative flex w-20 shrink-0 cursor-pointer flex-col items-center gap-1 rounded border border-transparent px-1 py-2 text-center text-xs text-brand-text data-[hovered]:bg-brand-surface-subtle data-[selected]:border-brand-interactive data-[selected]:bg-brand-surface-subtle data-[selected]:font-semibold data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[disabled]:cursor-default data-[disabled]:opacity-50";
	const types = tree?.types ?? [];
	return (
		<RadioGroup
			value={selected ?? ALL_HAZARDS}
			onChange={(v) => onChange(v === ALL_HAZARDS ? null : v)}
			data-print="hide"
			className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-brand-border pb-2 lg:sticky lg:top-2 lg:flex-col lg:self-start lg:overflow-visible lg:border-b-0 lg:border-e lg:pb-0 lg:pe-2"
		>
			<Label className="sr-only">{t({ code: "dashboard.rail_label", msg: "Hazard type" })}</Label>
			<Radio value={ALL_HAZARDS} className={item}>
				<Glyph identity="all" />
				<span>{t({ code: "dashboard.rail_all", msg: "All hazards" })}</span>
			</Radio>
			{types.map((ty) => {
				const identity = hazardIdentity(ty.id);
				const [code, msg] = SHORT[identity];
				// A type with no record in scope is disabled, not hidden, and shows no 0.
				const empty = showCounts && ty.recordCountSubtree === 0;
				return (
					<Radio
						key={ty.id}
						value={ty.id}
						aria-label={
							showCounts && !empty
								? t({ code: "dashboard.rail_name_count", msg: "{name}, {n} records" }, { name: ty.name, n: n(ty.recordCountSubtree) })
								: ty.name
						}
						isDisabled={empty}
						className={item}
					>
						{/* The count sits at the glyph's top-right corner, as in the mockup. */}
						<span className="relative inline-flex">
							{/* OCHA's hazard icon in the identity colour; our own shape where OCHA has none. */}
							{HAZARD_ICONS[identity] ? (
								<PanelIcon
									name={HAZARD_ICONS[identity] as NonNullable<(typeof HAZARD_ICONS)[string]>}
									size={20}
									colour={`var(--delta-data-hazard-${identity.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`}
								/>
							) : (
								<Glyph identity={identity} />
							)}
							{showCounts && !empty && (
								<span
									aria-hidden="true"
									className="absolute -top-2 start-3.5 rounded-full bg-brand-interactive px-1 text-[10px] leading-4 whitespace-nowrap text-brand-text-on-interactive"
								>
									{n(ty.recordCountSubtree)}
								</span>
							)}
						</span>
						<span aria-hidden="true">{t({ code, msg })}</span>
					</Radio>
				);
			})}
		</RadioGroup>
	);
}

export default HazardRail;
