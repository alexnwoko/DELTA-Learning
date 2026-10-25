-- BM-5 (D-BM-06): ADR-03 tenant policy on ref.value, enabled and not
-- forced. The table owner and superusers bypass it, so the app is unchanged
-- until the Tenant Isolation lane gives the app a non-owner role (A8). Any
-- other role sees only the tenant in app.tenant, set per transaction with
-- set_config('app.tenant', <id>, true), never a session SET on a pooled
-- connection. Fail closed: an unset or empty app.tenant matches no row.
ALTER TABLE "ref"."value" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ref_value_tenant_isolation" ON "ref"."value";
--> statement-breakpoint
CREATE POLICY "ref_value_tenant_isolation" ON "ref"."value" AS PERMISSIVE FOR ALL TO PUBLIC
	USING ("country_accounts_id" = NULLIF(current_setting('app.tenant', true), '')::uuid)
	WITH CHECK ("country_accounts_id" = NULLIF(current_setting('app.tenant', true), '')::uuid);
