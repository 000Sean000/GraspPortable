# Current Working State — GraspPortable

Updated 2026-09-29. Current task: accepted [performance isolation plan](PERFORMANCE-ISOLATION-PLAN.md), **P0 instrumentation and trustworthy complete MainVault Scratch baseline only**. User explicitly requested implementation. Complete P0 report and durable checkpoint, then STOP; P1–P5 are later work.

## Authority and authorization

[Seed](Project_Seed/README.md), Requirements/Development Method rc.3, [architecture guide](Project_Seed/graspportable-architecture-planning-guide-v1.0.0-rc.3.md), [accepted P0/later plan](PERFORMANCE-ISOLATION-PLAN.md), [binding](BINDING-EDITING-CONTRACT.md), [shared](SHARED-VALUE-CONTRACT.md), [projection](PROJECTION-CONTRACT.md), [implementation map](IMPLEMENTATION-CONTRACT.md). Current source is implementation authority. Preserve DB/identity/shared atomicity/undo/draft/dirty/recovery contracts.

Authorized P0: observation-only instrumentation, immutable evidence-output overrides, current-publisher runner, tests/build, three complete independent Scratch trials, documentation/local checkpoints. No worker relocation, optimization, timeout changes, tabs/panes or Acceptance deployment. No new remote push authorization inferred from prior E1. Prior E1-only restrictions and10% closeout condition belonged to that handoff, not this P0. Normal high-capability quota discipline continues; no Reserve/reset use.

MainVault, Acceptance/MainVault-Source and original Acceptance stay read-only. Complete copies/private artifacts live outside Git under Scratch. Trial mutations only synthetic acceptance notes. Browser evidence does not establish native Explorer/IME success.

## Preflight / implementation baseline

Actual repo SandboxRoot/GraspPortable, master -> origin/master, confirmed remote https://github.com/000Sean000/GraspPortable.git. Initial HEAD dd98b21d2bf9da2b267a3a779790e9a41250db59. Supplied architecture guide was the only untracked file; preserved unchanged and included as accepted planning dependency. Sandbox fetch could not connect; escalated git fetch origin succeeded; HEAD/upstream0/0, no pull needed. Existing product0.3.2/dist874a5a4b is historical, not instrumented baseline.

Accepted plan saved in local continuity checkpoint `010064390fbf42698d267e4960c07ee21b6e43d2`. Instrumentation, artifact overrides, production harness and full-copy/recovery tools saved in `0b4dd586ffc521b3799b30283d480cba7f1ad322`. No formal performance baseline has been completed. Old file benchmark still uses legacy WorkspaceFiles, not active ProjectionWorkspaceFiles. Historical report/JSON overwrite gaps are recorded in plan.

## Work and next steps

Coordinator owns plan/state/Git/integration/full copies/final report. Host agent: opt-in server instrumentation. Browser agent: browser/runtime instrumentation. Runner agent: production baseline harness and evidence-output overrides. [Observation interface and reproduction](PERFORMANCE-INSTRUMENTATION.md). Formal benchmarks serial after integration, without concurrent suites.

Complete source freeze and three independent trials passed preparation: 40,016 files, 3,144 directories, 8,027,848,074 bytes; DB schema5/revision53, 2,821 notes,244folders,506attachments/433unique blobs. SQLite readonly online backup and all SQL rows/blobs compared; original tree unchanged during freeze. Frozen/trial fingerprint `bf3b87d5217a5719f8d9ac30bf45010fc5013ed10e3316f976ec8173ae5f64a9`. Private manifest: `Scratch/Performance-P0-20260929/fixture-summary.json`; each trial DB is `Trial-N/Workspace/.grasp/workspace.grasp.db`, N=1..3. These are still pristine at this checkpoint. Source final recheck remains required after trials.

Integration unit suite:47files/589tests PASS (2026-09-29 14:33UTC); runner15focused tests and TypeScript PASS. Production build77c39e00-579e-40ad-aa13-f720f69e8c59 and45production browser regressions PASS. Later changes are measurement scripts/tests/docs only. Historical tracked reports unchanged. [Current report](PERFORMANCE-BASELINE-P0.md) records evidence locators and remaining coverage. All formal trials NOT YET RUN.

Small smoke completed with no trace loss and orderly host exit. First full smoke stopped before workloads due initial hydration resetting a too-early search; harness now waits for observed hydration. Second full smoke completed all7cells under `Evidence/2026-09-29T13-58-20-755Z-smoke-full2-14d6e904/`:3,866,695host events,0loss/sink errors/open spans,184actual publication overlaps, original data unchanged and orderly exit. It used the earlier loaded harness: a roughly300s Node fetch transport ceiling and no sustained post-burst input; preserve its diagnostics but do not certify it as formal baseline. Current source uses explicit-deadline node:http transport, durable active-cell progress, shell-only panel samples in selected load cells and bounded ongoing input against real pending jobs;14focused tests PASS. No product timeouts changed. Post-measurement recovery verification passed under `Smoke-full-correctness/`; correctness.json records the result.

Full smoke correctness passed at14:28UTC:2same-workspace valid recovery generations,standalone fallback,freshDB rebuild/reopen,506attachment hashes, alloriginals unchanged. Failed small validation runs remain preserved. Final full-count small run `Evidence/2026-09-29T14-40-13-740Z-fullcounts-ready-19f146ed/` is measurement-complete with measured failures:471typing,45search/navigation/selection,53mode,15panel,23save;229,609host events with0loss/open spans;970actual publication overlaps;graph-cell typing overlaps DB45andworkergraph2. It is synthetic harness verification, not MainVault acceptance. Final runner16tests,aggregator5tests andTypeScriptPASS after the47file/589test suite. Aggregator has fixed privacy allowlists and successful real smoke evidence ingestion.

Next: save final measurement-source checkpoint, build clean source once, then run3serial full trials and matched recovery verification on Trial-1..3. No builds/copies/tests alongside formal timed trials. Afterward verify original source inventory, prepare sanitized aggregate/report, update this state, save checkpoint and STOP. Budget failures are findings; missing coverage/corpus/overlap remains incomplete. Read each report for its actual build/commit. Formal trial trees remain pristine at this checkpoint.

## Locators / independent native gap

Paths relative to SandboxRoot; private absolute locators remain local.

| Locator | Use |
|---|---|
| Acceptance/MainVault-Source/ | Read-only original source snapshot |
| Acceptance/MainVault-Grasp-v0.3/ | Complete accepted workspace, read-only copy source after verification |
| Scratch/Performance-P0-20260929/ | Verified P0 frozen copies, trials and private evidence |
| Scratch/Chat-Handoff-20260928-1818/ | Prior E1 copy/evidence, no assertion about live PID |

[E1 evidence](E1-WINDOWS-VERIFICATION.md) and [prior UI task index](UI-REPAIR-VERIFICATION.md#chat-單題接手) retain native selection unverified: launcher/host passed, browser observation blocked before note/reveal. P0 does not fix/retry Computer Use or substitute API/browser success for Explorer. EPERM cause unknown. New P0 workloads on new copies are authorized measurements, not old E1 retry.

## Saving / usage

P0 start2026-09-29 around13:20UTC: normal codex7%used/93%remaining,10080-minute window/reset1791200482, ordinaryUsageAllowed=true. Interim13:37UTC14%used and13:52:43UTC22%used, same window; account-wide, not task-exclusive. See [usage log](USAGE-LOG.md). Local docs checkpoint0100643 and source0b4dd58 saved; final harness checkpoint being recorded, nothing pushed. Latest containing-document SHA comes from Git history; do not self-reference. Update this entry at milestones and final stop.
