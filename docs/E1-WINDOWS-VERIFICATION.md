# E1 Windows launcher / reveal verification — 2026-09-28

Baseline: `2e5414a`, master/origin/master fetched and equal before this segment. Existing Explorer repair `bd1b9a0`, tests `11820b7`; source unchanged. Actual dist/build-info.json and launched host both report build `874a5a4b-3c75-4620-8bb1-0fee988a3346`. Prior 20 focused tests/build/10 E2E remain applicable and were not rerun.

## Actual operation and evidence boundary

The original launcher still targets the older packaged 0.3.2 and original Acceptance DB. It was preserved. A private test launcher `SandboxRoot/Scratch/Chat-Handoff-20260928-1818/Start-Grasp-E1.cmd` invokes the existing repo `scripts/launch.mjs`, PORT=43862, and the complete independent `Workspace/.grasp/workspace.grasp.db` beside it. Browser opening uses the existing launcher logic; no manual Chrome tab/localhost entry was used.

Computer Use selected the returned Explorer window, navigated its address bar to that Scratch directory, observed the launcher by accessibility, and double-clicked it. A later window listing showed `Imported Markdown Vault · GraspPortable - Google Chrome`. Read-only GET /api/host confirmed the expected build and Scratch DB. These observations prove the launcher flow, not rendered UI or reveal success.

At the next step—selecting the returned Chrome window, activating it and requesting its state—Computer Use stopped the turn with:

> Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy. Stop your work and send a final message noting why Computer Use ended.

No further Computer Use input was issued. This attempt never selected the synthetic note or clicked reveal. There is therefore no locate/reveal request result, selected Markdown filename or Explorer result to report. The error is a tool-policy barrier at browser observation, not a newly reproduced Grasp handler failure. No environment repair or alternate automation bypass was attempted.

| Step | Result | Actual evidence |
|---|---|---|
| Explorer double-click → launcher opens Grasp browser | PASS | Native Explorer accessibility/action plus new browser window title; host build/DB independently checked |
| E1 correct parent folder + target Markdown selected | BLOCKED | Browser state request stopped before synthetic-note selection; no reveal click |
| Search/select + Source/Live Preview/Reading | NOT TESTED | E1 gate not passed |
| Reference/shared edit/nested result/shared undo | NOT TESTED | E1 gate not passed |
| Strategy/Files/location | NOT TESTED | E1 gate not passed |
| Incomplete draft/reload/manual recovery | NOT TESTED | E1 gate not passed |

## Continuation

This result does not close E1. Reuse the new-build Scratch launcher; verify any live host's identity first. When Computer Use can observe the launcher-opened Grasp browser without a policy stop, select `Grasp acceptance shared workflow`, click reveal once, and verify the real Explorer parent directory and selection. Follow the existing [E1 task card](UI-REPAIR-VERIFICATION.md#chat-單題接手) for source, contracts and tests. General Chat can review the evidence; native Windows verification remains necessary. E2 EPERM was not exercised.

Product code changes: none. Private launcher and full workspace stay outside Git. Quota/reset and Git stop state are recorded in [Working State](EXECUTION-STATE.md) and [Usage](USAGE-LOG.md); a tool barrier or this document alone is not Goal completion.
