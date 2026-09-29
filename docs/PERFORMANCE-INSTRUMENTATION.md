# P0 performance observations

Authority: [accepted plan](PERFORMANCE-ISOLATION-PLAN.md). P0 adds observation and private, immutable run directories. It does not change execution ownership, scheduling, timeouts, caching, save acknowledgements or portable formats. [Working state](EXECUTION-STATE.md) records actual validation and completion; this document describes the measurement interface, not a passing performance claim.

## Enable and collect

Host: set `GRASP_PERF_TRACE` to a **new absolute JSONL filename** whose parent exists. The sink uses exclusive creation and never overwrites an earlier run. Default is disabled. `GRASP_PERF_MAX_EVENTS` accepts a positive integer, defaults to 2,000,000 and caps at 10,000,000; the in-memory queue is bounded at 8,192 events. Sink errors and overflow are counted; observations must not turn a successful product mutation into a failure. Graceful shutdown flushes the sink and emits a terminal summary. A missing summary or nonzero loss must be reported, not silently ignored.

Browser: set `globalThis.__GRASP_PERF_ENABLED__ = true` in a browser initialization script before application modules load. `window.__GRASP_PERF__.snapshot()` reads observations; `drain()` empties the bounded buffer while retaining cumulative loss. The collector retains at most 20,000 events. The production harness drains between workload cells. Instrumentation is absent from the public global interface when disabled.

Host and browser events use version 1, a logical lane, fixed event name, `start/end/instant/sample`, generated span ID, epoch timestamp, optional duration/outcome and allowlisted metrics. Request IDs join HTTP responses to the host trace; publication IDs join asynchronous stages; runtime job IDs join browser and worker events. These are generated diagnostic identifiers, not workspace/note identifiers. No raw Markdown, query text, title, full private path or unrestricted error message is accepted into trace events. Harness errors, manifests, screenshots and workspace copies remain private under Scratch.

When enabled, `GET /api/diagnostics/performance/clock` returns host time and sink counters behind existing host/origin guards. Repeated clock round trips bound uncertainty. A sample is under load only when its interval provably intersects the relevant measured background interval after calibration; request acceptance or a busy label alone is insufficient.

## Meaning and limits

| Observation | Meaning |
| --- | --- |
| Browser input/selection/click to rAF | Handler-to-next-animation-frame proxy; not physical input-to-pixel or native IME proof. Hidden views are identified. |
| Browser event timing / long tasks / frame gaps | Availability is explicit; unsupported or absent samples are not zero. Event Timing has a reporting threshold. |
| Note/mode/panel observations | Separate feedback/shell, useful rendering and settled/error outcomes. A shell alone does not pass the panel content budget. |
| HTTP request / JSON / response | Browser request dispatch, encoding, fetch, decode and host handling are separate. Valid Content-Length is a declared response size, not measured decompressed bytes. |
| Durable draft / shared commit | Distinct acknowledgement events and distinct API spans. Queueing, debounce and a visible save label are not durable acknowledgements. |
| Browser worker | Main post, worker receive/parse/graph, main receive. Post-to-receive combines queueing, clone/transfer and dispatch; those components are not separately inferred. |
| Host logical lanes | Coordinator, DB, projection and filesystem still share the existing host topology. Lane names do not imply isolated threads. No dedicated DB queue exists in P0; its latency is N/A. |
| Host event-loop / CPU / memory | Node 24-compatible event-loop delay/ELU and process-wide user/system CPU deltas. CPU includes overlapping process work; it is not per-span CPU attribution. |
| Synchronous spans | Wall time for SQL, snapshot, semantic work, catalog, render, JSON and hashes. Nested durations are not additive. |
| Filesystem spans | Boundary wall time includes security checks, filesystem/thread-pool scheduling and awaited work. It is not pure disk service time. |
| Publication / dependency waits | Distinguish publication execution from waiting on another publication. HTTP 200 with an application error is a failed outcome. |

Host `http.receive` is handler entry, after any event-loop starvation. Calibrated client dispatch provides evidence of broader request waiting. Browser/host clock uncertainty, lost events, outstanding spans, timeout/cancel/error outcomes and automation overhead remain in the evidence. Instrumentation itself has overhead; measured results are instrumented baselines, not zero-overhead profiles.

## Reproduce on complete private copies

Run commands from the actual repository root with Node 24.18 or a separately recorded compatible runtime. Replace placeholders with absolute paths; never use the original Acceptance DB as a runnable trial.

```powershell
node --import tsx scripts/prepare-performance-fixture.ts --source <readonly-complete-workspace> --output-root <new-Scratch-root>
npm run build
node --import tsx scripts/performance-baseline.ts --workspace <Scratch-trial/.grasp/workspace.grasp.db> --output-root <Scratch-evidence-root> --trial trial-1 --counts full
node --import tsx scripts/verify-performance-recovery.ts --workspace <Scratch-trial/.grasp/workspace.grasp.db> --frozen-workspace <Scratch-frozen/.grasp/workspace.grasp.db> --baseline-report <run/report.json> --output-root <new-Scratch-correctness-root>
```

Preparation performs a readonly SQLite online backup, compares all SQL rows/blobs, inventories every ordinary file and directory, verifies source stability and creates three independently copied trial trees. Symlinks, nonregular files, escaping paths, SQLite sidecars and existing output roots are rejected. The frozen DB can have a different file hash from the original while preserving exact logical content; the three trial trees must have the same frozen file fingerprint. OS caches are not cleared. Existing publication/recovery trees are retained and recorded; fresh process or first deliberate publication does not mean disk-cold.

The production runner verifies the owned host's build/workspace identity, only edits notes it creates, retains failed/censored operations, records browser/driver timings separately and produces a unique run directory. Source/live extreme-note measurements are separate from ordinary MainVault work. Formal trials run serially without simultaneous copying, builds or test suites. Correctness verification starts only after the matching host exits; it explicitly checkpoints outside the baseline, validates retained recovery, copies a standalone fallback, rebuilds a fresh DB, compares source/EOL/identities/semantic/strategy/drafts/provenance/lineage and every attachment hash, then reopens it.

Existing benchmark and browser tests use `GRASP_EVIDENCE_ROOT` (absolute) plus a generated run directory, or default to a unique sibling `Scratch/Evidence` directory. This includes report writes inside test bodies, not only Playwright's reporter. Historical tracked reports remain unchanged. The legacy `benchmark-files.ts` is still a legacy-engine benchmark; the new baseline harness exercises the production publisher through the bundled host.

Only aggregate, privacy-reviewed reports belong in Git. All raw traces and logs stay in Scratch. P0 is complete only when the actual report proves corpus completeness, required sampling/overlap, observation integrity and correctness; exceeding a UX budget is a valid baseline finding, not grounds to omit a sample.
