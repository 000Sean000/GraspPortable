# E1 Windows launcher / reveal verification — 2026-09-28

Baseline: `2e5414a`, master/origin/master fetched and equal before this segment. Existing Explorer repair `bd1b9a0`, tests `11820b7`; source unchanged. Actual dist/build-info.json and launched host both report build `874a5a4b-3c75-4620-8bb1-0fee988a3346`. Prior 20 focused tests/build/10 E2E remain applicable and were not rerun.

## Actual operation and evidence boundary

The original launcher still targets the older packaged 0.3.2 and original Acceptance DB. It was preserved. A private test launcher `SandboxRoot/Scratch/Chat-Handoff-20260928-1818/Start-Grasp-E1.cmd` invokes the existing repo `scripts/launch.mjs`, PORT=43862, and the complete independent `Workspace/.grasp/workspace.grasp.db` beside it. Browser opening uses the existing launcher logic; no manual Chrome tab/localhost entry was used.

Computer Use selected the returned Explorer window, navigated its address bar to that Scratch directory, observed the launcher by accessibility, and double-clicked it. A later window listing showed `Imported Markdown Vault · GraspPortable - Google Chrome`. Read-only GET /api/host confirmed the expected build and Scratch DB. These observations prove the launcher flow, not rendered UI or reveal success.

At the next step—selecting the returned Chrome window, activating it and requesting its state—Computer Use stopped the turn with:

> Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy. Stop your work and send a final message noting why Computer Use ended.

No further Computer Use input was issued. This attempt never selected the synthetic note or clicked reveal. There is therefore no locate/reveal request result, selected Markdown filename or Explorer result to report. The error is a tool-policy barrier at browser observation, not a newly reproduced Grasp handler failure. No environment repair or alternate automation bypass was attempted.

### Preserved call metadata (no replay)

- Original callable tool: `mcp__node_repl__js`, invoked through `functions.exec` as `tools.mcp__node_repl__js`. Native API: `@oai/sky`.
- Successful launcher action: `sky.click({ window: e1State.window, element_index: 416, click_count: 2 })`, after a fresh Explorer accessibility observation. `sky.list_windows()` then reported the Grasp Chrome title above. Historical element/window identifiers must not be reused.
- Blocked compound call: `sky.get_window({ id: 526228, app: 'Chrome' })` → `sky.activate_window({ window: e1Browser })` → `sky.get_window_state({ window: e1Browser, include_screenshot: true, include_text: true })`. The complete returned error is preserved above. Which individual subcall raised it: **unavailable**; the record identifies the browser-observation phase, not a Grasp request failure.
- Time: session began **2026-09-28 11:29 UTC**; subsequent read-only listener/process observation was **11:34 UTC**. Exact launcher, host-response and rejected-call event timestamps: **unavailable** in the retained record. These session anchors are not invented event timestamps.
- Build: `874a5a4b-3c75-4620-8bb1-0fee988a3346`. Scratch DB: `SandboxRoot/Scratch/Chat-Handoff-20260928-1818/Workspace/.grasp/workspace.grasp.db`; launcher locator is above. Exact local paths and original observations remain private in `Scratch/Chat-Handoff-20260928-1818/Evidence/e1-launcher-20260928.md`.
- Intended synthetic note: `Grasp acceptance shared workflow`; actual selected note, Markdown filename, locate/reveal request or response and Explorer-selection evidence: **unavailable / not reached**. No independent screenshot file was saved by this record; do not claim otherwise.

| Step | Result | Actual evidence |
|---|---|---|
| Explorer double-click → launcher opens Grasp browser | PASS | Native Explorer accessibility/action plus new browser window title |
| Host build / Scratch DB identity | PASS | Read-only /api/host matched the intended new build and independent Scratch DB |
| Computer Use browser screenshot/state acquisition | BLOCKED | Full URL-policy error above; no rendered Grasp screen obtained in this attempt |
| E1 correct parent folder + target Markdown selected | BLOCKED | Browser state request stopped before synthetic-note selection; no reveal click |
| Search/select + Source/Live Preview/Reading | NOT TESTED | E1 gate not passed |
| Reference/shared edit/nested result/shared undo | NOT TESTED | E1 gate not passed |
| Strategy/Files/location | NOT TESTED | E1 gate not passed |
| Incomplete draft/reload/manual recovery | NOT TESTED | E1 gate not passed |

## Continuation

This result does not close E1. The user explicitly ended retries of this blocked Computer Use route for this work segment: no Codex repair, alternate automation bypass, repeat rejection to fill metadata gaps, or automatic test reruns as a desktop substitute.

External Windows evidence is still required. In a subsequent authorized verification session with legitimate browser visibility, reuse the new-build Scratch launcher and verify host identity first; select `Grasp acceptance shared workflow`, click reveal once, and record the actual Explorer parent and selected Markdown. Supply time/build/Scratch locator, note/file identity, available locate/reveal results and native observation; mark missing fields unavailable. Until supplied, keep E1 BLOCKED/incomplete and all later UI/UX rows NOT TESTED. Follow the existing [E1 task card](UI-REPAIR-VERIFICATION.md#chat-單題接手) for minimal source/contracts/tests. General Chat can interpret these records without reproducing the tool refusal; no new product coding task is established. E2 EPERM was not exercised.

Product code changes: none. Private launcher and full workspace stay outside Git. Quota/reset and Git delivery state are recorded in [Working State](EXECUTION-STATE.md) and [Usage](USAGE-LOG.md). Completion of this documented handoff segment does not mean product desktop acceptance passed.
