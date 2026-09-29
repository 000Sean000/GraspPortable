# High-capability quota log

Append-only milestone evidence. Source is Codex `get_usage_limits`, account-wide used percentage (integer percentage points, not task-specific tokens). Deltas are meaningful only within the same reset window; concurrent account activity may contribute. Window: 10,080 minutes, reset Unix timestamp 1791048521. Ordinary high-capability usage was allowed at both snapshots below. Commit associations are appended after Git creates the hash; no history rewriting.

| Milestone | Start UTC | End UTC | Usage start | Usage end | Consumed | Duration | Commit | Source | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-1 Planning and baseline UX audit | 2026-09-27 00:14:54 | 2026-09-27 00:25:11 | 19% | 26% | 7 pp | 10m 17s | Association appended after checkpoint | Codex account quota, same window | 2,820-note read-only inventory; production UX audit; build and 54 tests pass; reversible execution choices |

P2-1 commit association: `2eef544ac4a7908c99aad6aea8e9147dc30756d1`, pushed and remote SHA verified before implementation.

| Milestone | Start UTC | End UTC | Usage start | Usage end | Consumed | Duration | Commit | Source | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-2 Workspace navigation foundation | 2026-09-27 00:27:45 | 2026-09-27 00:44:14 | 26% | 32% | 6 pp | 16m 29s | Association appended after checkpoint | Codex account quota, same reset window 1791048521 | Schema 2 upgrade/backup, folder/navigation/link UX, editor continuity and stale-draft protection; build, 94 tests and 14 E2E pass; manual browser use |

P2-2 commit association: `2bc1bcd87568e7b31b1eb848555c5c60a8afaf08`, pushed and remote SHA verified before M3.

| Milestone | Start UTC | End UTC | Usage start | Usage end | Consumed | Duration | Commit | Source | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-3 Knowledge and record management | 2026-09-27 00:46:06 | 2026-09-27 01:02:11 | 33% | 38% | 5 pp | 16m 05s | Association appended after checkpoint | Codex account quota, same reset window 1791048521 | Full knowledge/record browsing, reviewed semantic rename, query navigation and recovery scope; build, 129 tests and 16 E2E pass; personal UI rename/edit/recovery |

P2-3 commit association: `52ffe9967cc820c96f66bb5a30a7d9eccb0c9150`, pushed and remote SHA verified before M4.

| Milestone | Start UTC | End UTC | Usage start | Usage end | Consumed | Duration | Commit | Source | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-4 Files, attachments and Markdown fallback | 2026-09-27 01:03:59 | 2026-09-27 01:23:46 | 38% | 48% | 10 pp | 19m 47s | Association appended after checkpoint | Codex account quota, same reset window 1791048521 | Schema 3 DB assets, visible files/exchange, immutable incremental mirror, validated new-DB rebuild and broken-DB startup UI; build, 159 tests and 19 production E2E pass; 2,820-note projection benchmark and personal UI use |

P2-4 commit association: `07e53b9ed7168ae2967632fba21a8f94b1a57831`, pushed and remote SHA verified before M5.

| Milestone | Start UTC | End UTC | Usage start | Usage end | Consumed | Duration | Commit | Source | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| P2-5 Real migration and v0.2 release | 2026-09-27 01:25:11 | 2026-09-27 01:54:18 | 48% | 58% | 10 pp | 29m 07s | Association appended after checkpoint | Codex account quota, same reset window 1791048521; ordinary usage allowed | 160-note/11-asset private rehearsal, source fidelity and unchanged full original vault, CRLF/BOM editor/import fixes, manual UI/restart, build 179 tests/20 E2E and isolated v0.2 package smoke |

Five major milestones consumed 7 + 6 + 5 + 10 + 10 = 38 percentage points across their measured intervals. The full goal span increased from 19% to 58%, or 39 percentage points in the same account window (1h 39m 24s); the extra point is between milestone snapshots, not silently attributed. Files/mirror and migration/release each used 10 pp, the largest measured segments. This is account-wide integer quota evidence, not precise per-task billing or token consumption. Final Git/documentation closeout occurs after this validation snapshot.

P2-5 commit association: `450c25e8ad07e1990e88c3c57950b6c3ec9e9a90`, pushed to origin/master and exact remote SHA verified. This commit contains the complete validated v0.2 source, synthetic tests and public delivery evidence.

Final Git/documentation closeout snapshot: 2026-09-27 01:58:05 UTC, 59% used, ordinaryUsageAllowed=true, same reset window 1791048521 (Codex get_usage_limits). Account-wide goal span is now 19% -> 59% = **40 pp**, over 1h 43m 11s. The five major milestone intervals total 38 pp; 1 pp fell between milestone intervals and 1 pp during final release review/Git/documentation closeout. These are observed integer account percentages, not exclusive task charges. No reserve/fallback model or reset credit was used. The append-only commit association is recorded in a separate documentation checkpoint to avoid rewriting the release commit.

## v0.2 Acceptance Preparation

Separate bounded task after Phase 2: initialization observed 60% used; final pre-checkpoint snapshot at 2026-09-27 05:48:04 UTC observed 72% used, ordinaryUsageAllowed=true, same reset window 1791048521. Observed account-wide difference: 12 pp; no reserve model or reset credit was used. Start timestamp is not retained here, so no exact duration is claimed. The checkpoint adding this entry contains the validated single projection, direct Explorer workflow, acceptance layout guide, 189 tests / 21 E2E evidence and updated files benchmark. Private acceptance/source/rehearsal artifacts stay outside Git.

## Durable planning continuity publication — 2026-09-27

This is a separate docs-only Goal before M1 product coding. Start snapshot: **2026-09-27 14:14:41 UTC, 89% used**, ordinaryUsageAllowed=true. Pre-publication validation snapshot: **2026-09-27 14:31:24 UTC, 94% used**, ordinaryUsageAllowed=true. Both are Codex `get_usage_limits` account-wide observations, same 10,080-minute window ending Unix `1791048521`: **5 percentage points over 16m 43s**. Integer account usage may include concurrent activity; it is not task-exclusive billing. This interval ends before Git commit/push closeout, which is not silently included in that duration. No Luna Reserve or reset credit was used. Recheck ordinary quota before a future M1 run.

Delivered content: sole current Working State entry, full A+B plan, Binding/Reference codec contract, Projection semantic-unit/export/rebuild contract, Shared Value consistency/persistence contract, updated host-gate evidence and settled semantic-over-link-visual decision. Seed remains unchanged. Scope excludes product source/tests/config/private data. The pre-existing untracked host diagnostic test remains local and is not required to rehydrate the published plan.

Validation: existing build passes; all **23 tracked test files / 189 tests pass** at 22:23 Asia/Taipei (4.66s). Tests were enumerated by `git ls-files 'tests/*.test.ts'` and supplied explicitly to Vitest, excluding the untracked 32-case diagnostic file. No new conformance, production E2E, benchmark or private-vault test was claimed. The six continuity documents have **37 valid relative file links** (fenced examples and inline syntax excluded); `git diff --check` passes. An independent reviewer without original conversation context read the Working State locators and verified rehydration after missing-file/authorization wording fixes.

Checkpoint association is deliberately obtained from Git rather than inventing this file's future self-SHA: `git log origin/master --format='%H %s' --grep='^docs: publish durable planning continuity$' -1`. The publication commit must contain docs only and be reachable from the verified remote master before this Goal is complete. Subsequent milestones append their own actual quota observations and update EXECUTION-STATE progress/evidence/stop point/next action; provider memory is never the only continuity record.

## Product Goal — M1 lexical codec segment

Start: **2026-09-27 15:07:39 UTC, 95% used**. Validation snapshot: **2026-09-27 15:16:52 UTC, 97% used**, both ordinaryUsageAllowed=true, Codex get_usage_limits, same 10,080-minute window/reset `1791048521`. Account-wide change **2 pp over 9m 13s**, not exclusive task billing; excludes subsequent documentation/Git closeout. No reserve model/reset credit used.

Delivered bounded segment: lossless raw-literal/binding and two-form reference codecs, exact UTF-16 spans, exhaustive/fixed-seed/adversarial cases, reviewed host diagnostics. Build and 26 files / 276 tests pass. Full M1 context/host/reconstruction gate and M2–M4 remain outstanding; full A+B Goal is not complete. Checkpoint locator: `git log origin/master --format='%H %s' --grep='^feat: add lossless binding and reference codecs$' -1`.

Lexical checkpoint: `8048da627fc7e27f26d5de6b7ab7fcc295d7fac9`, pushed to origin/master and exact remote SHA verified at 2026-09-27 15:21:01 UTC; 97% used, ordinaryUsageAllowed=true.

## Product Goal — bounded context and source fidelity segment

Start snapshot **2026-09-27 15:21:01 UTC, 97% used**; validation **2026-09-27 15:28:26 UTC, 99% used**. Both ordinaryUsageAllowed=true, same Codex account window/reset `1791048521`: **2 pp / 7m 25s**, not exclusive task billing, excludes subsequent documentation/Git closeout. No Luna/Reserve/reset used.

Validated context shielding and fake-fence regression, 29 context tests, 3 raw-source/DTO integration tests, full 308-test suite and build. CLI parser benchmark and 8-pass limitation are in M1-VERIFICATION; M1 not complete. Human accepted durable draft/missing-cycle commit/independent semantic undo decisions, now saved in SHARED-VALUE-CONTRACT. Checkpoint subject: `feat: isolate note syntax contexts and preserve source edits`.

Context checkpoint `d69ea80ad6bcf9cbe8e18ea519f7e2c63855003f` pushed and exact remote SHA verified at **2026-09-27 15:32:12 UTC**, clean master, 99% used, ordinaryUsageAllowed=true.

## Quota hard stop — product Goal incomplete

**2026-09-27 15:33:59 UTC**: Codex quota shows **usedPercent=100**, displayed remaining **0%**, same 10,080-minute window/reset `1791048521`. `ordinaryUsageAllowed` still reports true; the agent applied the user's stop rule on the visible 100% usage and did not assume reserve authorization from that flag. Substantive implementation/research/debug/benchmark stopped immediately. No Luna/Reserve/reset credit used; subsequent activity is minimal docs/Git safe closeout only.

Account-wide start 95% → stop 100% = **5 pp over 26m 20s**. Two measured implementation segments total 4 pp; the other observed point falls during subsequent integration/documentation/Git and brief next-step API inspection. These are integer shared-account observations, not task-exclusive billing. The final state is **因額度停止**, not Goal complete. Both product checkpoints are on origin/master; no product edits remain uncommitted. Exact next action, tests, benchmark, M1 limit and M2 accepted policies are in EXECUTION-STATE and linked contracts.

Safe-closeout commit message: `docs: record quota stop and exact M1 continuation`.

## User-reset continuation — 2026-09-27

User reported resetting quota. Live snapshot **2026-09-27 15:38:17 UTC** confirms **0% used**, ordinaryUsageAllowed=true, 10,080-minute window with **new reset `1791128122`**. This is a new window; do not subtract its usage from the previous 100% observation. Agent did not invoke a reset credit or switch to Reserve. Goal tracking restored as active, same A+B scope. Git preflight: clean `master`, successful fetch, HEAD=origin/master=`6f49e57a3a99e439f952d4305784464051348541`, 0/0 divergence; no pull required. Resume at M1 context limit and representation/source-bundle reconstruction, preserving accepted M2 decisions.

## M1 semantic and representation gate — 2026-09-27 15:56:25 UTC

Codex usage-limits tool: ordinaryUsageAllowed=true; normal account bucket usedPercent=8; windowDurationMins=10080; resetsAt=1791128122. Same user-reset window as 15:38:17 UTC / 0%: account observation +8 percentage points in 18m 08s, not a task invoice. No Reserve / Luna / reset credit used by the agent.

Output: removed context pass ceiling with scaling evidence, exact single-note source bundles and readable representation, 10 synthetic Scratch fixtures, 29 files / 361 tests pass, production build pass. Desktop Obsidian / Explorer / native IME remain unverified. Next: milestone commit/push, then M2 shared editing without a new approval gate.

## M2 shared editing validation — 2026-09-27 16:50:35 UTC

Codex usage-limits tool: **31% used**, ordinaryUsageAllowed=true, normal 10,080-minute bucket/reset `1791128122`. Since M1 at 15:56:25 UTC / 8%: **23 percentage points / 54m 10s**, account-wide observation rather than task-exclusive billing. Intermediate check at 16:35:19 UTC was 24%. No Luna/Reserve or reset credit invoked.

Output: versioned shared semantics and persisted caches; durable draft/source journals; part-specific reference editing; operation receipts/replay/guarded shared undo; source patch and in-flight typing rebase; Reading mode; draft recovery/discard safeguards. Tests and benchmark scope/results are in [M2 verification](M2-VERIFICATION.md). Full A+B product Goal remains active; M3 semantic-unit strategy/full fallback and M4 MainVault roundtrip are next. Checkpoint locator subject: `feat: deliver consistent shared editing and durable drafts`.

## M3 semantic projection and recovery — 2026-09-27 17:39 UTC

Normal Codex usage bucket: **55% used**, ordinaryUsageAllowed=true, 10080-minute window/reset `1791128122`. M2 snapshot at 16:50:35 UTC was31%; approximately49minutes/+24percentagepoints account-wide, not exclusive task billing. Intermediate observations:17:25:02UTC47%,17:34–17:36UTC54%. No Luna/Reserve/reset invoked.

Output: semantic-unit strategy/package/review, deterministic partial/full renderer, trusted multi-file external import, schema5 persistence, single checkpoint publisher, two independent recovery generations, streamed rebuild and migration foundation, App projection UI. Full512tests/build and36productionE2E pass. M4 full private-corpus and scale10 workload remain; do not mark full Goal complete. Checkpoint subject: `feat: add semantic projection strategy and portable recovery`.

## M4 full private-corpus verification checkpoint — 2026-09-27 about18:06UTC

Normal Codex account bucket66%used, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. Since M3 17:39UTC55%: observed+11percentagepoints/about27minutes, not exclusive billing. No Luna/Reserve/reset invoked.

Full MainVault copy roundtrip passed at17:54:31UTC:2820notes/506attachments exact hashes, source unchanged, fullfallback/newDB/strategy/identities/shared re-edit/restart. Productionbrowser onfullcopy passed18:02:15, nativeGUI unverified. Actual512-test/36E2E M3 baseline remains published; further launcher/editor/locate code still under validation. Large-input500ms regression gate remains open, all failed samples retained. This checkpoint saves verified corpus evidence and exact continuation, not Goal completion.

## M4 final product validation — 2026-09-27 18:21:36 UTC

Normal Codex bucket **71% used**, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. Since the18:06UTC/66% corpus checkpoint, observed+5percentagepoints/about16minutes account-wide; not task-exclusive billing. No Luna/Reserve/reset credit invoked.

Final evidence:41files/528tests pass12.75s;36productionEdgeE2E pass1.8m;scale10 10k/50k fullsuite pass;12kdeep/fanout/mixed/repeated-edits/SQLite benchmark;fullcorpus browser9.089s locate with generation unchanged. Package and actual acceptance .cmd launch subsequently passed18:22–18:23UTC. M1–M4 product delivery complete with explicit nativeGUI and performance limitations, not a quota stop. Final checkpoint subject: `feat: deliver validated v0.3 acceptance package and scalable editing`.

## UI repair Goal start — 2026-09-27 20:14 UTC

Normal usage bucket73%used (27%remaining), ordinaryUsageAllowed=true,10080-minute window/reset1791128122. New authorized Goal diagnoses and repairs v0.3 unresponsive UI; prior M1–M4 completion is not evidence that this regression is fixed. Clean/fetched8e3d3f0 baseline, exact running package/build/workspace verified. User now explicitly permits normal-quota Luna subagents; two workers requested via actual model=gpt-6-luna selector. No separate serving-model metadata exposed. All workers still stop at100%; no Reserve/reset credit used.

## UI repair validation in progress — 2026-09-27 20:37 UTC

Normal bucket78%used, ordinaryUsageAllowed=true; same10080-minute/reset1791128122 window. Start73%→78% is account observation, not exclusive task cost. User reported quota reset but current host still reports these values; no agent reset/reserve invoked. Production0.3.1 build,536tests and6focused browser regressions passed; full44 E2E first run43pass/1fixture-assumption failure, corrected and awaiting final rerun. Full-corpus private browser and packaging still pending.

## UI repair integration continuation — 2026-09-27 about20:59 UTC

Normal bucket82%used, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. Second full44 E2E had43pass/1real locate pending-state race; retained at Scratch/UI-Repair-Integration-SecondRun.537unit tests passed before the server race fix. Full-corpus A flows passed; B/draft and package/launch remain pending. All agents remain on ordinary quota; no reset/reserve used.

## UI repair core checkpoint — 2026-09-27 21:05:55 UTC

Normal bucket84%used, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. Start73%→84% is shared-account observation, not exclusive billing. User reset report has not appeared in host readings. Final0.3.1 build bcab7a56-8871-45b9-bd04-4430de960c4f passes42files/540tests (7.07s) and44productionEdgeE2E (1.2m). Metadata-only locate race has deterministic regressions; real content/dirty safeguards remain. Core fix is ready for checkpoint/push; private B/draft, package and actual launch update remain. No Reserve/reset invoked.

## UI repair original-workspace deployment follow-up — 2026-09-27 21:32:58 UTC

Normal bucket88%used, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. Core checkpoint84%→88% is account observation, not exclusive task billing. Private B/draft and title-recovery checks passed;0.3.1 package/real entry verified and original whole-workspace offline backup hash/integrity passed. Original Acceptance directory rename returns Windows EPERM, leaving DB53/public13; exact bytes comparison3333/3333 matches. No unknown process terminated or ACL changed.0.3.2 error-preservation fix+focused RED/GREEN complete;build+541tests pass7.75s and45E2E stillrunning atthissnapshot. Human directory-release questionpending; Goalnotcomplete, notquota-stop. No Reserve/reset invoked.

Subsequent validation completed in the same segment: all45production Edge E2E passed1.2m, no skipped/flaky; no product changes after build4102f62d-bfca-4a69-90d5-3c7027963cdc.

## UI repair safe handoff — 2026-09-27 21:43:05 UTC

Normal account bucket89%used (11%remaining), ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. No Reserve/reset credit used.0.3.2 implementation checkpoint a52b67ec9239d852700af62443982bc1c0c408d7 pushed and remote SHA verified; working tree clean at observation.541tests/45E2E/package smoke pass; actual acceptance host build4102f62d-bfca-4a69-90d5-3c7027963cdc returnsHTTP200 with originalDB. Stop is awaiting Human response to Windows directory EPERM, NOT quota exhaustion and NOT Goal complete. Publication-path privacy concern was resolved by normalizing80E2E source paths and auditing exact staged payloads before approval/push.

## Original-directory diagnostic continuation — 2026-09-27 21:52:58 UTC

Normal account bucket90%used (10%remaining), ordinaryUsageAllowed=true; same10080-minute/reset1791128122 window. Start21:45 and end21:52 both90%; account observation only. Read-only Win32 root/tree access and host-token diagnostics completed; all3594 original-tree handle opens succeeded outside Codex restricted sandbox, yet one existing App checkpoint still EPERM (52.050s). DB53/public13/recovery53 preserved, no active journal. No product changes/new heavy tests, no Reserve/reset or external application termination. Previous541tests/45E2E remain the product validation; these probes do not resolve original publication. Human response remains pending; Goal not complete and not quota-stopped.

## Blocked audit — 2026-09-27 21:54:55–21:56 UTC

Normal account bucket91%used (9%remaining), ordinaryUsageAllowed=true; unchanged10080-minute/reset1791128122 window. Live host/state check confirms existing EPERM, DB53/public13/recovery53, dirty0 and no active journal. Same blocker persisted across three consecutive Goal turns; all workers completed and Human response is pending. Goal tool now reports blocked (not complete, not quota-stop). No new product mutation, checkpoint retry or heavy tests this turn. Existing validation retained; only minimal durable blocked-state handoff. No Reserve/reset used.

## Computer Use / publication resumed Goal — 2026-09-28 04:03–04:15 UTC

Normal account bucket92%used at resumed start,93% at segment observation (7%remaining), ordinaryUsageAllowed=true; same10080-minute/reset1791128122 window. Account observations, not isolated task cost. User resumed with CU-first and small Chat handoffs. No node_repl callable tool despite installed/enabled plugin and configured MCP; no GUI/approval success claimed. One real protected original checkpoint returned EPERM51.966s. Scratch host0.3.2 was ready DB89/public89; interrupted processes/listeners verified absent and only Scratch restarted. Luna worker limited to source review and three compact handoff cards; no product code or heavy test rerun. Goal active/incomplete, not quota-stop; no Reserve/reset or privilege change.

## Computer Use blocked audit — 2026-09-28 04:19:23 UTC

Normal account bucket94%used (6%remaining), ordinaryUsageAllowed=true; same10080-minute/reset1791128122 window. Required Computer Use/node_repl callable entry remained absent across at least three resumed Goal turns. Current tool list rechecked; Scratch PID5836/listener43862 exists, original43861 absent. No GUI action or app-approval was possible; no source changes, publication retries, heavy tests or new workers. Goal tool confirms blocked, not complete or quota-stop. Minimal handoff only; user MCP-startup question remains pending. No Reserve/reset used.

## Architecture / Chat handoff — 2026-09-28 10:09–10:25 UTC

Source: live get_usage_limits, normal codex bucket, 10080-minute window/reset1791128122 (2026-10-04T15:35:22Z). ordinaryUsageAllowed=true throughout these observations.

| UTC | Used / remaining | Segment evidence |
| --- | --- | --- |
| 10:09:24 | 95% / 5% | Start; clean 9eeabc4; no subagents |
| 10:12:50 | 96% / 4% | Fetched 8813e75; source/contract audit; fast-forward approval rejected twice |
| 10:17:02 | 96% / 4% | User explicitly superseded smoke-test read-only restriction; resume |
| 10:21:27 | 96% / 4% | Fast-forward; 20 focused tests/build/10 E2E PASS; full Scratch copy; CU URL-policy stop; host stopped |
| 10:24:43 | 97% / 3% | Working State and existing task index saved; final document/payload review |

Same-window +2 percentage points is shared-account observation, not task-exclusive billing. No subagents, Reserve or reset credits used. Current stop is coherent handoff after publishing, not quota exhaustion; native GUI selection remains unverified. Earlier CU-missing/original-publication blockers are historical. Build874a5a4b-3c75-4620-8bb1-0fee988a3346; no new product code beyond already committed Explorer repair.

## E1 launcher-first Goal — 2026-09-28 11:29 UTC onward

Normal get_usage_limits: 11:29:02UTC=98%used/2%remaining; 11:35:14UTC=99%used/1%remaining, ordinaryUsageAllowed=true, same10080-minute/reset1791128122 window. A intervening batch containing a usage read did not return; marked unavailable and its read-only wait terminated, not interpreted as reset. Same-window +1point is account-wide, not task-exclusive usage. No reset observed yet; new-window usage/remaining unavailable.

Current user instruction: user resets manually during this same Goal; normal delivery after observing reset and >=1% new-window total used, maximum10% including all closeout work. Do not cross-subtract windows, invoke reset/Reserve, or spend an extra1% if first new-window observation is already >=1%. No subagents.

Segment: fetched clean2e5414a 0/0; reused verified build874a5a4b and full Scratch copy. Prepared private launcher using existing launch.mjs, double-clicked it with real Explorer CU; browser title and /api/host confirm launch/build/DB. CU browser observation stopped by URL-policy before note selection/reveal. E1 BLOCKED, later UI steps NOT TESTED; no product changes or test rerun. Live Scratch host checked11:34UTC. State/evidence saved as a recoverable checkpoint, Goal active/not achieved, no separate reset-monitoring task.

11:36:59UTC post-checkpoint:100%used/0%remaining, ordinaryUsageAllowed=true, same reset1791128122; no observed reset. a8d5539 pushed and remote SHA verified, clean tree. 因額度停止 substantive work; only this minimal closeout record remains. No Reserve/reset/subagents. Goal remains active/incomplete; resume same stop point after restored normal quota. This is not the user-specified normal post-reset delivery.

## User-reset E1 evidence handoff — 2026-09-28

The user reported remaining1% while the old tool reading was100%used with ordinaryUsageAllowed=true. This discrepancy was not resolved; do not infer that ordinary service was demonstrably unavailable or invent a rounding explanation. A pending read-only batch was terminated after failing to return; its snapshot is unavailable. The user then reported a manual reset. No reset/Reserve/credits or subagents were invoked by this agent.

Live `mcp__codex_app__get_usage_limits` subsequently confirmed the **new** normal codex window:10080minutes, resetsAt **1791200482**, ordinaryUsageAllowed=true. First returned value **0%used /100%remaining**, received between the11:42:31 and11:42:53UTC clock observations (exact tool snapshot timestamp unavailable). Previous reset1791128122 is a different window and is not subtracted from this one.

**2026-09-28 11:45:48 UTC**: new-window total **1%used /99%remaining**, same reset1791200482 and ordinaryUsageAllowed=true. The minimum post-reset usage condition is met; finish only documentation validation, commit/push and remote verification, then stop. These are account-wide integer observations, not task-exclusive billing;10% is the total new-window cap, not a target.

Pre-reset outcome: actual Explorer launcher flow and host build/Scratch DB identity PASS; CU browser observation blocked by URL policy before note/reveal; no product code changes or automatic test reruns. Post-reset scope was explicitly narrowed by the user to durable handoff, without retrying the rejected operation, repairing Codex or bypassing through another automation route. Retained original callable/API names, full error, time precision/unavailable fields, build and private locator; corrected current Task Index and host/new-tab historical distinctions. E1 native selection and later UI/UX remain incomplete, pending external Windows evidence; no new product bug or coding task is asserted.

Docs-only checkpoint subject: `docs: hand off blocked E1 desktop verification`. Starting checkpoint9f5a306f40303702cc93b5cc5e36c9c7510cd2fc was clean; fetch succeeded and HEAD/origin/master were0/0. Actual final SHA/push/remote/tree and final usage are verified at delivery, not invented here. The delivered work segment is a recoverable handoff, not product desktop acceptance completion.

## P0 performance baseline start — 2026-09-29 13:20 UTC

Live get_usage_limits: normal codex7%used/93%remaining,10080-minute window/reset1791200482, ordinaryUsageAllowed=true. Account-wide observation, not task billing. New accepted P0 scope supersedes old E1-only closeout; old10% condition is not reapplied. Three agents prepare bounded host/browser/runner work; source writes held until docs continuity checkpoint. Git fetch succeeded after network escalation, HEAD/origin0/0 at dd98b21. No Reserve/reset used.

## P0 integration observation — 2026-09-29

Around13:37UTC, `mcp__codex_app__get_usage_limits`: normal codex14%used/86%remaining;10080-minute primary window/reset1791200482;ordinaryUsageAllowed=true. Same account window as P0 start7%:observed account increase7percentagepoints, not exact task consumption. Source freeze/three copies and instrumentation implementation underway; no Reserve/reset used.

## P0 integration validation — 2026-09-29 13:52:43 UTC

Live `get_usage_limits`: normal codex22%used/78%remaining;10080-minute primary window/reset1791200482;ordinaryUsageAllowed=true. Same account window:8percentagepoints above interim14%,15above start7%; account-wide observations, not task billing. Complete frozen source and3trial copies verified; instrumentation unit suite577 PASS, updated host73/browser27/runner14focused PASS; production build and45E2E PASS. Diagnostic smoke evidence remains private; formal baseline still pending. No Reserve/reset used.

## P0 full-corpus diagnostic validation — 2026-09-29 14:25:09 UTC

Live `get_usage_limits`: normal codex30%used/70%remaining;10080-minute primary window/reset1791200482;ordinaryUsageAllowed=true. Same-window8percentagepoints above previous22%; shared-account observation, not task billing. Complete7-cell diagnostic smoke:3,866,695host events,0loss/sink errors/open spans,184actual publication overlaps and original data unchanged. Recovery verification underway; formal trials remain pending. Source checkpoint0b4dd58 is local only. No Reserve/reset used.

## P0 measurement harness gate — 2026-09-29 14:42 UTC

Live `get_usage_limits`: normal codex35%used/65%remaining;10080-minute primary window/reset1791200482;ordinaryUsageAllowed=true. Same-window5percentagepoints above previous30%; account-wide, not task billing. Full-corpus recovery passed; final full-count synthetic harness coverage passed with all7cells, direct action evidence, truegraph/DB/publication overlaps and zero event loss.47files/589tests passed plus later16runner/5aggregator focused tests andTypeScript. Fetch origin succeeded again,local2ahead/0behind. Three formal full-corpus trials remain pending. No Reserve/reset used.
