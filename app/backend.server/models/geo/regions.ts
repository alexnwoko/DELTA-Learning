import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	aggregate,
	baseMeta,
	GeoRefusalError,
	type GeoCell,
	type GeoRequest,
} from "~/backend.server/models/geo/queries";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import type { GeoMeasure } from "~/utils/geoMeasures";

// Regions within one country (RG-1, increment I-4; OpenAPI 0.7.0-draft).
// A region is a named group of the tenant's own divisions at one admin level,
// stored in geo.region and geo.region_member. Figures come from the tenant's
// own atoms only (SEC-22). Groupings that span countries are RG-2 (packages).

export type RegionKind = "planning" | "reference";

export interface Region {
	regionId: string;
	name: string;
	kind: RegionKind;
	referenceCode: string | null;
	memberLevel: number;
	regionVintage: string;
	boundaryVintage: string;
	members: { divisionId: string; name: string }[];
}

interface RegionRow {
	region_id: string;
	name: Record<string, string>;
	kind: RegionKind;
	reference_code: string | null;
	member_level: number;
	region_vintage: number;
	boundary_vintage: string;
	members: { division_id: string; name: Record<string, string> }[] | null;
}

function localName(name: Record<string, string> | null, lang: string): string {
	return name?.[lang] || name?.en || "";
}

function toRegion(r: RegionRow, lang: string): Region {
	return {
		regionId: r.region_id,
		name: localName(r.name, lang),
		kind: r.kind,
		referenceCode: r.reference_code,
		memberLevel: Number(r.member_level),
		regionVintage: String(r.region_vintage),
		boundaryVintage: r.boundary_vintage,
		members: (r.members ?? [])
			.map((m) => ({ divisionId: m.division_id, name: localName(m.name, lang) }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

async function selectRegions(
	countryAccountsId: string,
	regionId: string | null,
): Promise<RegionRow[]> {
	const res = await dr.execute(sql`
		SELECT r.region_id, r.name, r.kind, r.reference_code, r.member_level,
			r.region_vintage, r.boundary_vintage,
			(SELECT jsonb_agg(jsonb_build_object('division_id', d.id, 'name', d.name))
				FROM geo.region_member m JOIN public.division d ON d.id = m.division_id
				WHERE m.region_id = r.region_id) AS members
		FROM geo.region r
		WHERE r.country_accounts_id = ${countryAccountsId}
			${regionId ? sql`AND r.region_id = ${regionId}` : sql``}
		ORDER BY r.name->>'en'
	`);
	return res.rows as unknown as RegionRow[];
}

/** GET /regions: the tenant's regions with their members. */
export async function listRegions(
	countryAccountsId: string,
	lang: string,
): Promise<Region[]> {
	return (await selectRegions(countryAccountsId, null)).map((r) =>
		toRegion(r, lang),
	);
}

/** One region of the tenant, or null (another tenant's region is not found). */
export async function getRegion(
	countryAccountsId: string,
	regionId: string,
	lang: string,
): Promise<Region | null> {
	const rows = await selectRegions(countryAccountsId, regionId);
	return rows[0] ? toRegion(rows[0], lang) : null;
}

export interface RegionInput {
	regionId?: string;
	name: Record<string, string>;
	kind: RegionKind;
	referenceCode?: string | null;
	divisionIds: string[];
}

function invalid(message: string): GeoRefusalError {
	return new GeoRefusalError(
		"MALFORMED_REQUEST",
		message,
		"RG-1; Geoportal continuation plan s4",
		"Choose divisions of this instance, all at one admin level.",
		422,
	);
}

/**
 * Creates or replaces a region. Members must be divisions of the tenant at one
 * admin level (also enforced by a trigger). The region vintage goes up when
 * the member list changes; the boundary vintage is the one in force now.
 */
export async function saveRegion(
	countryAccountsId: string,
	input: RegionInput,
): Promise<string> {
	const ids = [...new Set(input.divisionIds)];
	if (ids.length === 0) throw invalid("A region needs at least one division.");
	if (!input.name.en?.trim()) throw invalid("A region needs an English name.");
	if ((input.kind === "reference") !== Boolean(input.referenceCode)) {
		throw invalid("A reference code is given for reference regions only.");
	}

	return dr.transaction(async (tx) => {
		const divs = await tx.execute(sql`
			SELECT id, level FROM public.division
			WHERE country_accounts_id = ${countryAccountsId}
				AND id IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `,
				)})
		`);
		const rows = divs.rows as { id: string; level: number }[];
		if (rows.length !== ids.length) {
			throw invalid("Every member must be a division of this instance.");
		}
		const levels = new Set(rows.map((r) => Number(r.level)));
		if (levels.size !== 1) {
			throw invalid("All members of a region must be at one admin level.");
		}
		const memberLevel = [...levels][0];

		const vintage = await tx.execute(sql`
			SELECT COALESCE(max(boundary_vintage), 'unknown') AS v
			FROM geo.division_geom_cache WHERE country_accounts_id = ${countryAccountsId}
		`);
		const boundaryVintage = String((vintage.rows[0] as { v: string }).v);

		let regionId = input.regionId;
		if (regionId) {
			const before = await tx.execute(sql`
				SELECT array_agg(m.division_id::text ORDER BY m.division_id) AS ids
				FROM geo.region r
				LEFT JOIN geo.region_member m ON m.region_id = r.region_id
				WHERE r.region_id = ${regionId} AND r.country_accounts_id = ${countryAccountsId}
				GROUP BY r.region_id
			`);
			if (before.rows.length === 0) {
				throw new Response("Region not found", { status: 404 });
			}
			const old = ((before.rows[0] as { ids: string[] | null }).ids ?? [])
				.filter(Boolean)
				.join(",");
			const changed = old !== [...ids].sort().join(",");
			await tx.execute(sql`
				UPDATE geo.region SET
					name = ${JSON.stringify(input.name)}::jsonb,
					kind = ${input.kind},
					reference_code = ${input.referenceCode ?? null},
					member_level = ${memberLevel},
					region_vintage = region_vintage + ${changed ? 1 : 0},
					boundary_vintage = ${changed ? boundaryVintage : sql`boundary_vintage`},
					updated_at = now()
				WHERE region_id = ${regionId}
			`);
			if (changed) {
				await tx.execute(
					sql`DELETE FROM geo.region_member WHERE region_id = ${regionId}`,
				);
			} else {
				return regionId;
			}
		} else {
			const ins = await tx.execute(sql`
				INSERT INTO geo.region (country_accounts_id, name, kind, reference_code, member_level, boundary_vintage)
				VALUES (${countryAccountsId}, ${JSON.stringify(input.name)}::jsonb, ${input.kind},
					${input.referenceCode ?? null}, ${memberLevel}, ${boundaryVintage})
				RETURNING region_id
			`);
			regionId = (ins.rows[0] as { region_id: string }).region_id;
		}
		for (const id of ids) {
			await tx.execute(sql`
				INSERT INTO geo.region_member (region_id, country_accounts_id, division_id)
				VALUES (${regionId}, ${countryAccountsId}, ${id})
			`);
		}
		return regionId as string;
	});
}

/**
 * GET /regions/{regionId}/summary. The total counts each record once; each
 * member is a cell at the member level. A record linked to several members
 * counts in each of them, so the plain sum of members can exceed the total:
 * multiAreaRecords discloses how many records that is (I-4 exit test).
 */
export async function getRegionSummary(
	countryAccountsId: string,
	req: GeoRequest,
	region: Region,
) {
	const measure = req.query.measure as GeoMeasure;
	const scoped: GeoRequest = {
		...req,
		query: {
			...req.query,
			where: { ...req.query.where, region: { regionId: region.regionId } },
		},
	};
	const meta = await baseMeta(countryAccountsId, scoped);
	meta.boundaryVersion = region.boundaryVintage;

	const members = await aggregate(
		countryAccountsId,
		scoped,
		[measure],
		region.memberLevel,
	);
	const total = await aggregate(
		countryAccountsId,
		scoped,
		[measure],
		region.memberLevel,
		undefined,
		region.regionId,
	);
	meta.migrationRunIds = total.runIds;
	meta.provisional =
		total.provisional && basisIncludesProvisional(req.audience);

	const memberCells = members.cells.get(measure) ?? [];
	const byId = new Map(memberCells.map((c) => [c.division_id, c]));
	const totalCell: GeoCell | null = (total.cells.get(measure) ?? [])[0] ?? null;
	const reportedValues = memberCells
		.map((c) => c.value)
		.filter((v): v is number => typeof v === "number");

	return {
		meta,
		region,
		measure,
		total: totalCell,
		sumOfMembers: reportedValues.length
			? reportedValues.reduce((a, b) => a + b, 0)
			: null,
		multiAreaRecords: members.multiDivisionRecords,
		members: region.members.map((m) => ({
			divisionId: m.divisionId,
			name: m.name,
			cell: byId.get(m.divisionId) ?? null,
		})),
		unattributed: total.unattributed,
		caption: [
			"Each disaster impact counts once in the region total.",
			members.multiDivisionRecords > 0
				? `${members.multiDivisionRecords} are linked to more than one member area and count in each, so member values add up to more than the total.`
				: "",
			"Reporting completeness is not modelled.",
		]
			.filter(Boolean)
			.join(" "),
	};
}
