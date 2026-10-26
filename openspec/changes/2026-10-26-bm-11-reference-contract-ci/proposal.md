## Why

FR-BAS-760 and NFR-126 require CI to validate the reference value contract
and its examples, with one negative case per cross-field rule. The contract
lived only in the design record, so the loader rules could drift from it
unseen.

## What Changes

- The contract (`delta_reference_value.schema.json`, v0.3) and its examples
  are copied into `app/backend.server/models/ref/contract/`.
- `tests/unit/ref/referenceContract.test.ts`: the examples pass the schema
  and the loader rules; eleven negative cases, one per `allOf` rule, fail
  both.
- `ajv` (MIT, already installed as `ajv@~8.20.0` through another package) is
  declared as a dev dependency at the same range, so the lockfile is
  unchanged and nothing is downloaded.
- Not yet: validation of the RDLS catalogue against the RDLS 1.0 schema. The
  schema is not in the workspace; fetching it is a download that waits for
  Alex.

## Impact

- **DB migration**: none. **Test approach**: unit, no database.
- **Product definition**: FR-BAS-760; NFR-110 (partly), NFR-126; RS-6. R1.
