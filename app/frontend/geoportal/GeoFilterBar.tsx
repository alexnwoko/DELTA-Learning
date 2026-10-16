// Filter bar for the geoportal (increment I-2): the three DELTA dimensions as
// buttons (Alex 2026-10-15), then the measure, map level, period and, for
// reviewers only, the provisional basis (AB-01). Every change rewrites the
// URL as delta.query/1 plus the geo view parameter `level` (TR-175).
import {
	Button,
	Checkbox,
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
import { geoMeasuresFor } from "~/utils/geoMeasures";

export const DIMENSION_LABELS: Record<QueryDimension, string> = {
	hazardous_event: "Hazardous events",
	disaster_event: "Disaster events",
	disaster_impact: "Disaster impact",
};

export const MEASURE_LABELS: Record<string, string> = {
	records: "Disaster impacts (count)",
	deaths: "Deaths",
	injured: "Injured",
	missing: "Missing",
	affected_direct: "Directly affected",
	affected_indirect: "Indirectly affected",
	displaced: "Displaced",
	houses_destroyed: "Houses destroyed",
	houses_damaged: "Houses damaged",
	events: "Events",
};

export interface GeoFilterBarProps {
	query: DeltaQuery;
	level: number;
	levels: readonly number[];
	canReview: boolean;
	onChange: (next: { query: DeltaQuery; level: number }) => void;
}

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function SelectField(props: {
	label: string;
	value: string;
	options: { id: string; label: string }[];
	onChange: (id: string) => void;
}) {
	return (
		<Select
			selectedKey={props.value}
			onSelectionChange={(k: Key | null) =>
				k !== null && props.onChange(String(k))
			}
			className="flex flex-col gap-1"
		>
			<Label className="text-xs font-semibold">{props.label}</Label>
			<Button className="border rounded px-2 py-1 text-left min-w-40 data-[focus-visible]:outline data-[focus-visible]:outline-2">
				<SelectValue />
			</Button>
			<Popover className="bg-white border rounded shadow">
				<ListBox items={props.options} className="max-h-72 overflow-auto">
					{(o) => (
						<ListBoxItem
							id={o.id}
							className="px-2 py-1 cursor-pointer data-[focused]:bg-blue-50 data-[selected]:font-semibold"
						>
							{o.label}
						</ListBoxItem>
					)}
				</ListBox>
			</Popover>
		</Select>
	);
}

export function GeoFilterBar(props: GeoFilterBarProps) {
	const { query, level } = props;
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

	const setDate = (key: "from" | "to", value: string) => {
		if (value !== "" && !DATE.test(value)) return;
		const time = { ...query.where.time, [key]: value || undefined };
		if (!time.from) delete time.from;
		if (!time.to) delete time.to;
		set({
			where: {
				...query.where,
				time: time.from || time.to ? time : undefined,
			},
		});
	};

	return (
		<div className="geo-filter-bar flex flex-wrap items-end gap-4 py-2">
			<ToggleButtonGroup
				aria-label="Dimension"
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[query.dimension]}
				onSelectionChange={(keys) => {
					const [first] = Array.from(keys);
					if (first) setDimension(first as QueryDimension);
				}}
				className="flex rounded border overflow-hidden"
			>
				{(Object.keys(DIMENSION_LABELS) as QueryDimension[]).map((d) => (
					<ToggleButton
						key={d}
						id={d}
						className="px-3 py-1 data-[selected]:bg-blue-700 data-[selected]:text-white data-[focus-visible]:outline data-[focus-visible]:outline-2"
					>
						{DIMENSION_LABELS[d]}
					</ToggleButton>
				))}
			</ToggleButtonGroup>

			<SelectField
				label="Measure"
				value={query.measure ?? geoMeasuresFor(query.dimension)[0]}
				options={geoMeasuresFor(query.dimension).map((m) => ({
					id: m,
					label: MEASURE_LABELS[m] ?? m,
				}))}
				onChange={(m) => set({ measure: m as DeltaQuery["measure"] })}
			/>

			<SelectField
				label="Map level"
				value={String(level)}
				options={props.levels.map((l) => ({
					id: String(l),
					label: `Admin level ${l}`,
				}))}
				onChange={(l) => props.onChange({ query, level: Number(l) })}
			/>

			<TextField
				defaultValue={query.where.time?.from ?? ""}
				onBlur={(e) => setDate("from", (e.target as HTMLInputElement).value)}
				className="flex flex-col gap-1"
			>
				<Label className="text-xs font-semibold">
					From (YYYY or YYYY-MM-DD)
				</Label>
				<Input className="border rounded px-2 py-1 w-36" />
			</TextField>
			<TextField
				defaultValue={query.where.time?.to ?? ""}
				onBlur={(e) => setDate("to", (e.target as HTMLInputElement).value)}
				className="flex flex-col gap-1"
			>
				<Label className="text-xs font-semibold">To</Label>
				<Input className="border rounded px-2 py-1 w-36" />
			</TextField>

			{props.canReview && (
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
					className="flex items-center gap-2 text-sm"
				>
					{({ isSelected }) => (
						<>
							<span
								aria-hidden="true"
								className={`inline-flex items-center justify-center w-4 h-4 border rounded text-xs leading-none ${isSelected ? "bg-blue-700 border-blue-700 text-white" : "bg-white"}`}
							>
								{isSelected ? "✓" : ""}
							</span>
							Include records not yet published (Provisional)
						</>
					)}
				</Checkbox>
			)}
		</div>
	);
}
