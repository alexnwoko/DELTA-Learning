import { referenceLoader } from "~/backend.server/handlers/reference";
import { listReferenceSources } from "~/backend.server/models/ref/referenceRead";

// GET /:lang/api/reference/sources (PD-05; FR-BAS-180): registered sources
// with licence, redistribution rule, attribution and status.
export const loader = referenceLoader(async () =>
	Response.json(
		{ sources: await listReferenceSources() },
		{ headers: { "Cache-Control": "private, no-cache" } },
	),
);
