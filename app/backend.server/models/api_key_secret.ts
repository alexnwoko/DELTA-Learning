import { createHash, randomBytes } from "crypto";

export const API_KEY_PREFIX_LENGTH = 8;

export function generateApiKeySecret(): string {
	return randomBytes(32).toString("hex");
}

// SHA-256 is enough here: the secret is 256 random bits, not a password.
export function hashApiKeySecret(secret: string): string {
	return createHash("sha256").update(secret, "utf8").digest("hex");
}
