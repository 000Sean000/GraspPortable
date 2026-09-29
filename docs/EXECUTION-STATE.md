# Current Working State — GraspPortable

Updated 2026-09-29. Current task: accepted [performance isolation plan](PERFORMANCE-ISOLATION-PLAN.md), **P0 instrumentation and trustworthy complete MainVault Scratch baseline only**. User explicitly requested implementation. Complete P0 report and durable checkpoint, then STOP; P1–P5 are later work.

## Authority and authorization

[Seed](Project_Seed/README.md), Requirements/Development Method rc.3, [architecture guide](Project_Seed/graspportable-architecture-planning-guide-v1.0.0-rc.3.md), [accepted P0/later plan](PERFORMANCE-ISOLATION-PLAN.md), [binding](BINDING-EDITING-CONTRACT.md), [shared](SHARED-VALUE-CONTRACT.md), [projection](PROJECTION-CONTRACT.md), [implementation map](IMPLEMENTATION-CONTRACT.md). Current source is implementation authority. Preserve DB/identity/shared atomicity/undo/draft/dirty/recovery contracts.

Authorized P0: observation-only instrumentation, immutable evidence-output overrides, current-publisher runner, tests/build, three complete independent Scratch trials, documentation/local checkpoints. No worker relocation, optimization, timeout changes, tabs/panes or Acceptance deployment. No new remote push authorization inferred from prior E1. Prior E1-only restrictions and10% closeout condition belonged to that handoff, not this P0. Normal high-capability quota discipline continues; no Reserve/reset use.

MainVault, Acceptance/MainVault-Source and original Acceptance stay read-only. Complete copies/private artifacts live outside Git under Scratch. Trial mutations only synthetic acceptance notes. Browser evidence does not establish native Explorer/IME success.

## Preflight / implementation baseline

Actual repo SandboxRoot/GraspPortable, master -> origin/master, confirmed remote https://github.com/000Sean000/GraspPortable.git. Initial HEAD dd98b21d2bf9da2b267a3a779790e9a41250db59. Supplied architecture guide was the only untracked file; preserved unchanged and included as accepted planning dependency. Sandbox fetch could not connect; escalated git fetch origin succeeded; HEAD/upstream0/0, no pull needed. Existing product0.3.2/dist874a5a4b is historical, not instrumented baseline.

Plan-only diagnosis is complete; no new performance measurements yet. Old file benchmark uses legacy WorkspaceFiles, not active ProjectionWorkspaceFiles. Historical report/JSON overwrite gaps are recorded in plan. Current stop: save accepted decisions as docs-only continuity checkpoint before source edits.

## Work and next steps

Coordinator owns plan/state/Git/integration/full copies/final report. Host agent: opt-in server instrumentation. Browser agent: browser/runtime instrumentation. Runner agent: production baseline harness and evidence-output overrides. Agents hold source writes until checkpoint. Formal benchmarks serial after integration, without concurrent suites.

Next: checkpoint docs, release implementation, focused tests/build, frozen full source and three Scratch trials, harness smoke then official serial runs. Preserve all outcomes and actual load overlaps. Budget failures are P0 findings; missing coverage/corpus/overlap means incomplete. New tests/build/trials NOT RUN.

## Locators / independent native gap

Paths relative to SandboxRoot; private absolute locators remain local.

| Locator | Use |
|---|---|
| Acceptance/MainVault-Source/ | Read-only original source snapshot |
| Acceptance/MainVault-Grasp-v0.3/ | Complete accepted workspace, read-only copy source after verification |
| Scratch/Performance-P0-20260929/ | New P0 copies/evidence root, to create |
| Scratch/Chat-Handoff-20260928-1818/ | Prior E1 copy/evidence, no assertion about live PID |

[E1 evidence](E1-WINDOWS-VERIFICATION.md) and [prior UI task index](UI-REPAIR-VERIFICATION.md#chat-單題接手) retain native selection unverified: launcher/host passed, browser observation blocked before note/reveal. P0 does not fix/retry Computer Use or substitute API/browser success for Explorer. EPERM cause unknown. New P0 workloads on new copies are authorized measurements, not old E1 retry.

## Saving / usage

P0 start2026-09-29 around13:20UTC: normal codex7%used/93%remaining,10080-minute window/reset1791200482, ordinaryUsageAllowed=true. Account-wide, not task-exclusive. See [usage log](USAGE-LOG.md). New source/baseline checkpoints not yet complete. Latest containing-document SHA comes from Git history; do not self-reference. Update this entry at milestones and final stop.
