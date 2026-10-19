// The left hazard rail of the Analysis dashboard (Alex, 2026-10-17: the
// "Command Rail" of Geoportal mockup option A). One radio button per HIPs
// hazard type, with its icon in the type's identity colour (NFR-094; Alex
// 2026-10-18), a short name and, where it counts records, a count. "All
// hazards" stays in the dashboard blue.
// Choosing a type sets the hazard filter for the whole page; "All hazards"
// clears it. On a phone the rail becomes a scrolling row above the content.
import { Label, Radio, RadioGroup } from "react-aria-components";
import { HAZARD_ICONS } from "~/frontend/charts/dashboardIcons";
import { PanelIcon } from "~/frontend/charts/PanelIcon";
import type { ViewContext } from "~/frontend/context";
import type { HazardTree } from "~/frontend/geoportal/GeoFilterBar";
import type { DeltaQuery } from "~/utils/deltaQuery";
import { hazardColourVar, hazardIdentity, type HazardIdentity } from "~/utils/hazardIdentity";

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
		"group relative flex w-[88px] shrink-0 cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent px-1 py-2 text-center text-[0.8125rem] font-semibold text-data-dashboard-ink transition-colors duration-150 motion-reduce:transition-none data-[hovered]:border-data-dashboard-hover data-[hovered]:bg-data-dashboard-tint data-[selected]:border-brand-interactive data-[selected]:bg-data-dashboard-tint data-[selected]:font-extrabold data-[selected]:before:absolute data-[selected]:before:inset-y-2 data-[selected]:before:-start-px data-[selected]:before:w-1 data-[selected]:before:rounded-e data-[selected]:before:bg-brand-interactive data-[selected]:before:content-[''] data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[disabled]:cursor-default data-[disabled]:opacity-50";
	const types = tree?.types ?? [];
	return (
		<RadioGroup
			value={selected ?? ALL_HAZARDS}
			onChange={(v) => onChange(v === ALL_HAZARDS ? null : v)}
			data-print="hide"
			className="delta-layer flex shrink-0 flex-row gap-1 overflow-x-auto p-2 lg:sticky lg:top-2 lg:flex-col lg:self-start lg:overflow-visible"
		>
			<Label className="sr-only">{t({ code: "dashboard.rail_label", msg: "Hazard type" })}</Label>
			<Radio value={ALL_HAZARDS} className={item}>
				<PanelIcon name={HAZARD_ICONS.all} size={52} />
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
							{/* Each type in its own identity colour (Alex, 2026-10-18), a distinct icon and its name. */}
							<PanelIcon name={HAZARD_ICONS[identity]} size={52} colour={hazardColourVar(ty.id)} />
							{showCounts && !empty && (
								<span
									aria-hidden="true"
									className="absolute -top-2 start-10 rounded-full bg-brand-interactive px-1.5 text-[11px] font-bold leading-4 tabular-nums whitespace-nowrap text-brand-text-on-interactive"
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
