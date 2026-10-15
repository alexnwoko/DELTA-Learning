import { eq, sql, and, isNull, sum, isNotNull, type SQL } from "drizzle-orm";
import { Tx } from "~/db.server";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { humanCategoryPresenceTable } from "~/drizzle/schema/humanCategoryPresenceTable";
import { humanDsgTable } from "~/drizzle/schema/humanDsgTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { affectedTablesAndCols } from "./affected-people-tables";
import { approvalBasis, type ApprovalAudience } from "~/utils/approvalBasis";
import {
	getDescendantDivisionIds,
	recordInDivisionCondition,
} from "~/backend.server/utils/geographicFilters";
import {
	compositeValue,
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	type CompositeValue,
	type MeasureValue,
} from "~/utils/valueState";

interface Conditions {
	divisionId?: string;
	/** The division and its descendants, resolved once in getAffected. */
	divisionIds?: string[];
	/** Approval basis audience (C23). Replaces the publishedOnly flag. */
	audience: ApprovalAudience;
}

/**
 * Records in the division or any of its descendants, through the shared
 * membership rule used by every analytics view (solution pack C18).
 */
function divisionCondition(conditions?: Conditions) {
	if (!conditions?.divisionId) {
		return undefined;
	}
	return recordInDivisionCondition(
		disasterRecordsTable,
		conditions.divisionId,
		conditions.divisionIds?.length
			? conditions.divisionIds
			: [conditions.divisionId],
	);
}

export async function getAffected(
	tx: Tx,
	disasterEventId: string,
	conditions: Conditions,
) {
	if (conditions?.divisionId && !conditions.divisionIds) {
		conditions = {
			...conditions,
			divisionIds: await getDescendantDivisionIds(conditions.divisionId),
		};
	}
	let res = {
		noDisaggregations: await totalsForEachTable(
			tx,
			disasterEventId,
			conditions,
		),
		disaggregations: await byColAndTableTotalsOnlyForFrontend(
			tx,
			disasterEventId,
			conditions,
		),
	};
	return res;
}

type HumanEffectCode = (typeof affectedTablesAndCols)[number]["code"];

type Total = {
	/** Sum of the reported components; null when none was reported. */
	totalPeopleAffected: number | null;
	/** Value state of totalPeopleAffected, and whether it is partial. */
	peopleAffected: CompositeValue;
	/** Each measure's value: null when not reported, never 0 (TR-076). */
	tables: Record<HumanEffectCode, number | null>;
	/** Value state and record counts per measure (TR-076, E17). */
	measures: Record<HumanEffectCode, MeasureValue>;
};

type humanEffectsDataCode =
	| "deaths"
	| "injured"
	| "missing"
	| "directlyAffected"
	| "indirectlyAffected"
	| "displaced";

const totalsTablesAndCols = affectedTablesAndCols;

/**
 * Per-measure figures for the event's records on the approval basis (and in
 * the division, when set). Every record in scope counts, including those
 * with no human-effects row, so "not reported" is measured rather than
 * dropped. As in hazard-analysis: a record reports a measure when its total
 * is above 0; it confirms zero when its total is 0 with a Yes flag, or when
 * it holds an explicit No with no value (tri-state source, PD-03:326).
 * Aggregate zeros follow the coverage rule (PD-04:596, PD-05:96).
 */
async function totalsForEachTable(
	tx: Tx,
	disasterEventId: string,
	conditions: Conditions,
): Promise<Total> {
	const de = disasterEventTable;
	const dr = disasterRecordsTable;
	const hcp = humanCategoryPresenceTable;

	const fields: Record<string, SQL> = { recordsTotal: sql`COUNT(*)` };
	for (const a of totalsTablesAndCols) {
		const total = a.presenceTotalCol;
		const flag = a.presenceCol;
		fields[`${a.code}Sum`] = sql`SUM(${total}) FILTER (WHERE ${total} > 0)`;
		fields[`${a.code}Reported`] = sql`COUNT(*) FILTER (WHERE ${total} > 0)`;
		fields[`${a.code}Zero`] = sql`COUNT(*) FILTER (
			WHERE (${total} = 0 AND ${flag} IS TRUE)
				OR (${flag} IS FALSE AND COALESCE(${total}, 0) = 0)
		)`;
	}

	const res = await tx
		.select(fields)
		.from(dr)
		.innerJoin(de, eq(de.id, dr.disasterEventId))
		.leftJoin(hcp, eq(hcp.recordId, dr.id))
		.where(
			and(
				eq(de.id, disasterEventId),
				approvalBasis(conditions.audience, dr),
				divisionCondition(conditions),
			),
		);
	const row: Record<string, unknown> = res[0] ?? {};
	const count = (k: string) => (row[k] as string | number | null) ?? 0;

	const measures = Object.fromEntries(
		totalsTablesAndCols.map((a) => [
			a.code,
			measureValue(
				{
					sum: (row[`${a.code}Sum`] as string | number | null) ?? null,
					reported: count(`${a.code}Reported`),
					zeroConfirmed: count(`${a.code}Zero`),
					total: count("recordsTotal"),
				},
				PROVISIONAL_ZERO_COVERAGE,
			),
		]),
	) as Record<HumanEffectCode, MeasureValue>;
	const tables = Object.fromEntries(
		totalsTablesAndCols.map((a) => [a.code, measures[a.code].value]),
	) as Record<HumanEffectCode, number | null>;

	// People affected: every measure but deaths, as before. Reported
	// components only; null when none was reported, never 0.
	const peopleAffected = compositeValue(
		totalsTablesAndCols
			.filter((a) => a.code !== "deaths")
			.map((a) => measures[a.code]),
	);

	return {
		totalPeopleAffected: peopleAffected.value,
		peopleAffected,
		tables,
		measures,
	};
}

export async function totalsRecordsForTypeCol(
	tx: Tx,
	dataCode: humanEffectsDataCode,
	disasterEventId: string,
	audience: ApprovalAudience,
) {
	let record = totalsTablesAndCols.find((d) => d.code == dataCode);
	if (!record) throw new Error("invalid dataCode: " + dataCode);
	return await totalsForOneTableRecords(
		tx,
		disasterEventId,
		record.presenceTotalCol,
		record.presenceCol,
		audience,
	);
}

async function totalsForOneTableRecords(
	tx: Tx,
	disasterEventId: string,
	resCol: any,
	presenceCol: any,
	audience: ApprovalAudience,
) {
	/*
	SELECT dr.id, hcp.deaths_total
	FROM disaster_event de
	JOIN disaster_records dr ON de.id = dr.disaster_event_id
	JOIN human_category_presence hcp ON dr.id = hcp.record_id
	WHERE de.id = '641495e5-1ece-4376-ab31-40b6861ac001'
		AND hcp.deaths IS TRUE
		AND <approval basis, C23>
	*/

	let de = disasterEventTable;
	let dr = disasterRecordsTable;
	let hcp = humanCategoryPresenceTable;

	const res = await tx
		.select({
			drId: disasterRecordsTable.id,
			value: resCol,
		})
		.from(de)
		.innerJoin(dr, eq(de.id, dr.disasterEventId))
		.innerJoin(hcp, eq(dr.id, hcp.recordId))
		.where(
			and(
				eq(de.id, disasterEventId),
				eq(presenceCol, true),
				approvalBasis(audience, dr),
			),
		);

	return res ?? [];
}

const tables = [
	{ code: "sex", col: humanDsgTable.sex },
	{ code: "age", col: humanDsgTable.age },
	{ code: "disability", col: humanDsgTable.disability },
	{ code: "globalPovertyLine", col: humanDsgTable.globalPovertyLine },
	{ code: "nationalPovertyLine", col: humanDsgTable.nationalPovertyLine },
];

/*
type ByColAndTable = {
	sex: ByTable
	age: ByTable
	disability: ByTable
	globalPovertyLine: ByTable
	nationalPovertyLine: ByTable
}

async function byColAndTable(tx: Tx, disasterEventId: string): Promise<ByColAndTable> {
	let res: any = {}
	for (let t of tables) {
		res[t.code] = await byTable(tx, disasterEventId, t.col)
	}
	return res as ByColAndTable
}*/

type ByColAndTableTotalsOnly = {
	sex: Map<string, number>;
	age: Map<string, number>;
	disability: Map<string, number>;
	globalPovertyLine: Map<string, number>;
	nationalPovertyLine: Map<string, number>;
};

async function byColAndTableTotalsOnly(
	tx: Tx,
	disasterEventId: string,
	conditions: Conditions,
): Promise<ByColAndTableTotalsOnly> {
	let entries = await Promise.all(
		tables.map(async (t) => {
			let v = await byTable(tx, disasterEventId, t.col, conditions);
			return [t.code, v.total] as const;
		}),
	);

	return Object.fromEntries(entries) as ByColAndTableTotalsOnly;
}

type ByColAndTableTotalsOnlyForFrontend = {
	sex: Record<string, number>;
	age: Record<string, number>;
	disability: Record<string, number>;
	globalPovertyLine: Record<string, number>;
	nationalPovertyLine: Record<string, number>;
};

async function byColAndTableTotalsOnlyForFrontend(
	tx: Tx,
	disasterEventId: string,
	conditions: Conditions,
): Promise<ByColAndTableTotalsOnlyForFrontend> {
	let res: any = {};
	let r = await byColAndTableTotalsOnly(tx, disasterEventId, conditions);

	// adjust results for disabilities to only group by no/has disabilities
	let dis = new Map<string, number>();
	for (let [k, v] of r.disability.entries()) {
		let k2 = "";
		if (k == "none") {
			k2 = "none";
		} else {
			k2 = "disability";
		}
		let a = dis.get(k2) || 0;
		a += v;
		dis.set(k2, a);
	}
	r.disability = dis;

	for (let [k, v] of Object.entries(r)) {
		res[k] = Object.fromEntries(v.entries());
	}
	return res as ByColAndTableTotalsOnlyForFrontend;
}

type ByTable = {
	total: Map<string, number>;
	tables: {
		deaths: Map<string, number>;
		injured: Map<string, number>;
		missing: Map<string, number>;
		directlyAffected: Map<string, number>;
		displaced: Map<string, number>;
	};
};

async function byTable(
	tx: Tx,
	disasterEventId: string,
	dsgCol: any,
	conditions: Conditions,
): Promise<ByTable> {
	let tables: any = {};
	let total = new Map<string, number>();
	for (let a of totalsTablesAndCols) {
		let vv = await countsForOneTable(
			tx,
			disasterEventId,
			a.table,
			a.col,
			dsgCol,
			a.presenceCol,
			conditions,
		);
		tables[a.code] = vv;
		for (let [k, v] of vv.entries()) {
			let a = total.get(k) || 0;
			a += v;
			total.set(k, a);
		}
	}
	return { total, tables } as ByTable;
}

async function countsForOneTable(
	tx: Tx,
	disasterEventId: string,
	valTable: any,
	resCol: any,
	groupBy: any,
	presenceCol: any,
	conditions: Conditions,
): Promise<Map<string, number>> {
	/*
		SELECT hd.sex, SUM(d.deaths)
	FROM disaster_event de
	JOIN disaster_records dr ON de.id = dr.disaster_event_id
	JOIN human_dsg hd ON dr.id = hd.record_id
	JOIN deaths d ON hd.id = d.dsg_id
		JOIN human_category_presence hcp ON hd.record_id = hcp.record_id
	WHERE de.id = 'f41bd013-23cc-41ba-91d2-4e325f785171'
			AND hcp.deaths IS TRUE
		AND <approval basis, C23>
		AND hd.sex IS NOT NULL
		AND hd.age IS NULL
		AND hd.disability IS NULL
		AND hd.global_poverty_line IS NULL
		AND hd.national_poverty_line IS NULL
		AND (hd.custom IS NULL
			OR hd.custom = '{}'::jsonb
			OR (
				SELECT COUNT(*)
				FROM jsonb_each(hd.custom)
				WHERE jsonb_typeof(value) != 'null'
			) = 0
		)
			AND EXISTS (
			SELECT 1
			FROM jsonb_array_elements(dr.spatial_footprint) AS elem
			WHERE elem->'geojson'->'features'->0->'properties'->>'division_id' = '74'
			OR elem->'geojson'->'features'->0->'properties'->'division_ids' @> '74'::jsonb
		)
	GROUP BY hd.sex
	*/

	let de = disasterEventTable;
	let dr = disasterRecordsTable;
	let hd = humanDsgTable;
	let vt = valTable;
	let hcp = humanCategoryPresenceTable;

	if (
		![
			hd.sex,
			hd.age,
			hd.disability,
			hd.globalPovertyLine,
			hd.nationalPovertyLine,
		].includes(groupBy)
	) {
		throw new Error("unknown group by column");
	}

	const res = await tx
		.select({
			key: groupBy,
			sum: sum(resCol),
		})
		.from(de)
		.innerJoin(dr, eq(de.id, dr.disasterEventId))
		.innerJoin(hd, eq(dr.id, hd.recordId))
		.innerJoin(vt, eq(hd.id, vt.dsgId))
		.innerJoin(hcp, eq(hd.recordId, hcp.recordId))
		.where(
			and(
				eq(de.id, disasterEventId),
				eq(presenceCol, true),
				approvalBasis(conditions.audience, dr),
				groupBy == hd.sex ? isNotNull(hd.sex) : isNull(hd.sex),
				groupBy == hd.age ? isNotNull(hd.age) : isNull(hd.age),
				groupBy == hd.disability
					? isNotNull(hd.disability)
					: isNull(hd.disability),
				groupBy == hd.globalPovertyLine
					? isNotNull(hd.globalPovertyLine)
					: isNull(hd.globalPovertyLine),
				groupBy == hd.nationalPovertyLine
					? isNotNull(hd.nationalPovertyLine)
					: isNull(hd.nationalPovertyLine),
				sql`(
					${hd.custom} IS NULL
					OR ${hd.custom} = '{}'::jsonb
					OR (
						SELECT COUNT(*)
						FROM jsonb_each(${hd.custom})
						WHERE jsonb_typeof(value) != 'null'
					) = 0
				)`,
				divisionCondition(conditions),
			),
		)
		.groupBy(groupBy);

	let m = new Map<string, number>();
	if (!res || !res.length) {
		return m;
	}
	for (let r of res) {
		// A group whose rows carry no value is not reported: leave it out
		// rather than show 0 (TR-076).
		if (r.sum === null || r.sum === undefined) continue;
		m.set(r.key, Number(r.sum));
	}
	return m;
}
