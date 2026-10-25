## Why

TR-154 and ER-3 require each rate to use the population of the year of
occurrence. When a record has no effect date, the start year is a labelled
fallback, and the records placed that way are counted. DELTA records hold no
per-effect date yet, so every rate today rests on the fallback, but nothing in
the result says so (FR-BAS-240, FR-BAS-600).

## What Changes

- `YearBasis` (`effect_date` or `start_year_fallback`) and `YEAR_BASIS_LABELS`
  in `denominator.ts`.
- `PopulationDenominatorOptions.yearBasis` (optional, defaults to the
  fallback); the basis travels on the denominator result, its refusal and the
  rate's `denominator` member.
- `SendaiNumerators.yearBasis` states the basis and counts the records placed
  by it.
- No route, schema or `fieldsDef` change. Per-effect dates and their precision
  (FR-BAS-250) belong to the data-entry lane.

## Capabilities

### New Capabilities

- `reference-rate-year-basis`: how a rate's denominator year was chosen.

## Impact

- **Files**: `app/backend.server/models/ref/denominator.ts`, `rates.ts`
  (updated); `tests/unit/ref/yearBasis.test.ts` (new);
  `tests/unit/ref/rates.test.ts` (fixtures).
- **DB migration**: none.
- **Test approach**: unit; the real-DB `sendaiRates` test covers the count.
- **Security**: not security-sensitive.
- **Product definition**: FR-BAS-240, FR-BAS-600; TR-154; NFR-112; RS-4;
  decision D-BM-04. R1.
