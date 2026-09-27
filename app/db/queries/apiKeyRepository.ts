import { and, desc, eq, sql } from "drizzle-orm";
import { dr, Tx } from "../../db.server";
import { apiKeyTable } from "~/drizzle/schema/apiKeyTable";
import {
	API_KEY_PREFIX_LENGTH,
	generateApiKeySecret,
	hashApiKeySecret,
} from "~/backend.server/models/api_key_secret";

// Reads for display never return secret material.
const displayColumns = { secret: false, secretHash: false } as const;

export const ApiKeyRepository = {
	getById: (id: string) => {
		return dr.query.apiKeyTable.findFirst({
			columns: displayColumns,
			where: eq(apiKeyTable.id, id),
			with: { managedByUser: true },
		});
	},

	// Tenant-scoped read for the settings pages. It never returns secret
	// material, and a key of another tenant reads as not found.
	getByIdForTenant: (id: string, countryAccountsId: string) => {
		return dr.query.apiKeyTable.findFirst({
			columns: displayColumns,
			where: and(
				eq(apiKeyTable.id, id),
				eq(apiKeyTable.countryAccountsId, countryAccountsId),
			),
		});
	},

	getByCountryAccountsIdWithUser: (countryAccountsId: string) => {
		return dr.query.apiKeyTable.findMany({
			columns: displayColumns,
			where: eq(apiKeyTable.countryAccountsId, countryAccountsId),
			orderBy: [desc(apiKeyTable.name)],
			with: { managedByUser: true },
		});
	},

	// Returns the raw secret once. Only its hash and prefix are stored.
	create: async (
		data: {
			name: string;
			managedByUserId?: string | null;
			countryAccountsId?: string | null;
		},
		tx?: Tx,
	) => {
		const secret = generateApiKeySecret();
		const rows = await (tx ?? dr)
			.insert(apiKeyTable)
			.values({
				createdAt: sql`CURRENT_TIMESTAMP`,
				name: data.name,
				managedByUserId: data.managedByUserId!,
				secretHash: hashApiKeySecret(secret),
				keyPrefix: secret.slice(0, API_KEY_PREFIX_LENGTH),
				countryAccountsId: data.countryAccountsId ?? null,
			})
			.returning({ id: apiKeyTable.id })
			.execute();
		return rows.map((row) => ({ ...row, secret }));
	},

	update: (id: string, name: string, tx?: Tx) => {
		return (tx ?? dr)
			.update(apiKeyTable)
			.set({ updatedAt: sql`CURRENT_TIMESTAMP`, name })
			.where(eq(apiKeyTable.id, id))
			.execute();
	},

	delete: (id: string, tx?: Tx) => {
		return (tx ?? dr).delete(apiKeyTable).where(eq(apiKeyTable.id, id));
	},

	deleteByCountryAccountId: (countryAccountsId: string, tx?: Tx) => {
		return (tx ?? dr)
			.delete(apiKeyTable)
			.where(eq(apiKeyTable.countryAccountsId, countryAccountsId));
	},

	getByCountryAccountsId: (countryAccountsId: string, tx?: Tx) => {
		return (tx ?? dr)
			.select()
			.from(apiKeyTable)
			.where(eq(apiKeyTable.countryAccountsId, countryAccountsId));
	},

	getBySecretHash: (secretHash: string, tx?: Tx) => {
		return (tx ?? dr)
			.select()
			.from(apiKeyTable)
			.where(eq(apiKeyTable.secretHash, secretHash));
	},
};
