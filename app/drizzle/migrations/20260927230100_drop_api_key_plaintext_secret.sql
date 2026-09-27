-- Drop the plaintext API key column. 20260927230000 backfilled secret_hash
-- and key_prefix from it, and no code reads or writes it since then.
-- This cannot be undone: take a pg_dump -Fc before applying it.
ALTER TABLE "api_key" DROP CONSTRAINT IF EXISTS "api_key_secret_unique";
--> statement-breakpoint
ALTER TABLE "api_key" DROP COLUMN IF EXISTS "secret";
