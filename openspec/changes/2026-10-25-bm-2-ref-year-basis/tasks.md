## 1. Tests first
- [x] 1.1 `tests/unit/ref/yearBasis.test.ts`; red run 5 failed

## 2. Implement
- [x] 2.1 `YearBasis`, labels, option, result members
- [x] 2.2 Count fallback records in `sendaiNumeratorsForYear`

## 3. Quality gates
- [x] 3.1 `tests/unit/ref` 51/51 after review fixes
- [x] 3.2 `tsc` clean
- [x] 3.3 Prettier clean
- [x] 3.4 Code review (fresh subagent): count surfaced on `SendaiRates`, shared `DEFAULT_YEAR_BASIS`, stronger tests. Panel display handed to Analytics
- [x] 3.5 Gate 9 skipped: no route or presentation change
- [x] 3.6 Regression: full unit 649/649 (78 files)
- [x] 3.7 Real-DB ref tier on testdb1: 63/63 (5 files)
