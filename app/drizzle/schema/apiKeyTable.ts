import { relations } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import {
	createdUpdatedTimestamps,
	ourRandomUUID,
	zeroText,
} from "../../utils/drizzleUtil";
import { countryAccountsTable } from "./countryAccountsTable";
import { userTable } from "./userTable";

export const apiKeyTable = pgTable("api_key", {
	...createdUpdatedTimestamps,
	id: ourRandomUUID(),
	// SHA-256 of the raw secret (hex). The raw secret is shown once at creation.
	secretHash: text("secret_hash").notNull().unique(),
	// First characters of the raw secret, so users can tell keys apart.
	keyPrefix: text("key_prefix").notNull(),
	name: zeroText("name"),
	managedByUserId: uuid("user_id")
		.notNull()
		.references(() => userTable.id, { onDelete: "cascade" }),
	countryAccountsId: uuid("country_accounts_id").references(
		() => countryAccountsTable.id,
		{
			onDelete: "cascade",
		},
	),
});

export type SelectApiKey = typeof apiKeyTable.$inferSelect;
export type InsertApiKey = typeof apiKeyTable.$inferInsert;
export type ApiKeyWithUser = SelectApiKey & {
	managedByUser: {
		id: string;
		email: string;
	};
};

export const apiKeyRelations = relations(apiKeyTable, ({ one }) => ({
	managedByUser: one(userTable, {
		fields: [apiKeyTable.managedByUserId],
		references: [userTable.id],
	}),
}));
