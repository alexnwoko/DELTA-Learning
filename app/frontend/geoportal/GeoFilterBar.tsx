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
	Input,
	Label,
	ListBox,
	ListBoxItem,
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
}

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const ALL = "__all__";

function SelectField(props: {
	label: string;
	value: string;
	options: { id: string; label: string; disabled?: boolean }[];
	onChange: (id: string) => void;
}) {
	return (
		<Select
			selectedKey={props.value}
			disabledKeys={props.options.filter((o) => o.disabled).map((o) => o.id)}
			onSelectionChange={(k: Key | null) =>
				k !== null && props.onChange(String(k))
			}
			className="flex flex-col gap-1 min-w-0"
		>
			<Label className="text-xs font-semibold">{props.label}</Label>
			<Button className="border rounded px-2 py-1 text-left min-w-36 max-w-64 truncate bg-white data-[focus-visible]:outline data-[focus-visible]:outline-2">
				<SelectValue />
			</Button>
			<Popover className="bg-white border rounded shadow">
				<ListBox items={props.options} className="max-h-72 overflow-auto">
					{(o) => (
						<ListBoxItem
							id={o.id}
							className="px-2 py-1 cursor-pointer data-[focused]:bg-blue-50 data-[selected]:font-semibold data-[disabled]:text-gray-400 data-[disabled]:cursor-default"
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
}) {
	const [text, setText] = useState(props.value);
	useEffect(() => setText(props.value), [props.value]);
	const invalid = text !== "" && !DATE.test(text);
	return (
		<TextField
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
				className="border rounded px-2 py-1 w-28 data-[invalid]:border-red-700"
			/>
			<FieldError className="text-xs text-red-800">
				{props.t({
					code: "geoportal.when.invalid",
					msg: "Use YYYY, YYYY-MM or YYYY-MM-DD",
				})}
			</FieldError>
		</TextField>
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
	const presets = [
		{
			id: "all",
			label: t({ code: "geoportal.when.all", msg: "All years" }),
			from: "",
			to: "",
		},
		{
			id: "10",
			label: t({ code: "geoportal.when.last10", msg: "Last 10 years" }),
			from: String(thisYear - 9),
			to: String(thisYear),
		},
		{
			id: "5",
			label: t({ code: "geoportal.when.last5", msg: "Last 5 years" }),
			from: String(thisYear - 4),
			to: String(thisYear),
		},
	];

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
			<Group label={t({ code: "geoportal.group.what", msg: "What" })}>
				<div className="flex flex-col gap-1">
					<span className="text-xs font-semibold" id="geo-dim-label">
						{t({ code: "geoportal.group.dimension", msg: "Dimension" })}
					</span>
					<ToggleButtonGroup
						aria-labelledby="geo-dim-label"
						selectionMode="single"
						disallowEmptySelection
						selectedKeys={[query.dimension]}
						onSelectionChange={(keys) => {
							const [first] = Array.from(keys);
							if (first) setDimension(first as QueryDimension);
						}}
						className="flex rounded border overflow-hidden"
					>
						{(Object.keys(GEO_DIMENSION_LABELS) as QueryDimension[]).map(
							(d) => (
								<ToggleButton
									key={d}
									id={d}
									className="px-3 py-1 bg-white data-[selected]:bg-blue-700 data-[selected]:text-white data-[focus-visible]:outline data-[focus-visible]:outline-2"
								>
									{t(GEO_DIMENSION_LABELS[d])}
								</ToggleButton>
							),
						)}
					</ToggleButtonGroup>
				</div>
				<SelectField
					label={t({ code: "geoportal.group.measure", msg: "Measure" })}
					value={query.measure ?? geoMeasuresFor(query.dimension)[0]}
					options={geoMeasuresFor(query.dimension).map((m) => ({
						id: m,
						label: t(geoMeasureInfo(m).label),
					}))}
					onChange={(m) => set({ measure: m as DeltaQuery["measure"] })}
				/>
			</Group>

			<Group label={t({ code: "geoportal.group.where", msg: "Where" })}>
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
			</Group>

			<Group label={t({ code: "geoportal.group.when", msg: "When" })}>
				<SelectField
					label={t({ code: "geoportal.when.period", msg: "Period" })}
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
				/>
				<DateField
					label={t({ code: "geoportal.when.to", msg: "To" })}
					value={to}
					onCommit={(v) => setTime(from || undefined, v || undefined)}
					t={t}
				/>
			</Group>

			{tree && (
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
									className={`inline-flex items-center justify-center w-4 h-4 border rounded text-xs leading-none ${isSelected ? "bg-blue-700 border-blue-700 text-white" : "bg-white"}`}
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
		</div>
	);
}
