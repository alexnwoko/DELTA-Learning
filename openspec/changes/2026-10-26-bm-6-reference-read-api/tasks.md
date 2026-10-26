## 1. Tests first
- [x] 1.1 `tests/unit/ref/referenceRead.test.ts`, `tests/integration-realdb/ref/referenceRead.test.ts`

## 2. Implement
- [x] 2.1 Read model, auth wrapper, three routes, OpenAPI 3.1
- [x] 2.2 Review fixes: source rule governs, excluded filtered, iso3 key checked, division join tenant-checked

## 3. Quality gates
- [x] 3.1 Unit ref 63/63; real-DB ref 108/108 on `baseline_bm`
- [x] 3.2 `tsc` and Prettier clean
- [x] 3.3 Full unit 657/662 under load; the 3 failing files pass alone (16/16), so timing, not this change
- [x] 3.4 Security review (fresh subagent): four findings fixed
- [ ] 3.5 Gate 9 visual parity: not applicable (JSON routes only); route smoke test on a running server waits for the branch to reach a dev container
