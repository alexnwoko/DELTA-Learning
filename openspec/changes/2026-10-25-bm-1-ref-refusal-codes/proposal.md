## Why

The product definition (PD-05 refusal envelope, TR-154) reserves the code
`DENOMINATOR_MISSING` for a rate whose population denominator is missing. The
reference store returns `POPULATION_MISSING_FOR_YEAR` instead, and that code
reaches the public geoportal API through `models/geo/queries.ts`. Clients and
panels therefore cannot rely on the documented code (FR-BAS-210).

## What Changes

- `DenominatorRefusalCode` returns `DENOMINATOR_MISSING` in place of
  `POPULATION_MISSING_FOR_YEAR`.
- New `RATE_REFUSAL_CODES` registry in `rates.ts` names every rate refusal
  code, whether PD-05 reserves it or DELTA extends the envelope with it, and
  the requirement behind it (FR-BAS-590).
- No route, schema or `fieldsDef` change.

## Capabilities

### New Capabilities

- `reference-rate-refusals`: the refusal codes a reference-store rate returns.

### Modified Capabilities

None.

## Impact

- **Files**:
  - `app/backend.server/models/ref/denominator.ts` (updated): the code rename.
  - `app/backend.server/models/ref/rates.ts` (updated): the registry.
  - `tests/unit/ref/refusalCodes.test.ts` (new): registry and pass-through.
  - `tests/unit/ref/denominatorPrecedence.test.ts`, `tests/unit/ref/rates.test.ts`,
    `tests/integration-realdb/ref/denominatorTenantIsolation.test.ts`,
    `tests/integration-realdb/ref/sendaiRates.test.ts` (updated): new code.
- **DB migration**: none.
- **Test approach**: unit (`vitest run tests/unit/ref`); the real-DB ref tests
  assert the same code.
- **Multi-tenancy / security**: not security-sensitive. The geoportal API
  response changes its refusal code string; the Geoportal lane updates
  `geoReadModel.test.ts:937` at its next merge.
- **Product definition**: FR-BAS-210, FR-BAS-590; TR-154; PD-05; RS-4. R1.
