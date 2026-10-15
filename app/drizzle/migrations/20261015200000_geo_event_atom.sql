-- Geoportal read model for the event dimensions (increment I-1). One row per
-- event and division. An event with a division link is placed as recorded;
-- otherwise it is placed where its member records are placed
-- (derivation from_records). An event that cannot be placed keeps one row with
-- division_id NULL and the reason, so it is counted, never dropped.
-- Rebuilt per tenant by app/backend.server/models/geo/refresh.ts; indexes are
-- asserted by tests/integration-realdb/geo/geoReadModel.test.ts.
CREATE TABLE IF NOT EXISTS geo.event_atom (
	atom_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	country_accounts_id uuid NOT NULL,
	dimension text NOT NULL,
	event_id uuid NOT NULL REFERENCES public.event(id) ON DELETE CASCADE,
	division_id uuid REFERENCES public.division(id) ON DELETE CASCADE,
	admin_level integer,
	unattributed_reason text,
	att_grade char(1),
	derivation text NOT NULL DEFAULT 'as_recorded',
	member_records integer NOT NULL DEFAULT 0,
	hip_type_id text,
	hip_cluster_id text,
	hip_hazard_id text,
	start_instant date,
	end_instant date,
	end_from_start boolean NOT NULL DEFAULT false,
	date_precision text NOT NULL DEFAULT 'none',
	event_status text NOT NULL,
	provisional boolean NOT NULL DEFAULT false,
	retired boolean NOT NULL DEFAULT false,
	migration_run_id text,
	method_version text NOT NULL,
	CONSTRAINT geo_event_dimension_chk CHECK (dimension IN ('hazardous_event', 'disaster_event')),
	CONSTRAINT geo_event_derivation_chk CHECK (derivation IN ('as_recorded', 'from_records')),
	CONSTRAINT geo_event_attribution_chk CHECK (
		(division_id IS NOT NULL AND unattributed_reason IS NULL AND att_grade IN ('A', 'B', 'C', 'D'))
		OR (division_id IS NULL AND unattributed_reason IS NOT NULL AND att_grade IS NULL)
	)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_event_tenant_dim_idx ON geo.event_atom (country_accounts_id, dimension, event_status, division_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_event_tenant_start_idx ON geo.event_atom (country_accounts_id, start_instant);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS geo_event_event_idx ON geo.event_atom (event_id);
