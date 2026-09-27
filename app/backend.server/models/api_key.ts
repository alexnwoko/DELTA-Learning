import { timingSafeEqual } from "crypto";
import { SelectApiKey } from "~/drizzle/schema/apiKeyTable";
import { ApiKeyRepository } from "~/db/queries/apiKeyRepository";
import { hashApiKeySecret } from "~/backend.server/models/api_key_secret";

// Used by frontend/api_key.tsx
export interface UserCentricApiKeyFields extends Omit<
	SelectApiKey,
	"id" | "secretHash" | "keyPrefix" | "createdAt" | "updatedAt"
> {
	assignedToUserId?: string;
}

// Used by frontend/api_key.tsx
export type ApiKeyViewModel = NonNullable<
	Awaited<ReturnType<typeof ApiKeyRepository.getById>>
>;

// What API handlers receive: the key's identity and tenant, never its secret.
export type AuthenticatedApiKey = Omit<SelectApiKey, "secretHash">;

export async function apiAuth(request: Request): Promise<AuthenticatedApiKey> {
	const authToken = request.headers.get("X-Auth");

	if (!authToken) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const presentedHash = hashApiKeySecret(authToken);
	const key = await ApiKeyRepository.getBySecretHash(presentedHash);

	// getBySecretHash returns an array; an unknown key is an empty array.
	if (!key || key.length === 0) {
		throw new Response("Unauthorized", { status: 401 });
	}

	// Defence in depth: compare the stored hash in constant time.
	const stored = Buffer.from(key[0].secretHash, "hex");
	const presented = Buffer.from(presentedHash, "hex");
	if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) {
		throw new Response("Unauthorized", { status: 401 });
	}

	const { secretHash: _secretHash, ...authenticated } = key[0];
	return authenticated;
}
