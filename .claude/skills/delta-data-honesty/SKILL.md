---
name: delta-data-honesty
description:
  "DELTA data-honesty invariants for disaster loss and damage figures. Use when writing or
  reviewing code that reads, aggregates, apportions, migrates or displays human effects,
  damage or losses (analytics, read model, loader, geoportal, Sendai summary API), and as a
  checklist alongside differential-review and code-review on those paths."
---

# DELTA data-honesty invariants

These rules are enforced in the data contract and the read model, not in the UI.

## Invariants

1. **Null is not zero.** Never `COALESCE(x, 0)` or `x ?? 0` a not-reported value into a
   confirmed zero. A zero is confirmed only when the source says so explicitly.
2. **Method and grade travel with every derived figure** (grade A to D).
3. **Refuse what cannot be apportioned.** Fail closed with an explicit reason (HTTP 422)
   rather than guess.
4. **Show the unattributed remainder.** Never redistribute it and never drop it.
5. **Extensive quantities are apportioned; intensive quantities are re-derived.** Never
   apportion an extremum downward.
6. **Tenant scope.** Every query is scoped by `countryAccountsId`.
7. **Lossless loads.** Loads are idempotent (key on `api_import_id`), never silently drop
   records, keep every original value in `legacy_data`, and capture unmapped `ext_*` fields.
8. **Schema changes** are Drizzle migrations only (`yarn dbsync`, never `drizzle-kit push`).
   GiST and temporal indexes are hand-written SQL with a DDL assertion test.

## Review checklist

- [ ] No new `COALESCE(..., 0)` or `?? 0` on a reported measure (grep the diff).
- [ ] Every new derived figure carries method and grade.
- [ ] Apportionment paths return 422 with a reason when inputs are insufficient.
- [ ] Remainders are surfaced in the response and the UI.
- [ ] New queries filter on `countryAccountsId`.
- [ ] Migrations are generated files plus hand-written index SQL with a test.

Source: DELTA instance onboarding standards 3B and 3C (DELTA_Version_2/01_Driving_Seat_Prompt).
