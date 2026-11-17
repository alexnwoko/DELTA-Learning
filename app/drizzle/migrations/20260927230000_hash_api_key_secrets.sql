-- API key secrets were stored and compared in plaintext.
-- Store a SHA-256 hash and a short display prefix instead. Existing keys stay
-- valid: the hash is computed from the stored secret, and apiAuth looks keys
-- up by the hash of the presented secret.
-- The plaintext column becomes nullable here; new keys never write it.
-- A later migration drops it.
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "secret_hash" text;
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "key_prefix" text;
--> statement-breakpoint
UPDATE "api_key"
	SET "secret_hash" = encode(sha256(convert_to("secret", 'UTF8')), 'hex'),
		"key_prefix" = left("secret", 8)
	WHERE "secret_hash" IS NULL AND "secret" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "secret_hash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "key_prefix" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_secret_hash_unique" UNIQUE ("secret_hash");
--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "secret" DROP NOT NULL;
