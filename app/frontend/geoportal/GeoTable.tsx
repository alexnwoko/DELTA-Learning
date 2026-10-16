// Table alternative to the map (TR-176): every area, with the same value
// state the map draws, operable by keyboard (React Aria Table, TR-249).
import {
	Cell,
	Column,
	Row,
	Table,
	TableBody,
	TableHeader,
	type Selection,
} from "react-aria-components";

import { STATE_ENCODING, type MapArea } from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/GeoMap";

export interface GeoTableRow {
	id: string;
	name: string;
	area: MapArea | undefined;
}

function stateLabel(area: MapArea | undefined): string {
	if (!area) return NO_RECORDS_STYLE.label;
	if (area.state === "shaded") return "Reported";
	return STATE_ENCODING[area.state].label;
}

export function GeoTable(props: {
	id: string;
	label: string;
	rows: readonly GeoTableRow[];
	selectedId: string | null;
	onSelect: (divisionId: string | null) => void;
}) {
	const onSelectionChange = (keys: Selection) => {
		if (keys === "all") return;
		const [first] = Array.from(keys);
		props.onSelect(first === undefined ? null : String(first));
	};
	return (
		<div id={props.id}>
			<Table
				aria-label={props.label}
				selectionMode="single"
				selectionBehavior="replace"
				selectedKeys={props.selectedId ? [props.selectedId] : []}
				onSelectionChange={onSelectionChange}
				className="geo-table w-full text-sm [&_th]:px-2 [&_th]:py-1 [&_th]:border-b [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-gray-100"
			>
				<TableHeader>
					<Column isRowHeader className="text-left">
						Area
					</Column>
					<Column className="text-right">Value</Column>
					<Column className="text-left">State</Column>
					<Column className="text-right">Reported of records</Column>
					<Column className="text-left">Attribution grades</Column>
				</TableHeader>
				<TableBody items={props.rows}>
					{(row) => {
						const t = row.area?.tooltip;
						const n = (v: number) => v.toLocaleString();
						return (
							<Row
								id={row.id}
								className="cursor-pointer data-[selected]:bg-blue-50 data-[focus-visible]:outline data-[focus-visible]:outline-2"
							>
								<Cell>{row.name}</Cell>
								<Cell className="text-right">
									{row.area?.value === null || row.area?.value === undefined
										? ""
										: row.area.value.toLocaleString()}
								</Cell>
								<Cell>
									{stateLabel(row.area)}
									{row.area?.quality.plausibility
										? " (flagged for review)"
										: ""}
								</Cell>
								<Cell className="text-right">
									{t ? `${n(t.reportedBy.n)} of ${n(t.reportedBy.of)}` : ""}
								</Cell>
								<Cell>
									{t?.gradeDistribution
										?.map((g) => `${g.grade} ${n(g.records)}`)
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
