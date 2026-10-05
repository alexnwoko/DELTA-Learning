-- National publication path between DELTA tiers (ADR-11, T2). A country's
-- consent to share is a share setting; every package it publishes is written
-- to the outbox in the same transaction as the publish or revoke action.
-- Packages follow the delta.pub/1 contract. Indexes are written by hand;
-- tests/integration-realdb/pub/publication.test.ts asserts each one exists.
CREATE SCHEMA IF NOT EXISTS pub;
--> statement-breakpoint

-- Consent per dataset, tier and admin level, separate from the instance-wide
-- approvedRecordsArePublic flag (consent model ruled 2026-10-05). Rows are
-- never updated except to revoke; a change of level is a revoke and a new
-- grant, so the history stays complete.
CREATE TABLE IF NOT EXISTS pub.share_setting (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	country_accounts_id uuid NOT NULL REFERENCES public.country_accounts(id) ON DELETE CASCADE,
	dataset text NOT NULL,
	tier text NOT NULL,
	admin_level integer NOT NULL,
	hip_level text NOT NULL DEFAULT 'type',
	redistribution text NOT NULL DEFAULT 'none',
	granted_by uuid NOT NULL REFERENCES public."user"(id),
	granted_at timestamptz NOT NULL DEFAULT now(),
	revoked_by uuid REFERENCES public."user"(id),
	revoked_at timestamptz,
	CONSTRAINT pub_share_dataset_chk CHECK (dataset IN ('human_effects')),
	CONSTRAINT pub_share_tier_chk CHECK (tier IN ('regional', 'global', 'public')),
	CONSTRAINT pub_share_level_chk CHECK (admin_level >= 0),
	CONSTRAINT pub_share_hip_level_chk CHECK (hip_level IN ('type', 'cluster', 'hazard')),
	CONSTRAINT pub_share_redistribution_chk CHECK (redistribution IN ('none', 'regional_only', 'regional_and_global')),
	CONSTRAINT pub_share_revoked_chk CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
--> statement-breakpoint
-- At most one active consent per tenant, dataset and tier.
CREATE UNIQUE INDEX IF NOT EXISTS pub_share_active_uq
	ON pub.share_setting (country_accounts_id, dataset, tier) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pub_share_tenant_idx
	ON pub.share_setting (country_accounts_id, granted_at);
--> statement-breakpoint

-- One row per package. The payload is the full delta.pub/1 document; the
-- digest and signature inside it are repeated as columns for lookup.
CREATE TABLE IF NOT EXISTS pub.package_outbox (
	package_id uuid PRIMARY KEY,
	country_accounts_id uuid NOT NULL REFERENCES public.country_accounts(id) ON DELETE CASCADE,
	share_setting_id uuid NOT NULL REFERENCES pub.share_setting(id),
	dataset text NOT NULL,
	tier text NOT NULL,
	package_type text NOT NULL,
	purpose text NOT NULL,
	previous_package_id uuid REFERENCES pub.package_outbox(package_id),
	content_digest text NOT NULL,
	signed boolean NOT NULL,
	observation_count integer NOT NULL,
	payload jsonb NOT NULL,
	status text NOT NULL DEFAULT 'pending',
	created_by uuid NOT NULL REFERENCES public."user"(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	delivered_at timestamptz,
	CONSTRAINT pub_outbox_type_chk CHECK (package_type IN ('replace', 'withdraw')),
	CONSTRAINT pub_outbox_purpose_chk CHECK (purpose IN ('publication', 'specification_test')),
	CONSTRAINT pub_outbox_status_chk CHECK (status IN ('pending', 'delivered', 'failed')),
	CONSTRAINT pub_outbox_digest_chk CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
	-- A publication is always signed (delta.pub/1 s6).
	CONSTRAINT pub_outbox_signed_chk CHECK (purpose <> 'publication' OR signed),
	CONSTRAINT pub_outbox_withdraw_chk CHECK (package_type <> 'withdraw' OR observation_count = 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pub_outbox_slice_idx
	ON pub.package_outbox (country_accounts_id, dataset, tier, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pub_outbox_setting_idx
	ON pub.package_outbox (share_setting_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pub_outbox_pending_idx
	ON pub.package_outbox (created_at) WHERE status = 'pending';
