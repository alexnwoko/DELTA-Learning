// Question bar for the geoportal (review R05): What (dimension, measure),
// Where (map level), When (validated period with presets), Hazard (type,
// cluster, hazard from the HIPs tree, TR-170) and, for reviewers only, the
// provisional basis (AB-01). Every change rewrites the URL as delta.query/1
// plus the geo view parameter `level` (TR-175).
import { useEffect, useState } from "react";
import {
	Button,
	Checkbox,
	FieldError,
	Header,
	Input,
	Label,
	ListBox,
	ListBoxItem,
	ListBoxSection,
	Popover,
	Select,
	SelectValue,
	TextField,
	ToggleButton,
	ToggleButtonGroup,
	type Key,
} from "react-aria-components";

import type { DeltaQuery, QueryDimension } from "~/utils/deltaQuery";
import {
	GEO_DIMENSION_LABELS,
	GEO_MEASURE_INFO,
	geoMeasureInfo,
	geoMeasuresFor,
} from "~/utils/geoMeasures";
import { fmt, plainT, type GeoT } from "~/frontend/geoportal/i18n";
import {
	applyChips,
	applyPlace,
	lockedFacets,
	periodPresets,
	PLACE_ALL,
	placeKey,
	querySummary,
	selectedChips,
	type ChipSet,
	type LockedFilters,
	type PlaceOptions,
} from "~/frontend/geoportal/filterBarState";
import type { GeoLabel } from "~/utils/geoMeasures";

export type { ChipSet, LockedFilters, PlaceOptions };

/** English labels, kept for callers that render outside a translator. */
export const DIMENSION_LABELS: Record<QueryDimension, string> = {
	hazardous_event: GEO_DIMENSION_LABELS.hazardous_event.msg,
	disaster_event: GEO_DIMENSION_LABELS.disaster_event.msg,
	disaster_impact: GEO_DIMENSION_LABELS.disaster_impact.msg,
};

export const MEASURE_LABELS: Record<string, string> = Object.fromEntries(
	Object.entries(GEO_MEASURE_INFO).map(([k, v]) => [k, v.label.msg]),
);

export interface HazardNode {
	id: string;
	name: string;
	recordCountSubtree: number;
}

export interface HazardTree {
	types: HazardNode[];
	clusters: (HazardNode & { typeId: string })[];
	hazards: (HazardNode & { clusterId: string; code: string })[];
}

export interface GeoFilterBarProps {
	query: DeltaQuery;
	level: number;
	levels: readonly number[];
	canReview: boolean;
	onChange: (next: { query: DeltaQuery; level: number }) => void;
	hazardTree?: HazardTree | null;
	/** Year used for the period presets; defaults to the current year. */
	thisYear?: number;
	t?: GeoT;
	// Shared-bar props for D1 (contract v0.1, section 2.2). All optional; the
	// defaults keep the geoportal's behaviour.
	/** "none" when the page renders the dimension as its own tab list. */
	dimensionControl?: "toggle" | "none";
	/** Measure options; null hides the select. Default: geo measures. */
	measures?: { id: string; label: GeoLabel }[] | null;
	/** Sub-category buttons (contract section 3). */
	chips?: ChipSet | null;
	/** Division or region, never both (contract section 4). */
	place?: PlaceOptions | null;
	/** The geoportal's map level select. */
	levelControl?: boolean;
	/** Year spans of the period presets, after "All years". */
	presets?: readonly number[];
	/** Same object the page gives withLockedFilters; shown read-only. */
	locked?: LockedFilters;
	/** meta.notApplied from the last response, shown as chips. */
	notApplied?: readonly string[];
	/** One line of scope and basis; scopeLabel names the instance. */
	summary?: boolean;
	scopeLabel?: string;
}

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const ALL = "__all__";

function SelectField(props: {
	label: string;
	value: string;
	options: { id: string; label: string; disabled?: boolean }[];
	onChange: (id: string) => void;
	isDisabled?: boolean;
}) {
	return (
		<Select
			isDisabled={props.isDisabled}
			selectedKey={props.value}
			disabledKeys={props.options.filter((o) => o.disabled).map((o) => o.id)}
			onSelectionChange={(k: Key | null) =>
				k !== null && props.onChange(String(k))
			}
			className="flex flex-col gap-1 min-w-0"
		>
			<Label className="text-xs font-semibold">{props.label}</Label>
			<Button className="border border-brand-border-control rounded px-2 py-1 text-start min-w-36 max-w-64 truncate bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring">
				<SelectValue />
			</Button>
			<Popover className="bg-brand-surface border border-brand-border-control rounded shadow">
				<ListBox items={props.options} className="max-h-72 overflow-auto">
					{(o) => (
						<ListBoxItem
							id={o.id}
							className="px-2 py-1 cursor-pointer data-[focused]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[selected]:font-semibold data-[disabled]:text-brand-text-muted data-[disabled]:opacity-60 data-[disabled]:cursor-default"
						>
							{o.label}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</Select>
	);
}

function DateField(props: {
	label: string;
	value: string;
	onCommit: (v: string) => void;
	t: GeoT;
	isDisabled?: boolean;
}) {
	const [text, setText] = useState(props.value);
	useEffect(() => setText(props.value), [props.value]);
	const invalid = text !== "" && !DATE.test(text);
	return (
		<TextField
			isDisabled={props.isDisabled}
			value={text}
			onChange={setText}
			isInvalid={invalid}
			onBlur={() => !invalid && text !== props.value && props.onCommit(text)}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !invalid) props.onCommit(text);
			}}
			className="flex flex-col gap-1"
		>
			<Label className="text-xs font-semibold">{props.label}</Label>
			<Input
				placeholder="YYYY"
				className="border border-brand-border-control rounded px-2 py-1 w-28 data-[invalid]:border-brand-danger"
			/>
			<FieldError className="text-xs text-brand-danger">
				{props.t({
					code: "geoportal.when.invalid",
					msg: "Use YYYY, YYYY-MM or YYYY-MM-DD",
				})}
			</FieldError>
		</TextField>
	);
}

const itemClass =
	"px-2 py-1 cursor-pointer data-[focused]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring data-[selected]:font-semibold";

/** One "Area" control: all areas, a division or a region (contract s4). */
function PlaceField(props: {
	place: PlaceOptions;
	value: string;
	onChange: (key: string) => void;
	isDisabled?: boolean;
	t: GeoT;
}) {
	const { t } = props;
	const divisions = props.place.divisions ?? [];
	const regions = props.place.regions ?? [];
	return (
		<Select
			isDisabled={props.isDisabled}
			selectedKey={props.value}
			onSelectionChange={(k: Key | null) =>
				k !== null && props.onChange(String(k))
			}
			className="flex flex-col gap-1 min-w-0"
		>
			<Label className="text-xs font-semibold">
				{t({ code: "geoportal.place.area", msg: "Area" })}
			</Label>
			<Button className="border border-brand-border-control rounded px-2 py-1 text-start min-w-36 max-w-64 truncate bg-brand-surface data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring">
				<SelectValue />
			</Button>
			<Popover className="bg-brand-surface border border-brand-border-control rounded shadow">
				<ListBox className="max-h-72 overflow-auto">
					<ListBoxItem id={PLACE_ALL} className={itemClass}>
						{t({ code: "geoportal.place.all", msg: "All areas" })}
					</ListBoxItem>
					{divisions.length > 0 && (
						<ListBoxSection>
							<Header className="px-2 pt-2 text-xs font-semibold text-brand-text-muted">
								{t({ code: "geoportal.place.divisions", msg: "Divisions" })}
							</Header>
							{divisions.map((d) => (
								<ListBoxItem key={d.id} id={`d:${d.id}`} className={itemClass}>
									{d.name}
								</ListBoxItem>
							))}
						</ListBoxSection>
					)}
					{regions.length > 0 && (
						<ListBoxSection>
							<Header className="px-2 pt-2 text-xs font-semibold text-brand-text-muted">
								{t({ code: "geoportal.place.regions", msg: "Regions" })}
							</Header>
							{regions.map((r) => (
								<ListBoxItem
									key={r.regionId}
									id={`r:${r.regionId}`}
									className={itemClass}
								>
									{r.name}
								</ListBoxItem>
							))}
						</ListBoxSection>
					)}
				</ListBox>
			</Popover>
		</Select>
	);
}

/** Sub-category buttons (contract s3). A zero count disables a chip; null shows no number. */
function ChipGroup(props: {
	chips: ChipSet;
	selected: string[];
	onChange: (selected: string[]) => void;
	isDisabled?: boolean;
	t: GeoT;
}) {
	const { chips, t } = props;
	const single = chips.kind === "hip_type";
	const label =
		chips.kind === "hip_type"
			? t({ code: "geoportal.chips.hip_type", msg: "Hazard type" })
			: chips.kind === "effect"
				? t({ code: "geoportal.chips.effect", msg: "Effect" })
				: t({ code: "geoportal.chips.sector", msg: "Sector" });
	const options = chips.options.map((o) => {
		if (chips.kind === "hip_type") {
			const h = o as Extract<ChipSet, { kind: "hip_type" }>["options"][number];
			return {
				id: h.id,
				text: h.count === null ? h.label : `${h.label} (${fmt(h.count)})`,
				disabled: h.count === 0,
				color: h.colorToken,
			};
		}
		if (chips.kind === "effect") {
			const e = o as Extract<ChipSet, { kind: "effect" }>["options"][number];
			return { id: e.id as string, text: t(e.label), disabled: false };
		}
		const s = o as Extract<ChipSet, { kind: "sector" }>["options"][number];
		return { id: s.id, text: s.label, disabled: false };
	});
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs font-semibold" id={`geo-chips-${chips.kind}`}>
				{label}
			</span>
			<ToggleButtonGroup
				aria-labelledby={`geo-chips-${chips.kind}`}
				selectionMode={single ? "single" : "multiple"}
				isDisabled={props.isDisabled}
				selectedKeys={props.selected}
				onSelectionChange={(keys) =>
					props.onChange(Array.from(keys).map(String))
				}
				className="flex flex-wrap gap-1"
			>
				{options.map((o) => (
					<ToggleButton
						key={o.id}
						id={o.id}
						isDisabled={o.disabled}
						className="inline-flex items-center gap-1 rounded-full border border-brand-border-control px-3 py-0.5 text-sm bg-brand-surface data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[disabled]:opacity-60 data-[disabled]:cursor-default data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
					>
						{"color" in o && o.color && (
							<span
								aria-hidden="true"
								className="inline-block w-2.5 h-2.5 rounded-full"
								style={{ background: o.color }}
							/>
						)}
						{o.text}
					</ToggleButton>
				))}
			</ToggleButtonGroup>
		</div>
	);
}

function Group(props: { label: string; children: React.ReactNode }) {
	return (
		<fieldset className="flex flex-wrap items-end gap-2 border-0 p-0 m-0 min-w-0">
			<legend className="sr-only">{props.label}</legend>
			{props.children}
		</fieldset>
	);
}

export function GeoFilterBar(props: GeoFilterBarProps) {
	const { query, level } = props;
	const t = props.t ?? plainT;
	const set = (patch: Partial<DeltaQuery>, nextLevel = level) =>
		props.onChange({ query: { ...query, ...patch }, level: nextLevel });

	const setDimension = (dimension: QueryDimension) => {
		const measures = geoMeasuresFor(dimension);
		const measure =
			query.measure && measures.includes(query.measure as never)
				? query.measure
				: measures[0];
		set({ dimension, measure: measure as DeltaQuery["measure"] });
	};

	const setTime = (from: string | undefined, to: string | undefined) => {
		const time = { ...(from && { from }), ...(to && { to }) };
		set({
			where: {
				...query.where,
				time: time.from || time.to ? time : undefined,
			},
		});
	};
	const from = query.where.time?.from ?? "";
	const to = query.where.time?.to ?? "";
	const thisYear = props.thisYear ?? new Date().getFullYear();
	const presets = periodPresets(props.presets ?? [10, 5], thisYear).map(
		(p) => ({
			...p,
			label:
				p.years === 0
					? t({ code: "geoportal.when.all", msg: "All years" })
					: p.years === 1
						? t({ code: "geoportal.when.last_1", msg: "Last 1 year" })
						: t(
								{ code: "geoportal.when.last_n", msg: "Last {n} years" },
								{ n: p.years },
							),
		}),
	);
	const locks = new Set(lockedFacets(props.locked));
	const measureOptions =
		props.measures === undefined
			? geoMeasuresFor(query.dimension).map((m) => ({
					id: m as string,
					label: t(geoMeasureInfo(m).label),
				}))
			: props.measures === null
				? null
				: props.measures.map((m) => ({ id: m.id, label: t(m.label) }));

	const hz = query.where.hazard ?? {};
	const tree = props.hazardTree;
	const setHazard = (h: {
		typeId?: string;
		clusterId?: string;
		hazardId?: string;
	}) =>
		set({
			where: {
				...query.where,
				hazard: h.typeId || h.clusterId || h.hazardId ? h : undefined,
			},
		});
	const count = (n: HazardNode) => `${n.name} (${fmt(n.recordCountSubtree)})`;
	const clusterId =
		hz.clusterId ??
		(hz.hazardId
			? tree?.hazards.find((h) => h.id === hz.hazardId)?.clusterId
			: undefined);
	const typeId =
		hz.typeId ??
		(clusterId
			? tree?.clusters.find((c) => c.id === clusterId)?.typeId
			: undefined);

	return (
		<div className="geo-filter-bar flex flex-wrap items-end gap-x-6 gap-y-2 py-2">
			{props.summary && (
				<p
					className="w-full text-sm text-brand-text-muted"
					data-testid="geo-filter-summary"
				>
					{querySummary(
						query,
						{ scopeLabel: props.scopeLabel, hazardTree: tree },
						t,
					)}
				</p>
			)}
			<Group label={t({ code: "geoportal.group.what", msg: "What" })}>
				{props.dimensionControl !== "none" && (
					<div className="flex flex-col gap-1">
						<span className="text-xs font-semibold" id="geo-dim-label">
							{t({ code: "geoportal.group.dimension", msg: "Dimension" })}
						</span>
						<ToggleButtonGroup
							aria-labelledby="geo-dim-label"
							selectionMode="single"
							disallowEmptySelection
							isDisabled={locks.has("dimension")}
							selectedKeys={[query.dimension]}
							onSelectionChange={(keys) => {
								const [first] = Array.from(keys);
								if (first) setDimension(first as QueryDimension);
							}}
							className="flex rounded border border-brand-border-control overflow-hidden"
						>
							{(Object.keys(GEO_DIMENSION_LABELS) as QueryDimension[]).map(
								(d) => (
									<ToggleButton
										key={d}
										id={d}
										className="px-3 py-1 bg-brand-surface data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
									>
										{t(GEO_DIMENSION_LABELS[d])}
									</ToggleButton>
								),
							)}
						</ToggleButtonGroup>
					</div>
				)}
				{measureOptions && measureOptions.length > 0 && (
					<SelectField
						label={t({ code: "geoportal.group.measure", msg: "Measure" })}
						value={query.measure ?? measureOptions[0].id}
						options={measureOptions}
						onChange={(m) => set({ measure: m as DeltaQuery["measure"] })}
					/>
				)}
				{props.chips && props.chips.options.length > 0 && (
					<ChipGroup
						chips={props.chips}
						selected={selectedChips(query, props.chips)}
						isDisabled={
							(props.chips.kind === "hip_type" && locks.has("hazard")) ||
							(props.chips.kind === "effect" && locks.has("effect")) ||
							(props.chips.kind === "sector" && locks.has("sector"))
						}
						onChange={(sel) =>
							props.onChange({
								query: applyChips(query, props.chips as ChipSet, sel),
								level,
							})
						}
						t={t}
					/>
				)}
			</Group>

			<Group label={t({ code: "geoportal.group.where", msg: "Where" })}>
				{props.place && (
					<PlaceField
						place={props.place}
						value={placeKey(query)}
						isDisabled={locks.has("place")}
						onChange={(k) =>
							props.onChange({ query: applyPlace(query, k), level })
						}
						t={t}
					/>
				)}
				{props.levelControl !== false && (
					<SelectField
						label={t({ code: "geoportal.group.level", msg: "Map level" })}
						value={String(level)}
						options={props.levels.map((l) => ({
							id: String(l),
							label: t(
								{ code: "geoportal.dossier.level", msg: "Admin level {n}" },
								{ n: l },
							),
						}))}
						onChange={(l) => props.onChange({ query, level: Number(l) })}
					/>
				)}
			</Group>

			<Group label={t({ code: "geoportal.group.when", msg: "When" })}>
				<SelectField
					label={t({ code: "geoportal.when.period", msg: "Period" })}
					isDisabled={locks.has("period")}
					value={
						presets.find((p) => p.from === from && p.to === to)?.id ?? "custom"
					}
					options={[
						...presets.map((p) => ({ id: p.id, label: p.label })),
						{
							id: "custom",
							label: t({ code: "geoportal.when.custom", msg: "Custom" }),
							disabled: true,
						},
					]}
					onChange={(id) => {
						const p = presets.find((x) => x.id === id);
						if (p) setTime(p.from || undefined, p.to || undefined);
					}}
				/>
				<DateField
					label={t({ code: "geoportal.when.from", msg: "From" })}
					value={from}
					onCommit={(v) => setTime(v || undefined, to || undefined)}
					t={t}
					isDisabled={locks.has("period")}
				/>
				<DateField
					label={t({ code: "geoportal.when.to", msg: "To" })}
					value={to}
					onCommit={(v) => setTime(from || undefined, v || undefined)}
					t={t}
					isDisabled={locks.has("period")}
				/>
			</Group>

			{tree && !locks.has("hazard") && (
				<Group label={t({ code: "geoportal.group.hazard", msg: "Hazard" })}>
					<SelectField
						label={t({ code: "geoportal.hazard.type", msg: "Hazard type" })}
						value={typeId ?? ALL}
						options={[
							{
								id: ALL,
								label: t({ code: "geoportal.hazard.all", msg: "All hazards" }),
							},
							...tree.types.map((n) => ({
								id: n.id,
								label: count(n),
								disabled: n.recordCountSubtree === 0,
							})),
						]}
						onChange={(id) => setHazard(id === ALL ? {} : { typeId: id })}
					/>
					{typeId && (
						<SelectField
							label={t({ code: "geoportal.hazard.cluster", msg: "Cluster" })}
							value={clusterId ?? ALL}
							options={[
								{
									id: ALL,
									label: t({
										code: "geoportal.hazard.all_in_type",
										msg: "All in this type",
									}),
								},
								...tree.clusters
									.filter((c) => c.typeId === typeId)
									.map((n) => ({
										id: n.id,
										label: count(n),
										disabled: n.recordCountSubtree === 0,
									})),
							]}
							onChange={(id) =>
								setHazard(id === ALL ? { typeId } : { clusterId: id })
							}
						/>
					)}
					{clusterId && (
						<SelectField
							label={t({ code: "geoportal.hazard.hazard", msg: "Hazard" })}
							value={hz.hazardId ?? ALL}
							options={[
								{
									id: ALL,
									label: t({
										code: "geoportal.hazard.all_in_cluster",
										msg: "All in this cluster",
									}),
								},
								...tree.hazards
									.filter((h) => h.clusterId === clusterId)
									.map((n) => ({
										id: n.id,
										label: `${n.code} ${count(n)}`,
										disabled: n.recordCountSubtree === 0,
									})),
							]}
							onChange={(id) =>
								setHazard(id === ALL ? { clusterId } : { hazardId: id })
							}
						/>
					)}
				</Group>
			)}

			{props.canReview && (
				<Group label={t({ code: "geoportal.group.basis", msg: "Basis" })}>
					<Checkbox
						isSelected={query.scope.basis === "provisional"}
						onChange={(on) =>
							set({
								scope: {
									...query.scope,
									basis: on ? "provisional" : "published",
								},
							})
						}
						className="flex items-center gap-2 text-sm pb-1"
					>
						{({ isSelected }) => (
							<>
								<span
									aria-hidden="true"
									className={`inline-flex items-center justify-center w-4 h-4 border rounded text-xs leading-none ${isSelected ? "bg-brand-interactive border-brand-interactive text-brand-text-on-interactive" : "bg-brand-surface border-brand-border-control"}`}
								>
									{isSelected ? "✓" : ""}
								</span>
								{t({
									code: "geoportal.basis.provisional",
									msg: "Include data not yet published (Provisional)",
								})}
							</>
						)}
					</Checkbox>
				</Group>
			)}

			{(locks.size > 0 || (props.notApplied?.length ?? 0) > 0) && (
				<ul
					className="w-full flex flex-wrap gap-1 text-xs"
					aria-label={t({
						code: "geoportal.filters.status",
						msg: "Filter status",
					})}
				>
					{[...locks].map((f) => (
						<li
							key={`lock-${f}`}
							className="rounded-full border border-brand-border-control px-2 py-0.5 bg-brand-surface-subtle"
						>
							{t(
								{
									code: "geoportal.filters.locked",
									msg: "Fixed by this page: {facet}",
								},
								{ facet: f },
							)}
						</li>
					))}
					{(props.notApplied ?? []).map((n) => (
						<li
							key={`na-${n}`}
							className="rounded-full border border-brand-border-control px-2 py-0.5"
						>
							{t(
								{
									code: "geoportal.filters.not_applied",
									msg: "Not applied: {filter}",
								},
								{ filter: n },
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
