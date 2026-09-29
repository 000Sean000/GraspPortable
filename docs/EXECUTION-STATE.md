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

Complete source freeze and three independent trials passed preparation: 40,016 files, 3,144 directories, 8,027,848,074 bytes; DB schema5/revision53, 2,821 notes,244folders,506attachments/433unique blobs. SQLite readonly online backup and all SQL rows/blobs compared; original tree unchanged during freeze. Frozen/trial fingerprint `bf3b87d5217a5719f8d9ac30bf45010fc5013ed10e3316f976ec8173ae5f64a9`. Private manifest: `Scratch/Performance-P0-20260929/fixture-summary.json`. Trial-1 was used by an excluded run; Trial-1R is a new independent frozen copy, verified15:13UTC in replacement-trial-summary.json. Trial-1R/Trial-2/Trial-3 remain pristine for the repaired protocol. Source final recheck remains required after trials.

Integration unit suite:47files/589tests PASS (2026-09-29 14:33UTC). Production build77c39e00-579e-40ad-aa13-f720f69e8c59 and45production browser regressions PASS. Later changes are measurement scripts/tests/docs only. Historical tracked reports unchanged. [Current report](PERFORMANCE-BASELINE-P0.md) records evidence locators and remaining coverage. Valid formal trials0/3.

Small smoke completed with no trace loss and orderly host exit. First full smoke stopped before workloads due initial hydration resetting a too-early search; harness now waits for observed hydration. Second full smoke completed all7cells under `Evidence/2026-09-29T13-58-20-755Z-smoke-full2-14d6e904/`:3,866,695host events,0loss/sink errors/open spans,184actual publication overlaps, original data unchanged and orderly exit. It used the earlier loaded harness: a roughly300s Node fetch transport ceiling and no sustained post-burst input; preserve its diagnostics but do not certify it as formal baseline. Current source uses explicit-deadline node:http transport, durable active-cell progress, shell-only panel samples in selected load cells and bounded ongoing input against real pending jobs;14focused tests PASS. No product timeouts changed. Post-measurement recovery verification passed under `Smoke-full-correctness/`; correctness.json records the result.

Full smoke correctness passed at14:28UTC:2same-workspace valid recovery generations,standalone fallback,freshDB rebuild/reopen,506attachment hashes, alloriginals unchanged. Failed small validation runs remain preserved. Old full-count small run `Evidence/2026-09-29T14-40-13-740Z-fullcounts-ready-19f146ed/` has useful diagnostic observations, but its completeness claim is withdrawn by the fixture audit below. Aggregator has fixed privacy allowlists and successful real smoke evidence ingestion.

**2026-09-29 15:09UTC audit supersedes the earlier harness completeness claim:** source checkpoint5f3103fb00db52e3a5dae60147966bc8e6b5b02b/build460b1220-cd3a-4312-80b1-8a80c25b42e9 ran Trial-1 under `Evidence/2026-09-29T14-44-27-998Z-trial-1-83f8c9c8/`. It ended normally with3,807,093host events,0loss/open spans,7,688publication overlaps and unchanged originals, but its extreme fixture PUT returnedHTTP422. The harness swallowed that required mutation failure and declared planned dimensions; its reported measurementCoverageComplete is insufficient and this run is EXCLUDED from formal acceptance. Its new audit.json retains this correction beside the unmodified original report. Earlier small full-count reports have the same certification limitation. No valid formal trial is complete yet.

**15:38UTC diagnostic audit:** `Evidence/2026-09-29T15-15-03-131Z-verified-extreme-ba33419d/` proved actual Graph1,000/5,000 and Extreme1,750,000-byte/10,000/50,000 dimensions through mutation response and independent stored readback. Source typing0/30 delivered versus Live20/20 exposed an inert-editor preparation race. Its600,000ms shutdown deadline expired; hard-stopped host, missing footer and6open spans make it incomplete. Both owned processes exited; audit.json preserves corrections. New protocol uses measured per-mode readiness and direct-input gates, plus the already-supported1,800,000ms harness request/shutdown ceiling for every formal trial. Product timeouts remain unchanged.

Work now: fixture verification, exact source-size ACK attribution and Source/Live delivery gates are implemented; runner19tests and aggregator8tests PASS. Extreme-save monitoring is tied to a new marker edit to avoid an autosave/no-op false timeout, with unconditional listener/timer cleanup. TypeScript and production build PASS. Fresh full-count synthetic validation remains before formal runs. New tiny diagnostic workspace `Smoke-final-method/Workspace/.grasp/workspace.grasp.db` is created and not yet run. Agents hold changes; root owns integration. Save this repaired measurement checkpoint, rebuild from its clean source, then use that same build for the diagnostic and all formal trials if validation passes.

Next: finish actual-store fixture tests and full-count harness validation, save repaired measurement-source checkpoint/build, then3serial full trials on Trial-1R/Trial-2/Trial-3 with matched recovery verification. No builds/copies/tests alongside formal timed trials. Afterward verify original source inventory, prepare sanitized aggregate/report, update this state, save checkpoint and STOP. Budget failures are findings; missing coverage/corpus/overlap or unapplied fixtures remain incomplete.

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

P0 start2026-09-29 around13:20UTC: normal codex7%used/93%remaining,10080-minute window/reset1791200482, ordinaryUsageAllowed=true. Latest15:32UTC43%used/57%remaining, same window; account-wide, not task-exclusive. See [usage log](USAGE-LOG.md). Local checkpoints0100643,0b4dd58,5f3103f saved; repaired measurement checkpoint being recorded, nothing pushed. Fetch origin succeeded15:36UTC; master3ahead/0behind, upstream unchanged. Latest containing-document SHA comes from Git history; do not self-reference. Update this entry at milestones and final stop.
