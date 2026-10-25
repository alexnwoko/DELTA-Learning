## 1. Tests first

- [x] 1.1 Write `tests/unit/ref/refusalCodes.test.ts`; update the four test files to `DENOMINATOR_MISSING`; run `yarn vitest run tests/unit/ref` and see them fail (7 failed)

## 2. Implement

- [x] 2.1 Rename the code in `denominator.ts`
- [x] 2.2 Add `RATE_REFUSAL_CODES` to `rates.ts`

## 3. Quality gates

- [x] 3.1 Gate 1: `yarn vitest run tests/unit/ref` green
- [x] 3.2 Gate 2: `yarn tsc` zero errors
- [x] 3.3 Gate 3: Prettier check on changed files
- [x] 3.4 Gate 4: anti-pattern review
- [x] 3.5 Gates 5 to 8: SOLID, documentation, conventions, code review (fresh subagent)
- [x] 3.6 Gate 9: skipped, no `app/routes/` or `presentation/` change
- [x] 3.7 Gate 10: second-opinion review (fresh subagent)
- [x] 3.8 Regression: full unit suite 643/644; the one failure (`countryAccountService.clone.test.ts`) also fails on base `c3652821`, so it is pre-existing
- [x] 3.9 Real-DB ref tier on testdb1: 63/63, run with BM-2
