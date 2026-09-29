# Interactive responsiveness / execution isolation — accepted plan

Accepted 2026-09-29. Current source is implementation authority; implementation, tests and Human acceptance are distinct. Progress and authorization live only in [EXECUTION-STATE](EXECUTION-STATE.md).

## Scope and accepted decisions

Original first implementation Goal was **P0 ONLY**: opt-in instrumentation, current-publisher baseline, three complete independent MainVault Scratch trials, reconciled report and durable handoff, then STOP. **On2026-09-29 16:16UTC the user explicitly changed priority: finish necessary closeout of running Trial-1R, cancel the other two trials, and proceed to P1 product improvements.** P0 is partial and must not be called a completed three-trial baseline. P1's accepted scope below is now authorized; P2–P5, worker relocation, tabs/panes and technology migration remain later work. Current progress/stop details remain in the single working-state entry.

Consider current [Seed](Project_Seed/README.md), Core Requirements/Development Method rc.3, [architecture guide](Project_Seed/graspportable-architecture-planning-guide-v1.0.0-rc.3.md), binding/shared/projection contracts and actual source together. Prior E1-only task restrictions do not redefine this Goal; its native-verification gap remains separate. Preserve DB authority, identities, atomic shared changes, independent shared undo, recoverable drafts, external dirty protection, revision/workspace guards and complete fallback reconstruction.

Human chose daily strict/extreme stress-tiered budgets; later same-workspace multi-tab plus two resizable split panes; immediate note activation without self-created conflicts; locate reports status immediately but opens only the latest verified reading version. Different workspaces simultaneously are outside the initial pane phase. MainVault/Source and original Acceptance stay read-only; experiment data stays outside Git.

## Current bottleneck and evidence map

Browser main owns CodeMirror, rendering, navigation/search, JSON decode/snapshot apply and an action queue that waits flush. Browser Worker owns committed parser/ValueGraph. One Node JS thread owns HTTP/JSON, DatabaseSync/snapshot/semantic transactions, projection catalog/render/hash and async filesystem orchestration. SQLite is sole runtime authority. Async filesystem waits do not isolate synchronous work.

Separate coordinator synchronous blocking, request dependencies on projectionRunning/full checkpoint, and browser CPU/application queue barriers. inspect/apiState/ensureForLocate wait publication; locate can force full checkpoint. Draft save materializes all notes to find one, then API materializes another snapshot for scheduling. Content transactions repeat full snapshots. DB worker isolation will not itself remove these costs.

| Historical evidence | Interpretation |
|---|---|
| Synthetic immutable mirror: cold2.541s/warm0.674s/separate AI folder2.239s | Windows Node24.19, 2026-09-27 01:18; 2,820 notes/6.32MB Markdown/100 records/4KiB attachment |
| Later single projection: cold15.153s/warm9.251s/reuse2.719s | Same fixture scale, Node24.18,05:43,a5a594b; different layout/validation/scope; reuse is not new AI folder |
| benchmark-files still uses WorkspaceFiles | Neither series measures today's active ProjectionWorkspaceFiles semantic generation/journal publisher |
| Lighter editor12,001 definitions/1,000 refs | Documentation source p95 21.11ms differs from latest9.38ms; latest Live77–183ms; actual overlap latest1 versus historical7 |
| Extreme note~1.75MB/10,000 bindings/50,000 refs | Source p95 204ms, Live319ms, cascade+ready7.67s, automation-inclusive; old pass is not new budget pass |
| 3,000-note search | Latest five samples13.8–22.2ms; timestamp/build absent |
| Complete2,821-note Edge headless flow |124.384s includes cold checkpoint; Files4.928s/locate3.536s; stages unavailable |
| Failed checkpoint52.050s | Full failed operation, not rename syscall; build4102f62d,DB53/public13/recovery53; HTTP200/state error; EPERM root cause unknown |

Unverified build/CPU/filesystem/cache/background context is Unknown. Keep historical overwritten-document/JSON differences visible, never choose the prettiest number. Initial code dd98b21d2bf9da2b267a3a779790e9a41250db59/product0.3.2; existing dist874a5a4b is not new P0 evidence.

## P0 measurements and acceptance

Opt-in bounded telemetry: timestamps, numeric counts/bytes/revisions, opaque request/job/operation IDs and allowlisted route/stage names. No source, query, raw path/body or raw errors. Default disabled; no product semantic/scheduling/cache/timeout change. Record dropped events/sink failures; telemetry failures cannot change successful product outcomes. Evidence files use unique run IDs and exclusive creation.

Nine categories: UI event/handler/useful update; browser long tasks/input delay/frame gaps; Browser Worker send/receive/parse/graph/apply; coordinator event-loop/HTTP/JSON; DB snapshot/prepare/transaction/commit (dedicated queue N/A in P0); projection catalog/plan/render/JSON/hash; filesystem read/write/copy/inventory/validate/rename/retain; checkpoint end-to-end plus dependency wait; UI availability overlapping actual job stages. Logical workload lanes do not imply already separate threads. Synchronous wall time, process CPU and async await are separate; process CPU under concurrency is not projection-exclusive CPU.

Use actual Node24.18-compatible loop delay/utilization plus an external API probe for pre-handler stalls. Browser-internal measures and rAF proxy are separate from driver elapsed; missing Event Timing samples are not zero. Headless insertText is not native IME/physical-key-to-pixel proof.

| Candidate target | Daily MainVault, idle and actual load | Extreme single-note/graph |
|---|---|---|
| Typing feedback | p95<=50ms, ideal near16ms | p95<=100ms |
| Selection/mode/note/tab response | p95<=100ms | same |
| Search first result/panel first useful state | p95<=100ms | same |
| Ordinary durable draft ACK | p95<=200ms | large-source saving reported separately |
| Ordinary small semantic ACK | p95<=200ms, separate from draft ACK | big cascade completion separate, UI targets still apply |
| Unrelated small API/status | p95<=100ms | same |
| Main thread | no background-attributable task>=200ms | same |
| Engineering target | host loop p99<=20ms/max<100ms; later DB queue p95<=50ms | measure independently |

ACK is dispatch-to-durable acknowledgement; report350ms debounce and full input-to-durability separately. Queued, draft saved, semantic committed and published are distinct. Skeleton meets first feedback only, not content readiness.

Three complete independent Scratch trials from one frozen verified source. Record commit/dirty state/build, Node/browser/OS, machine/power/storage, corpus hashes/counts/bytes, DB/generation revisions. No edits to private notes: use synthetic acceptance notes. Measure first process/startup publication, first deliberate full publication, warm one-note and same-revision no-op separately. Record existing-generation state; do not call OS disk cache cold without controlling it. Confirm actual current publisher execution, not fingerprint skip.

Idle: typing/selection/search/navigation/mode/panel/note switch/draft and semantic save. Load: checkpoint/full projection, filesystem validation, large DB operation, graph, hashing/generation. Stress: edits/Files/small saves/navigation-search bursts during publication, repeated background requests. Later add pane/tab cases.

Each trial: >=100 typing, >=30 each search/navigation/mode/selection, >=10 each panel/save. Report trial/load-cell counts, raw events and true overlaps with clock calibration uncertainty. Non-overlap is not under-load; no sleeping fake load. Every success/error/timeout/cancel remains; censored failures cannot disappear from percentiles. Three checkpoint timings are individual values/range, not reliable p95. Formal runs serial with other suites stopped.

Browser-contained validation uses built-in Browser/diagnostics and production harness. Native boundaries remain native and E1 separate. Preserve identities/source/EOL/shared atomicity/undo/draft recovery/dirty/two independent generations/fresh-DB rebuild checks. Existing scripts and E2E bodies/reporters must route outputs to unique Scratch evidence rather than overwrite tracked history. Public summaries exclude private traces/content/screenshots.

P0 complete means all nine categories evidenced or specifically justified N/A/unsupported, complete-corpus fidelity, matching build/artifacts, actual load overlap, accounted terminal outcomes, applicable correctness regressions passing. Failed performance budgets are findings. Missing overlap/incomplete corpus/unaccounted data means P0 incomplete. Finish report/state/checkpoint then STOP.

## Later execution architecture and APIs

One coordinator, one sole DB worker, one sole projection worker, existing Browser Worker; no generic pool initially. Capability modules own data and Grasp ports; HTTP/Worker/SQLite are adapters. Coordinator handles origin/routing/workspace epoch/job lifecycle/small caches/OS operations. DB owns SQL/transactions/drafts/receipts/schema/trusted publication metadata/immutable blobs. Projection owns catalog/plan/render/hash/validation/generation/journal/cutover/recovery/retention. UI owns bounded interaction/rendering.

Messages carry workspace/epoch/request/job/revision/stamp; plain DTO/owned buffers, never DB/CodeMirror handles or functions. Capture in one short DB read transaction then release before filesystem work (current journal_mode=DELETE). Bounded immutable blobs by captured hash. Large encode in owner; measure clone/HTTP/decode/apply. Targeted draft query, lightweight scheduling stamps. Keep shared commands serial/atomic; measured expensive preparation can move outside transaction to bounded execution with same-base CAS before COMMIT.

Status returns cached observation immediately with generation/checkedAt/stale/unknown; verification and catalog refresh are separate. List independent of status; cutover returns temporary unavailable, never mixed generations. Locate ready/pending/blocked with job ID, latest reading/dirty/workspace/generation checks before reveal. Checkpoint/refresh/export202+job; CLI explicit await helper; bundled scripts/client/tests updated together. Strategy background prepare retains frozen token/base/scope/privacy checks. Local switch/panel does not await global flush. Delta/hydrate only for measured transport bottleneck, not tabs prerequisite.

One active publication plus coalesced latest target; distinct partial scopes not merged. New edits do not endlessly cancel valid captures; old complete generation can be last-success/stale before next run. Close view cancels wait, not shared work. Cancel queued jobs; running cancels at safe phase boundaries, not arbitrary commit/cutover termination. Crash recovery reconciles receipts/trusted DB metadata/journal before new owner. Shutdown drains safe points/leases then DB, never forces new checkpoint. Preserve external edits/approvals, completion marker, confinement, two independent recovery generations and full reconstruction.

## Later tabs/panes

Two resizable same-workspace panes, per-pane tabs/active/focus; reopen same note focuses existing tab. One workspace+note session owns raw source/base/hash/journal/draft/local undo, with independent view caret/scroll/mode. Adapter hides CM state; extend existing20-entry cache with pinned open/dirty lifetime and inactive patches. Changes including raw-EOL effects propagate once, no duplicate history/save. Callbacks carry document/view identity, never late global activeId.

Activation immediate, trigger save without awaiting all drafts/semantic work; close tab does not discard draft. One workspace semantic serializer; unknown receipt blocks semantic commands, not unrelated draft persistence/typing. Rebase exact non-overlapping patches across ALL open sessions; true overlap preserves conflict. Rebase uses new draft identity, old durable draft retained until replacement saved. Note-local Ctrl+Z distinct from shared undo. Preserve IME handoff/CRLF. Existing response+patches can support this before any delta API.

## Phases, module classification and gate

P0 baseline/report then stop. P1 cached status/jobs/locate/UI awaits (not CPU isolation). P2 DB worker/cheap draft work. P3 projection worker/lifecycle. P4 sessions/tabs/panes/rebase. P5 comparable full-MainVault budgets/resources/rebuild gate. Later phases need subsequent Goal scope, without adding routine Human gates inside an authorized phase.

P0: telemetry disabled/enabled/correlation/error/privacy/bounds, build, affected store/shared/projection/API/browser regressions. P1: held reads/cancel/late results/workspace guards. P2: atomic rollback/receipts/restart/undo/concurrent writes/crash/queue. P3: dirty/late edits/cutover failure points/recovery/retention/leases/shutdown/packaged worker URLs. P4: A-B-A, same/different-note dual views, cached updates amid draft, >20tabs/close dirty/lost receipt/deletion/IME/EOL/undo. P5: serial full-corpus comparison and fidelity. Coherent checkpoints permit rollback; comparison adapter switch activates one owner only. Initially preserve schema/formats; new migration needs compatibility/recovery evidence.

Measured DB prepare bottleneck -> bounded prepare+CAS; transport -> changed-data/receipt+versioned hydrate; full browser index -> independent search execution not queued behind graph; I/O -> proven redundant-work reduction retaining validation; editor -> adapter/layout fixes. Never infer native core solves editor layout.

| Capability | Importance | Status | Environment | Agent |
|---|---|---|---|---|
| Notes/editor/navigation | Trunk | single view Implemented; tabs/panes WAITING_FOR_IMPLEMENTATION | Cloud-capable, native IME Local-required | High-capability |
| Shared/persistence | Trunk | Implemented; isolation WAITING_FOR_IMPLEMENTATION | Cloud-capable | High-capability |
| Projection/exchange/recovery | Trunk | Implemented; jobs/isolation WAITING_FOR_IMPLEMENTATION | core Cloud-capable, Windows Local-required | High-capability |
| Performance | Trunk | P0 IN_PROGRESS after continuity checkpoint | harness Cloud-capable, MainVault Local-required | cross-layer High-capability; bounded summaries Lower-capability suitable |

Keep owner/port/dependency/source/tests mapping in architecture/module records. Mobile/cloud/Programming Runtime outside current trunk.

Retain Node if all three full trials meet relevant idle/load/stress budgets and correctness. Open Human Rust/Tauri decision only after isolation/queues/measured fixes still fail a required workload in >=2 trials with native-improvable CPU/GC/serialization/IPC attribution, not I/O/EPERM/UI waits/CM layout. Test Node process isolation first for process-resource interference. Bounded native prototype must show about2x hotspot-stage gain AND pass end-to-end budgets/unchanged contracts. Human assesses cost/risk/boundaries; native core and Tauri host are separate choices.124s aggregate or language preference does not justify migration.

## Checkpoints

Save accepted decisions before coding. Coordinator stages/commits only scoped files; no private data. Fetch/check upstream at milestones, preserve user work. Current request authorizes P0/local checkpoints; do not infer new remote-push authority from prior E1 task. Report written/committed/pushed/verified separately. Normal high-capability quota only; log account-wide timestamp/window observations, no Reserve/reset use.
