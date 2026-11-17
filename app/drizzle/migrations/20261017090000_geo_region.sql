-- Regions within one country (RG-1, increment I-4). A region is a named group
-- of the tenant's own divisions, all at one admin level. Every member belongs
-- to the region's tenant: the composite keys below make a cross-tenant member
-- impossible (SEC-22). Groupings that span countries (UN M49, UNDRR regional
-- offices) are not stored here; they are RG-2, from signed packages (D11).
-- region_vintage counts definition changes; boundary_vintage records the
-- boundary version the members were chosen against.
CREATE TABLE IF NOT EXISTS geo.region (
	region_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	country_accounts_id uuid NOT NULL REFERENCES public.country_accounts(id) ON DELETE CASCADE,
	name jsonb NOT NULL,
	kind text NOT NULL,
	reference_code text,
	member_level integer NOT NULL,
	region_vintage integer NOT NULL DEFAULT 1,
	boundary_vintage text NOT NULL DEFAULT 'unknown',
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT geo_region_kind_chk CHECK (kind IN ('planning', 'reference')),
	CONSTRAINT geo_region_reference_chk CHECK (
		(kind = 'reference' AND reference_code IS NOT NULL) OR (kind = 'planning' AND reference_code IS NULL)
	),
	CONSTRAINT geo_region_tenant_uq UNIQUE (region_id, country_accounts_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS geo_region_tenant_name_uq ON geo.region (country_accounts_id, (name->>'en'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS geo.region_member (
	region_id uuid NOT NULL,
	country_accounts_id uuid NOT NULL,
	division_id uuid NOT NULL,
	PRIMARY KEY (region_id, division_id),
	CONSTRAINT geo_region_member_region_fk FOREIGN KEY (region_id, country_accounts_id)
		REFERENCES geo.region (region_id, country_accounts_id) ON DELETE CASCADE,
	CONSTRAINT geo_region_member_division_fk FOREIGN KEY (division_id)
		REFERENCES public.division (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_region_member_division_idx ON geo.region_member (country_accounts_id, division_id);
--> statement-breakpoint
-- public.division has no (id, country_accounts_id) key, and the geoportal does
-- not change shared tables, so the tenant and level rules are a trigger.
CREATE OR REPLACE FUNCTION geo.region_member_check() RETURNS trigger AS $$
DECLARE
	d_tenant uuid;
	d_level integer;
	r_level integer;
BEGIN
	SELECT country_accounts_id, level INTO d_tenant, d_level FROM public.division WHERE id = NEW.division_id;
	IF d_tenant IS DISTINCT FROM NEW.country_accounts_id THEN
		RAISE EXCEPTION 'REGION_MEMBER_OTHER_TENANT: division % is not a division of the region''s tenant', NEW.division_id;
	END IF;
	SELECT member_level INTO r_level FROM geo.region WHERE region_id = NEW.region_id;
	IF d_level IS DISTINCT FROM r_level THEN
		RAISE EXCEPTION 'REGION_MEMBER_LEVEL: division % is level %, the region holds level %', NEW.division_id, d_level, r_level;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS geo_region_member_check_trg ON geo.region_member;
--> statement-breakpoint
CREATE TRIGGER geo_region_member_check_trg BEFORE INSERT OR UPDATE ON geo.region_member
	FOR EACH ROW EXECUTE FUNCTION geo.region_member_check();
