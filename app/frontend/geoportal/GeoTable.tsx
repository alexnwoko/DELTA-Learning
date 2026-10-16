// Ranked area list and table alternative to the map (TR-176, review R07):
// every area with the same value state the map draws, sortable, operable by
// keyboard (React Aria Table, TR-249). Areas without a value are listed
// after the ranked ones under their state, never ranked as 0 (TR-076).
import { useMemo, useState } from "react";
import {
	Cell,
	Column,
	Row,
	Table,
	TableBody,
	TableHeader,
	type Selection,
	type SortDescriptor,
} from "react-aria-components";

import { STATE_ENCODING, type MapArea } from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/geoCells";
import { dataTokens } from "~/utils/designTokens.generated";
import { fmt, plainT, type GeoT } from "~/frontend/geoportal/i18n";

export interface GeoTableRow {
	id: string;
	name: string;
	area: MapArea | undefined;
}

export function stateLabel(
	area: MapArea | undefined,
	t: GeoT = plainT,
): string {
	if (!area)
		return t({ code: "geoportal.legend.nothing", msg: NO_RECORDS_STYLE.label });
	if (area.state === "shaded")
		return t({ code: "geoportal.state.reported", msg: "Reported" });
	return STATE_ENCODING[area.state].label;
}

const hasValue = (r: GeoTableRow) =>
	r.area?.state === "shaded" && typeof r.area.value === "number";

/**
 * Rows in display order: areas with a value by the sort column, then every
 * other area grouped by state and name. Ranks count valued areas only,
 * highest value first; equal values share a rank.
 */
export function rankRows(
	rows: readonly GeoTableRow[],
	sort: SortDescriptor,
): { row: GeoTableRow; rank: number | null }[] {
	const valued = rows.filter(hasValue);
	const rest = rows.filter((r) => !hasValue(r));
	const dir = sort.direction === "ascending" ? 1 : -1;
	const byValue = (a: GeoTableRow, b: GeoTableRow) =>
		dir * ((a.area?.value as number) - (b.area?.value as number)) ||
		a.name.localeCompare(b.name);
	const byName = (a: GeoTableRow, b: GeoTableRow) =>
		dir * a.name.localeCompare(b.name);
	valued.sort(sort.column === "name" ? byName : byValue);
	rest.sort(
		(a, b) =>
			stateLabel(a.area).localeCompare(stateLabel(b.area)) ||
			a.name.localeCompare(b.name),
	);
	const ordered = [...valued].sort(
		(a, b) => (b.area?.value as number) - (a.area?.value as number),
	);
	const rankOf = new Map<string, number>();
	let rank = 0;
	let last: number | null = null;
	ordered.forEach((r, i) => {
		const v = r.area?.value as number;
		if (v !== last) {
			rank = i + 1;
			last = v;
		}
		rankOf.set(r.id, rank);
	});
	return [
		...valued.map((row) => ({ row, rank: rankOf.get(row.id) ?? null })),
		...rest.map((row) => ({ row, rank: null })),
	];
}

export function GeoTable(props: {
	id: string;
	label: string;
	rows: readonly GeoTableRow[];
	selectedId: string | null;
	onSelect: (divisionId: string | null) => void;
	/** Unit shown in the value column header, for example "people". */
	unit?: string;
	t?: GeoT;
}) {
	const t = props.t ?? plainT;
	const [sort, setSort] = useState<SortDescriptor>({
		column: "value",
		direction: "descending",
	});
	const ranked = useMemo(() => rankRows(props.rows, sort), [props.rows, sort]);
	const max = Math.max(
		0,
		...props.rows.filter(hasValue).map((r) => r.area?.value as number),
	);
	const onSelectionChange = (keys: Selection) => {
		if (keys === "all") return;
		const [first] = Array.from(keys);
		props.onSelect(first === undefined ? null : String(first));
	};
	const th = "px-2 py-1 border-b border-brand-border font-semibold";
	const td = "px-2 py-1 border-b border-brand-border align-middle";
	return (
		<div id={props.id} className="overflow-x-auto">
			<Table
				aria-label={props.label}
				selectionMode="single"
				selectionBehavior="replace"
				selectedKeys={props.selectedId ? [props.selectedId] : []}
				onSelectionChange={onSelectionChange}
				sortDescriptor={sort}
				onSortChange={setSort}
				className="geo-table w-full text-sm"
			>
				<TableHeader>
					<Column id="rank" className={`${th} text-right w-10`}>
						{t({ code: "geoportal.table.rank", msg: "Rank" })}
					</Column>
					<Column
						id="name"
						isRowHeader
						allowsSorting
						className={`${th} text-left`}
					>
						{t({ code: "geoportal.table.area", msg: "Area" })}
					</Column>
					<Column id="value" allowsSorting className={`${th} text-right`}>
						{props.unit
							? t(
									{ code: "geoportal.table.value_unit", msg: "Value ({unit})" },
									{ unit: props.unit },
								)
							: t({ code: "geoportal.table.value", msg: "Value" })}
					</Column>
					<Column id="state" className={`${th} text-left`}>
						{t({ code: "geoportal.table.state", msg: "State" })}
					</Column>
					<Column id="reported" className={`${th} text-right`}>
						{t({ code: "geoportal.table.reported", msg: "Reported of total" })}
					</Column>
					<Column id="grades" className={`${th} text-left`}>
						{t({ code: "geoportal.table.grades", msg: "Attribution grades" })}
					</Column>
				</TableHeader>
				<TableBody items={ranked.map((r) => ({ id: r.row.id, ...r }))}>
					{({ row, rank }) => {
						const tip = row.area?.tooltip;
						const v = hasValue(row) ? (row.area?.value as number) : null;
						return (
							<Row
								id={row.id}
								className="cursor-pointer data-[selected]:bg-brand-surface-subtle data-[hovered]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
							>
								<Cell
									className={`${td} text-right tabular-nums text-brand-text-muted`}
								>
									{rank ?? ""}
								</Cell>
								<Cell className={td}>{row.name}</Cell>
								<Cell className={`${td} text-right tabular-nums`}>
									{v === null ? (
										""
									) : (
										<span className="inline-flex items-center gap-2 justify-end w-full">
											<span
												aria-hidden="true"
												className="inline-block h-2 rounded-sm"
												style={{
													width: `${max > 0 ? Math.max(2, (v / max) * 64) : 0}px`,
													background: row.area?.color ?? dataTokens.chart.axis,
												}}
											/>
											{fmt(v)}
										</span>
									)}
								</Cell>
								<Cell className={td}>
									{stateLabel(row.area, t)}
									{row.area?.quality.plausibility
										? ` ${t({ code: "geoportal.table.flagged", msg: "(flagged for review)" })}`
										: ""}
								</Cell>
								<Cell className={`${td} text-right tabular-nums`}>
									{tip
										? t(
												{ code: "geoportal.table.n_of_m", msg: "{n} of {m}" },
												{ n: fmt(tip.reportedBy.n), m: fmt(tip.reportedBy.of) },
											)
										: ""}
								</Cell>
								<Cell className={td}>
									{tip?.gradeDistribution
										?.map((g) => `${g.grade} ${fmt(g.records)}`)
										.join(", ") ?? ""}
								</Cell>
							</Row>
						);
					}}
				</TableBody>
			</Table>
		</div>
	);
}
