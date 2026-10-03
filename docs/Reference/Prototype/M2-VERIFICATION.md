> 歷史參考副本｜來源：[`master@5ca1373` 的 docs/M2-VERIFICATION.md](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/M2-VERIFICATION.md)。
> 本文的狀態、授權、next step、方法與測試結果屬舊 Prototype；新版工作範圍見 [重寫狀態](../../EXECUTION-STATE.md)。以下保留來源內容，僅將相對 Markdown 連結轉成固定來源連結。

# M2 shared editing — execution evidence

Updated 2026-09-28 Asia/Taipei. This is an implementation evidence log, not a claim that M3/M4 or the full product Goal is complete. Current continuation entry: [EXECUTION-STATE](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/EXECUTION-STATE.md).

## Implemented and observed

- New notes explicitly use `grasp-v1`; older and migrated notes retain `legacy-v0.2`. Ordered literal/dependency parts feed the graph directly. Stable identifiers, bindings, occurrences, dependency IDs, source hashes, current/error/last-good values and rendered caches persist in SQLite schema 4.
- Drafts have their own versions and survive a real host stop/restart without changing committed values. Complete missing/cycle definitions commit as errors, preserving source and observed caches. A draft is never an empty successful shared value.
- Shared literal/dependency and identifier/namespace rename commands have operation IDs, version guards, durable receipts and a separate guarded undo. SQL failure rolls back source/state/cache/receipt together; the candidate graph is adopted only after commit. Unknown HTTP results reconcile by receipt and replay the same command.
- The App edits individual composition parts from a reference, uses a raw-source editor for multiline literal content, labels values affected by drafts, and exposes Reading mode. Controlled external cache-only changes are diagnosed and cannot silently rewrite shared definitions.
- Editor patches guard note/version/exact source, retain raw EOL and local history, and defer document changes during IME composition. A version-only acknowledgement does not need to defer. Source-edit journals prove the actual location of duplicate-reference insertions instead of guessing their identities.
- A production regression exposed two App issues: navigation clicks were dropped while a preceding operation was busy, and a committed-source patch was incorrectly attempted against an already-edited draft. Navigation actions now queue; multirange patches apply only to the matching previous committed source. Draft acknowledgement uses the current snapshot even if a settings response has advanced the workspace revision.

## Completed checks

2026-09-28 00:45:37: `npm test -- --maxWorkers=4` — **35 files / 436 tests passed**, 6.96 s. The preceding unrestricted run passed all 436 assertions but one browser startup hook timed out at 10 s; bounded worker concurrency passed the complete suite. No product failure was hidden by this rerun. Build passes; Vite retains the >500 kB client-chunk advisory. Focused suites include schema 1–3 upgrades with verified backups, additive schema-4 draft-journal upgrade, deep 12,000-node graph, semantic identity/rename, transaction failure, restart, durable receipts/replay/undo, forged/stale journals, raw EOL and editor/browser behavior.

`tests/e2e/shared-values.spec.ts` — **5 production Edge tests passed**, 4.8 s after the committed-source guard correction and in-flight typing integration:

1. Reference action → multiline literal edit → nested values and source caches → independent shared undo → readable table/code.
2. Incomplete binding → durable draft → actual server stop/restart → complete missing/cycle source → recovery to healthy values.
3. Lost draft PUT and command POST responses after server commit → reconcile persisted data without duplicate writes.
4. Ordinary append/prepend of identical references → unchanged existing occurrence identities, new identities only for inserted references.
5. Hold a successful commit response, keep typing while caches change, release the response → exact pending text and original occurrence identities survive with rebased durable source journals.

The 21 existing production regression cases have passed across the corrected runs. The latest workflow rerun passed all four cases in 20.1 s; the other 17 cover concurrency, fallback, files, knowledge, migration and 3,000-note navigation. Legacy performance is explicitly a compatibility workload, not evidence for the new syntax.

Synthetic workspaces/screenshots live outside Git under `SandboxRoot/Scratch/AutomatedTests/`. The latest shared-reading screenshot was inspected: readable table/fenced code, reference actions and normal-sized controls are visible. This is automated browser evidence, not desktop Obsidian/Explorer evidence.

## New-syntax workload

`tests/e2e/shared-performance.spec.ts`: **2/2 passed**, 23.6 s, production Edge on this Windows host. Dedicated seed-free Scratch workspace: 1,000 bindings / 5,000 references / 162,682 source characters. Source input p95 **144.23 ms**, Live Preview p95 **155.58 ms**, shared cascade plus browser-ready **1,658.16 ms**, host restart plus readback **448.18 ms**. All stable identities, 5,000 persisted caches, values and semantic versions were checked. Input samples include automation overhead; they are not native IME or universal hardware latency claims.

Reproducible command after build: `npm run test:e2e -- tests/e2e/shared-performance.spec.ts`. Detailed JSON is in `SandboxRoot/Scratch/AutomatedTests/shared-performance/1790527140749-19692/performance.json`; full synthetic payloads stay outside Git.

## Final checkpoint validation

Final fresh build passes. `npm run test:e2e` completed **32/32 production cases in 1.5 minutes** on 2026-09-28 00:50–00:52, including four draft recovery cases: discard confirmation prevents a hidden autosave commit; reviewed originals remain manually recoverable without automatically reopening; lost DELETE responses reconcile; deleted-owner drafts remain downloadable with exact original bytes after reload. All workspace payloads remain in Scratch.

The final integrated workload at `shared-performance/1790527862009-37284/performance.json` measured Source p95 **210.09 ms**, Live p95 **162.02 ms**, cascade/browser-ready **1,662.95 ms**, restart/readback **405.87 ms**. Both measured runs pass the 500 ms automated input budget; retain the spread rather than selecting only the faster run. Latest complete E2E machine report: [e2e-results.json](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/benchmarks/e2e-results.json).

M2 is ready for its coherent checkpoint. Next is M3 semantic-unit strategies and full portable fallback, followed by M4 full MainVault-copy acceptance. This is not full A+B Goal completion.

Native IME, Obsidian and Explorer GUI remain unverified in this host session: Computer Use's required callable runtime is unavailable. Synthetic composition events and host/API assertions do not close that gap. Full semantic-unit projection/checkpoint/fresh-DB rebuild remain M3/M4.
