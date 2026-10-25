## 1. Tests first
- [x] 1.1 `refContractV03.test.ts` and new DDL names; red run 21 failed

## 2. Implement
- [x] 2.1 Migration and journal entry 75
- [x] 2.2 `NOT VALID` plus validate migration (entry 76) after review
- [x] 2.3 Source and release guard triggers after review

## 3. Quality gates
- [x] 3.1 Real-DB ref tier on isolated `baseline_bm`: 89/89
- [x] 3.2 Migrations applied twice on a fresh clone: no error; 33/33 `ref_value_*` constraints validated
- [x] 3.3 `tsc` clean; Prettier clean on tests (journal formatting is drizzle-kit's, unchanged style)
- [x] 3.4 Code review (fresh subagent): lock levels, source-side bypass, test isolation fixed
- [x] 3.5 Gate 9 skipped: no route or presentation change
- [ ] 3.6 Apply to `delta` with `yarn dbsync` after Alex approves the branch
