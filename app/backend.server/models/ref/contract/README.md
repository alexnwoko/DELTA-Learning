# Reference value contract

`delta_reference_value.schema.json` (JSON Schema 2020-12, contract v0.3) and
`delta_reference_value.examples.json` are copied from the DELTA design record
(`03_Design_Specs/Enrichment_Data_Integration/`). They are the source of truth
for one `ref.value` row (PD-04). `tests/unit/ref/referenceContract.test.ts`
checks in CI that the examples pass the schema and that the loader rules in
`referenceValueRules.ts` refuse one negative case per cross-field rule, as the
schema does (FR-BAS-760, NFR-126). Update both files together with the rules.
