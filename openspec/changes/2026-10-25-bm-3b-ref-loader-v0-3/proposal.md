## Why

BM-3a put contract v0.3 and the seven SEC-19 rules in the database. The CSV
loader and the rule module still followed v0.2: they refused the new columns,
did not know share-alike, per-resource or excluded sources, and keyed the money
rule on a unit heuristic (FR-BAS-040, FR-BAS-110).

## What Changes

- `referenceValueRules.ts`: v0.3 rules (five value-level rules, quality flags,
  `is_monetary` with unit multiplier, constant prices with base year, coarse
  grid and interpolation grades, interval type for bounds, climate drivers on
  the global key with vintage `not_applicable`).
- `referenceLoader.ts`: new CSV columns; an excluded source loads nothing; a
  per-resource source takes each row's rule; each value stores its resolved
  rule (TR-151); the upsert writes and compares the new columns.
- `denominator.ts`: provenance reports the value's resolved rule.
- `scripts/ref/load-driver-index.ts`: DMI licence per catalogue CLI-02
  (decision D-BM-07); a re-run never overwrites an excluded or per-resource
  ruling.

## Impact

- **DB migration**: none (BM-3a holds it).
- **Test approach**: unit for the rules; real DB for the loader.
- **Security**: licence enforcement (SEC-19).
- **Product definition**: FR-BAS-040, FR-BAS-110, FR-BAS-560; TR-151, TR-162;
  SEC-19; NFR-126; RS-5, RS-6. R1.
