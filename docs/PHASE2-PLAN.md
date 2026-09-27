# Phase 2 execution plan

Status: planning validated; proceed directly to implementation. No blocking Human decision. Core Requirements and Core Development Method remain authoritative. v0.1 is the tested baseline, not a permanent UX or syntax contract.

## Evidence and UX audit

Baseline production build and all 54 tests pass (2026-09-27). Personally exercised a separate production browser workspace with 1,201 synthetic notes and 240 records: search/select late notes, create a record and query note, export, review/apply plain Markdown import, navigate/edit a definition, inspect/restore recovery, create/switch workspace. Existing production E2E covers restart durability. No user workspace was changed.

| Finding | Classification | Product response |
| --- | --- | --- |
| Search remains after creating a query note or switching workspace, hiding the active note | Bug | Reset or reveal selection on explicit creation/workspace transition |
| Flat 1,201-item DOM; no folders, recents, paths or history | Scaling / missing capability | Stable logical folders, bounded child/results lists, search paths/snippets, recent and back/forward |
| Records stop at 150; no collection/search/all-results route | Scaling / missing capability | Paged collection browser, search/filter/edit and query-to-record navigation |
| Export succeeds but its destination is not visible in product | Workflow friction / discoverability | Persistent outbox with paths, download, open-folder and AI-folder export |
| No persistent readable fallback or attachment management | Missing capability | DB-owned assets and managed mirror/file layer |
| Identifier inspector limits results; cannot safely rename a namespace | Scaling / missing capability | Paged inspector, dependencies, semantic impact preview and atomic apply/recovery |
| Every navigation setting save re-parses all knowledge | Architecture limitation | Reuse calculated content for metadata-only changes with revision safety |
| Recovery preview only identifies a whole-workspace timestamp | Workflow friction | Counts/change summary and explicit recovery scope |
| Clicking a rendered value reveals its source correctly, but requires learning the convention | Discoverability / first-use familiarity | Keep behavior; contextual labels/help instead of another editor mode |

MainVault was fully inventoried read-only: 3,365 files, 254 directories, 2,820 Markdown files (6.21 MB), maximum Markdown depth 6, largest directory 2,275 notes; 3 duplicate-basename groups; 34 Windows paths over 260 characters. Static pattern scan found 11,381 wiki-link occurrences, 81 embeds, 127 frontmatter envelopes, 175 table notes, and 24 notes with repeated section outlines. These are heuristic syntax statistics, not an assertion of complete semantic reading or Obsidian conformance. There are 506 non-configuration assets (540.67 MB). All source content/size/mtime and directories remained unchanged after analysis. Private inventory, selection and hashes stay in ignored `.cache/phase2`; no private titles or paths enter Git.

## Product choices and boundaries

- **Notes:** stable note IDs plus logical folder IDs, independent of value namespaces. Root and duplicate titles are allowed; folder sibling collisions and cycles are rejected. New notes go into current folder. Moves retain identity. Bounded lists, global search with paths/snippets, recents and navigation history address the actual wide-folder distribution.
- **Links:** separate note/asset links from evaluated identifiers. Resolve explicit paths then unique basename; ambiguous targets remain visible, never guessed. Preserve raw frontmatter and unsupported Markdown. Do not convert prose/cards to records automatically.
- **References:** shared syntax spans/ownership support declaration and reference rename, including structured fields. Preview collisions, missing dependencies and impacted notes/records before a revision-bound atomic operation. Inspector shows all paginated results, source locations, direct dependencies/dependents and errors. A force-layout graph adds no necessary behavior.
- **Records:** searchable paged collection browser and editable detail; filters/query views link back to records and source references. Real repeated outlines inform optional explicit extraction, not an inferred schema/class hierarchy.
- **Persistence:** schema 2 folders, known-version upgrade only after a consistent validated backup; preserve old recovery/exchange compatibility. Unknown databases and versions remain untouched. SQLite remains sole authority.
- **Files:** `<workspace.db>.files/` contains visible inbox, outbox, mirror and assets. Relative-path APIs enforce containment, reject symlinks/reserved paths, and use bounded raw uploads. Attachment bytes live in SQLite; filesystem copies are recoverable projections. UI explains roles and exposes paths/download/open-folder without exposing implementation detail in ordinary writing.
- **Mirror:** generated Markdown plus versioned reconstruction metadata. Incremental immutable note revisions avoid overwriting external edits and full-vault rewrite per keystroke. Publish a manifest/index only after complete projection; background errors leave DB saves valid and visibly mark stale mirror. Explicit AI-folder export produces a conventional fresh hierarchy. External edits enter only through reviewed import. Rebuild into a new DB from validated manifest/hashes; never overwrite the original broken DB. Benchmark changed-note projection versus whole-tree output before finalizing grain. No unsafe automatic cleanup.
- **Migration:** read snapshot only; rehearse selected 160-note closure and 11 assets in a new ignored workspace. Preserve source relative paths/hashes and raw Markdown; map hierarchy, wiki/relative links, aliases, headings and managed assets. Report unresolved/ambiguous and unsupported Excalidraw, `.base`, Mermaid and math rendering. Exclude `.obsidian` scripts/settings from execution. Verify counts/hash fidelity, restart, editing, mirror/exchange and recovery rollback. Keep rehearsal workspace available privately for evaluation. Final snapshot manifest must match baseline.
- **Host:** retain browser-backed portable local host. Startup recovery must allow opening another DB/rebuilding a fresh DB when the selected DB cannot open. New filesystem and migration responsibilities have separate modules and tests.

## Bounded value-language decision

Keep the string-only implementation provisional (`grasp-string-v1`): declarations, JSON strings, interpolation and identifier dependencies meet the current requirements. Consolidate duplicated editor/parser source spans as needed for safe rename. Preserve separate language parser, graph evaluator, worker, persistence and editor boundaries. Never globally regex-rewrite Markdown.

[NCalc](https://github.com/ncalc/ncalc) supplies a .NET expression evaluator (and links a separate JS port); [CEL](https://cel.dev/overview/cel-overview?hl=en) supplies expression parsing/checking/evaluation. Neither removes cross-note identity, dependency scheduling, source editing or migration work. No snapshot notes use the current declaration grammar, and no concrete requirement needs arithmetic/conditionals now. Reassess when real typed expressions justify a compatible mature runtime; freeze syntax only after usage feedback, conformance fixtures and a reviewed versioned migration. Do not build a general-purpose language.

## Checkpoints and acceptance

1. **Planning:** current evidence, this execution plan, usage log; baseline build/tests. Commit/push before implementation.
2. **Workspace navigation foundation:** schema upgrade/backup, folders, move/rename/delete, bounded search and recents/history, metadata-only runtime reuse, note links. Tests cover migration, stale writes, folder cycles, identity and 3,000-note navigation. Personally use UI and restart.
3. **Knowledge management:** all-result identifiers/diagnostics/records, dependency inspection and safe semantic rename/namespace move with preview/recovery; query-to-record navigation. Regression fixtures cover escapes/code/dotted ownership/stale plans and records beyond old caps. Personally edit and follow references.
4. **Files and fallback:** inbox/outbox/assets, persistent incremental mirror, controlled edited-file import and new-DB rebuild/startup recovery. Test external edits, partial writes, traversal, bad hashes and DB authority; measure mirror cost; personally locate/use real files.
5. **Real migration rehearsal and delivery:** private representative copy/import with unsupported report; navigation/links/assets/mirror/exchange/restart/rollback; unchanged original manifest; synthetic 3,000-note performance; package and full regression/production UI acceptance. Keep private rehearsal accessible and document precise remaining limits.

Each major segment must build/test/UX-validate, append account quota evidence to `USAGE-LOG.md`, commit and push existing `master`, and verify remote before starting the next segment. Subtasks may run in parallel within a segment. No private corpus, credentials, caches or build products are staged. If high-capability quota is exhausted, stop substantive work, preserve a coherent checkpoint and exact next step, and label the goal unfinished. No automatic fallback model or quota-reset purchase.

Completion requires daily workspace UX and a real safe rehearsal, not merely tests or this plan. Existing Live Preview, worker graph, controlled exchange and recovery evidence must continue to pass. Main manual acceptance: find/move a deep note, inspect/rename dependent values, edit a late record, locate AI export and review its return, recover/reopen from DB and mirror.
