## Decisions

1. Additive columns with constant defaults: no table rewrite. Exchange-rate
   rows keep `is_monetary` false; a backfill from `currency` would fail the
   monetary rule.
2. `ref.value` CHECKs are added `NOT VALID` and validated in a second
   migration, so the large table is never scanned under ACCESS EXCLUSIVE.
3. Triggers carry the cross-table licence rules, because a CHECK cannot read
   `ref.source`. Source and release triggers stop later changes that would
   bypass the value guard.
4. The climate-driver rule (PD-04 rule 7) stays in TypeScript: `family` lives
   on `ref.indicator`, and no driver row reaches `ref.value` today.
