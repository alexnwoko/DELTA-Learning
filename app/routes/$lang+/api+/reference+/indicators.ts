import { referenceLoader } from "~/backend.server/handlers/reference";
import { listReferenceIndicators } from "~/backend.server/models/ref/referenceRead";

// GET /:lang/api/reference/indicators (PD-05; FR-BAS-180): indicator codes
// with family, quantity type and unit.
export const loader = referenceLoader(async () =>
	Response.json(
		{ indicators: await listReferenceIndicators() },
		{ headers: { "Cache-Control": "private, no-cache" } },
	),
);
