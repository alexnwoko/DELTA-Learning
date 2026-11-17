-- Money layer (Alex, 2026-10-22): the official exchange rate, local
-- currency units per US dollar, period average (World Bank WDI
-- PA.NUS.FCRF), held per tenant and year in ref.value with the tenant's
-- currency code, so a source-reported value can be shown in the country's
-- currency and in US dollars. Reference data only: no table changes.
INSERT INTO "ref"."indicator" ("code", "name", "family", "quantity_type", "unit") VALUES
	('FX_LCU_PER_USD', 'Official exchange rate, local currency units per US dollar (period average)', 'economic', 'intensive', 'local currency units per US dollar')
ON CONFLICT ("code") DO NOTHING;
