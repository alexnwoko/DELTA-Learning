## Why

TR-151, TR-153 and TR-162 (R1) require every `ref.value` row to meet
reference value contract v0.3 and the seven SEC-19 redistribution rules. The
store holds contract v0.2 and four of the seven rules, so share-alike,
per-resource and excluded sources cannot be registered, and no database rule
stops a value from an excluded source (decision D-BM-05).

## What Changes

- Migration `20261026090000_ref_contract_v0_3` (additive): seven source
  rules; `ref.release.grid_resolution`; `ref.value.is_monetary`,
  `quality_flags`, `cell_coverage_sum`, value-level `redistribution_rule`;
  CHECKs for PD-04 rules 3 to 6 added `NOT VALID`; triggers refusing values
  from excluded sources, unresolved per-resource values, rule mismatches, and
  source or release changes that would bypass them.
- Migration `20261026100000_ref_contract_v0_3_validate`: validates the
  CHECKs under SHARE UPDATE EXCLUSIVE.
- No TypeScript change: the loader and rule module follow in BM-3b.

## Impact

- **Files**: the two migrations and journal entries 75 and 76;
  `tests/integration-realdb/ref/refContractV03.test.ts` (new);
  `refSchemaDdl.test.ts`, `refConstraints.test.ts`, `refFixtures.ts`.
- **DB migration**: required, `yarn dbsync`. Pre-flight on `delta`
  (368,434 rows) and testdb1: rules 3b, 5 and 6 have 0 violating rows.
- **Test approach**: real DB (`test:run3`), because the rules are CHECKs and
  triggers.
- **Security**: licence enforcement (SEC-19); not auth or tenancy.
- **Product definition**: FR-BAS-040, FR-BAS-110; TR-151, TR-153, TR-162;
  SEC-19; PD-04 rules 3 to 6; NFR-126; RS-5, RS-6. R1.
