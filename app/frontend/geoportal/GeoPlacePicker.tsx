// Place pickers beside the Place tab (Alex, 2026-10-18): admin 1, then
// admin 2 scoped to the chosen admin 1. "Whole country" is the default; the
// Place panel follows whatever is chosen here or clicked on the map.
import {
	Button,
	Label,
	ListBox,
	ListBoxItem,
	Popover,
	Select,
	SelectValue,
	type Key,
} from "react-aria-components";
import { plainT, type GeoT } from "~/frontend/geoportal/i18n";

export interface PlaceOption {
	id: string;
	name: string;
	level: number;
	parentId: string | null;
}

const NONE = "__none__";

/** The admin-1 and admin-2 ids that show `shownId` (null = whole country). */
export function pickerValues(
	shownId: string | null,
	options: readonly PlaceOption[],
): { first: string | null; second: string | null } {
	if (!shownId) return { first: null, second: null };
	const o = options.find((x) => x.id === shownId);
	if (!o) return { first: null, second: null };
	if (o.level === 1) return { first: o.id, second: null };
	if (o.level === 2) return { first: o.parentId, second: o.id };
	return { first: null, second: null };
}

function Picker(props: {
	label: string;
	value: string;
	items: { id: string; name: string }[];
	onChange: (id: string) => void;
	isDisabled?: boolean;
}) {
	return (
		<Select
			aria-label={props.label}
			selectedKey={props.value}
			isDisabled={props.isDisabled}
			onSelectionChange={(k: Key | null) =>
				k !== null && props.onChange(String(k))
			}
			className="min-w-0"
		>
			<Label className="sr-only">{props.label}</Label>
			<Button className="border border-brand-border-control rounded px-2 py-1 text-sm text-start max-w-40 truncate bg-brand-surface data-[disabled]:opacity-60 data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring">
				<SelectValue />
			</Button>
			<Popover className="bg-brand-surface border border-brand-border-control rounded shadow">
				<ListBox items={props.items} className="max-h-72 overflow-auto">
					{(o) => (
						<ListBoxItem
							id={o.id}
							className="px-2 py-1 cursor-pointer data-[focused]:bg-brand-surface-subtle data-[selected]:font-semibold data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
						>
							{o.name}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</Select>
	);
}

export function GeoPlacePicker(props: {
	options: readonly PlaceOption[];
	/** The place the panel shows; null is the whole country. */
	shownId: string | null;
	onPick: (id: string | null) => void;
	t?: GeoT;
}) {
	const t = props.t ?? plainT;
	const { first, second } = pickerValues(props.shownId, props.options);
	const level1 = props.options.filter((o) => o.level === 1);
	const level2 = first
		? props.options.filter((o) => o.level === 2 && o.parentId === first)
		: [];
	return (
		<div className="flex items-center gap-1" data-print="hide">
			<Picker
				label={t({ code: "geoportal.picker.admin1", msg: "Admin 1 area" })}
				value={first ?? NONE}
				items={[
					{
						id: NONE,
						name: t({
							code: "geoportal.picker.whole_country",
							msg: "Whole country",
						}),
					},
					...level1,
				]}
				onChange={(id) => props.onPick(id === NONE ? null : id)}
			/>
			<Picker
				label={t({ code: "geoportal.picker.admin2", msg: "Admin 2 area" })}
				value={second ?? NONE}
				isDisabled={!first || level2.length === 0}
				items={[
					{
						id: NONE,
						name: t({
							code: "geoportal.picker.all_admin2",
							msg: "All admin 2",
						}),
					},
					...level2,
				]}
				onChange={(id) => props.onPick(id === NONE ? first : id)}
			/>
		</div>
	);
}
