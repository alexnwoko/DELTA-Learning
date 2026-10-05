import { pubLoader } from "~/backend.server/handlers/pub";
import { listPackages } from "~/backend.server/models/pub/publish";

// The tenant's outbox, newest first, without payloads.
export const loader = pubLoader(async (_args, { countryAccountsId }) =>
	Response.json({ packages: await listPackages(countryAccountsId) }),
);
