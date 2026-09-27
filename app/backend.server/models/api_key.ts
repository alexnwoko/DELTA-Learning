import { SelectApiKey } from "~/drizzle/schema/apiKeyTable";
import { ApiKeyRepository } from "~/db/queries/apiKeyRepository";

// Used by frontend/api_key.tsx
export interface UserCentricApiKeyFields extends Omit<
	SelectApiKey,
	"id" | "secret" | "createdAt" | "updatedAt"
> {
	assignedToUserId?: string;
}

// Used by frontend/api_key.tsx
export type ApiKeyViewModel = NonNullable<
	Awaited<ReturnType<typeof ApiKeyRepository.getById>>
>;

export async function apiAuth(request: Request): Promise<SelectApiKey> {
	const authToken = request.headers.get("X-Auth");

	if (!authToken) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const key = await ApiKeyRepository.getBySecret(authToken);

	// getBySecret returns an array; an unknown key is an empty array.
	if (!key || key.length === 0) {
		throw new Response("Unauthorized", { status: 401 });
	}

	return key[0];
}
