## 1. Tests first
- [x] 1.1 v0.3 rule unit tests and loader real-DB tests

## 2. Implement
- [x] 2.1 Rule module, loader, denominator provenance
- [x] 2.2 DMI licence (D-BM-07) and the upsert guard after review

## 3. Quality gates
- [x] 3.1 Unit ref 57/57; real-DB ref on `baseline_bm` 93/93
- [x] 3.2 Full unit 656/656 (78 files); `tsc` and Prettier clean
- [x] 3.3 Code review (fresh subagent): one low finding fixed (driver-index upsert guard, proven on `baseline_bm`)
- [x] 3.4 Gate 9 skipped: no route or presentation change
