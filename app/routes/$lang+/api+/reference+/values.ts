import { referenceLoader } from "~/backend.server/handlers/reference";
import {
	listReferenceValues,
	parseValuesQuery,
} from "~/backend.server/models/ref/referenceRead";

// GET /:lang/api/reference/values (PD-05; FR-BAS-180): one indicator for the
// caller's tenant, each value with its state, grade and provenance. Values
// the caller's licence channel may not receive are counted under "withheld".
export const loader = referenceLoader(
	async ({ countryAccountsId, audience, url }) => {
		const parsed = parseValuesQuery(url.searchParams);
		if (!parsed.ok) {
			return Response.json(
				{
					error: {
						code: "MALFORMED_REQUEST",
						message: parsed.error,
						requirement: "PD-05 reference endpoints",
					},
				},
				{ status: 400 },
			);
		}
		const { values, withheld } = await listReferenceValues(
			countryAccountsId,
			parsed.query,
			audience,
		);
		return Response.json(
			{ meta: { query: parsed.query, audience, withheld }, values },
			{ headers: { "Cache-Control": "private, no-cache" } },
		);
	},
);
