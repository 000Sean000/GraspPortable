# Implementation contract

This is a source map for implemented M1–M3 behavior and the current streaming migration interface. Authority is identified by `Project_Seed/README.md`, with accepted shared-value/projection behavior in `SHARED-VALUE-CONTRACT.md` and `PROJECTION-CONTRACT.md`. Exported TypeScript types are the exact reference; execution evidence belongs in `VERIFICATION.md` and `MIGRATION.md`. This map does not freeze implementation choices.

## Domain and versioned source

- `src/domain/model.ts`: `WorkspaceSnapshot {id,name,revision,notes,folders,records,attachments,settings}`. Entities retain stable IDs. Attachment snapshots contain metadata, never bytes. `Note.syntaxVersion` is `legacy-v0.2 | grasp-v1`; absence means legacy, not permission to reinterpret old raw source.
- `binding-language.ts`: `parseBindingAt` / `serializeBinding`, raw literals and ordered parts. Example: `@Greeting = <|Hello |> + Person.Name`. Literals have compact/block forms and variable pipe delimiters selected by `serializeRawLiteral`. Multiline values contain actual line separators. Qualified names use dotted ASCII identifier segments, without the legacy hyphen extension.
- `reference-language.ts`: `parseReferenceAt`, `scanReferences`, `serializeReference`. Body forms are `[value](:ref:Identifier)` and `[[@Identifier|value]]`; values can contain actual newlines. The reversible local escapes are backslash, brackets and pipe. Locations address original UTF-16 source.
- `note-language.ts`: `parseNoteLanguage` combines codecs with a replaceable Markdown context adapter. Managed occurrences are complete semantic units; code, HTML, frontmatter and destinations have explicit exclusion/ownership rules. Multiline values are not flattened into single-line labels.
- `knowledge.ts` / `template.ts`: `parseNote` / `buildKnowledge` dispatch by syntax version. Legacy `@name = "JSON template"`, `{dependency}` interpolation and `{{name}}` remain supported without rewriting existing notes. Structured record fields retain their current template representation and `collection.name.field` names.
- `graph.ts`: `ValueGraph.update`, `fork`, `getDefinition`, `findReferences`, `getValue`; no DOM, Node or SQLite dependency. `links.ts` resolves ordinary note/asset links separately from value identifiers. `rename.ts` exposes pure `planRename(snapshot,request,semantic?)` proposals.

`source-bundle.ts` (`createSourceBundle`, `restoreSourceBundle`, `serializeSourceBundle`) and `markdown-value-export.ts` (`exportSourceBundleMarkdown`) implement M1 **single-note** exact-source/reading representations. They are not the M3 complete workspace fallback or another publication engine.

## Shared semantics, editor and runtime

`src/domain/shared.ts` owns JSON state containing identifiers, bindings, occurrences, results and note sources. Bindings retain owner/source revision/hash, ordered parts and dependency IDs; results distinguish current status from last-good observations. Equal text is not authority to merge identities.

`prepareSharedWorkspace(snapshot,{previous?,previousSnapshot?,graph?,hash,newId,identityHints?})` returns `{state,notes,runtime,graph,patches,canCommit,diagnostics}`. It forks the candidate graph; the store adopts it only after commit. `applySharedIntent` materializes explicit commands without storage. `SourceEditProof {noteId,baseRevision,baseHash,steps:RawSourceChange[][]}` contains ordered nonoverlapping `{from,to,insert,expected?}` edits against each step's input. Exact replay is mandatory; ambiguous external identity mapping fails closed.

`server/semantic.ts` owns the HTTP/store DTOs:

~~~ts
interface SharedCommand {
  operationId: string;
  workspaceId: string;
  baseSemanticRevision: number;
  intent: SharedIntent;
}
// Intent kinds: commit-draft, set-literal, set-dependency,
// rename, rename-namespace, undo.
~~~

`SharedStateResponse` is `{snapshot,semantic,noteSources}`. `SharedCommitResponse` adds `{receipt,sourcePatches,draftAcknowledgement?}`. Source patches address the previous **committed** raw source and carry revision/hash guards. Commit-draft acknowledgement is `{draftId,draftRevision,noteId,submittedSourceHash,edits}`; its edits are **cache-only changes against the submitted draft**, for rebasing typing that continued during commit. Durable receipt query/replay preserves this distinction.

`src/editor/editor.ts` exports `createEditor(parent,options): EditorAdapter`. `onChange(markdown,rawChanges?)` reports raw UTF-16 edits. Navigation, references and explicit shared editing are callbacks. The adapter exposes:

- `setDocument(markdown,documentKey?,revision?,syntaxVersion?)`, `getDocument`, `getDocumentVersion`;
- `applySemanticPatch({expectedKey,expectedRevision,nextRevision,expectedSource,changes})` → `applied | stale | composing`;
- `insertText`, `focusRange`, `setMode('live'|'source'|'reading')`, `setRuntime`, `setAssets`, `setPendingValues`, `destroy`.

`raw-source.ts` preserves LF/CRLF/CR while mapping CodeMirror positions. Semantic patches validate exact text and remain separate from local Ctrl+Z history. CodeMirror objects stay inside the adapter. `src/runtime/client.ts` sends only committed snapshots to its worker and reuses knowledge for metadata-only updates. `src/app/main.ts` owns serialization, durable-draft hydration, in-flight rebase and independent shared undo. Navigator, KnowledgePanel, RecordsPanel, FilesPanel and ProjectionPanel own UI/callbacks, not database/filesystem handles.

## SQLite authority and HTTP

P0 observations are described in [PERFORMANCE-INSTRUMENTATION.md](PERFORMANCE-INSTRUMENTATION.md): `server/performance.ts` owns opt-in bounded host traces and `src/diagnostics/performance.ts` owns browser/worker observations. `GET /api/diagnostics/performance/clock` is available only with host instrumentation enabled and uses the existing host/origin guards. Logical trace lanes do not establish worker ownership; current persistence and publication remain in-process. Baseline/recovery harnesses are `scripts/performance-baseline.ts`, `prepare-performance-fixture.ts` and `verify-performance-recovery.ts`; evidence readiness is recorded in the working state, not asserted by this source map.

`server/store.ts` exports `WorkspaceStore` and strict validators. **Schema 5** stores notes/folders/records/settings/history, immutable attachment blobs, semantic state, durable drafts/operations, projection strategies/packages and recovery/publication metadata. v1–v4 upgrades require an independently verified backup. Invalid Unicode surrogates are rejected instead of silently changed by SQLite encoding.

All content mutations—including compatibility CRUD/import/rename/restore—reconcile semantic state and persisted source caches in the same transaction. Settings-only changes do not create semantic receipts. Incomplete source remains a durable draft; complete missing/cyclic graphs may commit with explicit status. Draft revisions are independent; stale drafts can be saved but cannot silently commit. Draft edit journals survive restart.

Explicit shared commands use durable operation IDs and payload hashes. Unknown results can be queried; an ID cannot be reused for another payload. Shared undo has a semantic-version guard and an inverse for affected owners, not a whole-workspace history restore. `sourceHash` hashes exact UTF-16LE; portable file hashes cover bytes.

`server/api.ts`: `createApi({defaultPath?,openDirectory?,revealFile?})` returns `handle(req,res):Promise<boolean>` and `close():Promise<void>`. Await close so file operations drain before DB close. `server/main.ts` owns loopback hosting/Host/Origin validation; the API also rejects cross-origin writes. Requests carry `X-Grasp-Workspace`; asset/download links can use `?workspace=id` to reject stale tabs.

| Routes | Contract |
| --- | --- |
| `GET /api/host`, `/api/workspace` | Host path/warnings/backup/unavailable error and `recoveredDraftIds`; or committed snapshot. Failed DB keeps open/rebuild available and other workspace operations fail closed. |
| `POST /api/workspace/open`, `/workspace/rebuild` | `{path,create?,name?}`; or `{manifestPath,newPath,name?}`. Rebuild requires a new destination and creates a fresh workspace instance. |
| `GET /api/shared/state` | Authoritative `SharedStateResponse`. |
| `GET /api/drafts?clientId=`, `PUT/DELETE /api/drafts/:id` | Read drafts; save title/raw/syntax/base-note revision/hash/draft revision/optional sourceEdits; delete with revision. Save returns `{draft,diagnostics,canCommit}`. |
| `POST /api/shared/commands`, `GET /api/shared/operations/:id` | `SharedCommand` → atomic response; or durable receipt lookup. |
| Notes/folders/records/settings CRUD | Existing optimistic APIs. Note create/update accepts `syntaxVersion`; omitted update folder preserves location. Recursive folder deletion is explicit; settings replace the string map. |
| `POST /api/assets?name=&path=`, `GET/DELETE /api/assets/:id` | Raw upload up to 64 MiB; verified bytes; or revision-guarded deletion. |
| `GET /api/export`, `POST /api/import/plan`, `/import/apply` | **Legacy exchange compatibility**: emits grasp-markdown v3; accepts v1–v3/plain Markdown. Apply takes `{token,workspaceRevision}`, never a replacement payload. |
| `/api/rename/plan`, `/rename/apply`; `/history`, `/history/:id/preview`, `/history/:id/restore` | Compatibility rename/import and whole-workspace recovery. Explicit shared rename/undo uses shared commands. |

Exchange and rename services hold reviewed payloads under 30-minute single-use tokens bound to workspace/revision. Full fallback restores current state and recoverable drafts, **not operation receipts or all DB history**. Recovered draft IDs require manual recovery; unrelated new drafts resume normally.

## Semantic projection and publication

`src/domain/projection.ts` owns the catalog, selectors, proposals, strategies and scope-filtered plans. Canonical units are `noteProse:NoteID`, `binding:BindingID`, `recordInfo:RecordID`. Note/record/identifier/field selectors normalize to these units; duplicate aliases are rejected. The private catalog contains full owner layout; partial plans disclose only included units and declared dependency closure. Same-note bindings can occupy different groups without relocating ownership or duplicating canonical declarations.

Entry points: `createProjectionCatalog`, `createDefaultProjectionStrategy`, `createProjectionPlanningPackage`, `reviewProjectionProposal`, `compileProjectionPlan`, `createFullProjectionBundle`, `validateFullProjectionBundle`. Groups contain `{id,path,render:'sections-v1',members}`. Proposal bases include workspace/strategy revisions and a saved planning-package ID. `unassign` is explicit; omission alone does not remove an assignment. Unassigned units use the deterministic fallback policy.

`projection-renderer.ts` exposes `renderProjection(plan)` and `reviewProjectionFile(baseline,changedText)`. The latter protects generated boundaries/tokens, classifies prose/binding edits versus cache observations, and supplies segmented `rawEdits` around unchanged references. Cache observations cannot authorize shared writes. Reading links/anchors/assets are representations; reconstruction metadata preserves canonical raw source.

| Routes | Contract |
| --- | --- |
| `GET /api/projection/state` | `{strategy,status,catalog}`; catalog exposes identity/label/owner/revision/hash summaries, not all raw source. |
| `POST /api/projection/package` | `{selectors?,provided?:'full'|'metadata',dependencyClosure?}` → persisted scope-declared package. |
| `POST /api/projection/strategy/plan`, `/strategy/apply` | `{proposal}` → review/frozen token; `{token}` → `{snapshot,strategy,status}`. Unknown packages and stale bases are rejected. |
| `POST /api/projection/checkpoint` | `{}` → `ProjectionStatus`. |
| `POST /api/projection/export` | `{scope:{mode:'full'|'partial',units?,includeDependencies?,attachmentIds?}}` → `FileExportResult`. Full uses the main tree; partial is a one-off outbox artifact. |
| `POST /api/projection/locate` | `{unitId}` → `{entry,anchor}` for the published file. |
| `POST /api/files/external/plan` | `{path}` → ImportPlan plus `projectionFiles`; changed controlled reading files in the generation are reviewed together. Normal import/apply applies the frozen proposal atomically. |
| File status/list/download/locate/reveal/open-folder | Root-confined browsing and actual Explorer paths. `FilesStatus.projection.units` includes binding-only group files. |
| File inbox/import-plan/exchange/export/mirror-refresh | Inbox staging/controlled import, legacy exchange compatibility, full-tree export, or manual checkpoint through the same publisher. |

`server/projection.ts` exports `ProjectionWorkspaceFiles(store)`, the **only active publisher** in the API. `server/files.ts` supplies confined file operations in passive mode plus legacy manifest reading; its old publisher is not scheduled by production.

The main tree is `Workspace/Markdown/`, with `.grasp-export/` metadata **inside it**. Copy that hidden directory with Markdown/assets for a complete fallback. DB, exchange and internal recovery remain under `.grasp/`; legacy standalone DB paths use `<db>.files` as their managed root. There is no second persistent AI tree.

Scheduling uses cheap revision/draft stamps, not whole-catalog hashing per keystroke. First publication/manual checkpoint are immediate; later dirty changes coalesce at about ten minutes. Draft-only changes also mark checkpoints pending. Close drains active work without forcing a new expensive checkpoint.

`server/projection-generation.ts` stages independent ordinary-file generations, verifies hashes/coverage and writes the completion marker last. Publication uses a durable journal and two directory renames: **no cross-file atomicity guarantee and no hard-link dependency**. Restart validates interrupted state. External edits/deletions/unknown files are preserved; cutover rechecks concurrent changes. `.obsidian` configuration is preserved without becoming note authority. Two verified independent recovery generations are retained; changed/incomplete generations are not silently deleted. A dirty public tree can coexist with a newer internal checkpoint.

Current-DB write authority comes from a **DB-held publication baseline**, not externally re-signable public metadata. Review uses protected owner/source mappings. Apply rechecks every reviewed hash and saves accepted hashes in the same DB transaction as the import; restart before publication does not lose approval. Exact edit proofs preserve untouched duplicate occurrence IDs.

`readFullGenerationStreaming(manifestPath)` validates completion, file hashes, full expected plan/rendering, owner reconstruction, semantic state and drafts, then returns `{snapshot,readBlob,recovery}`. `WorkspaceStore.rebuildStreaming(path,input,readBlob,name?,recovery?,provenance?)` ingests one verified unique blob at a time into an exclusive new DB. Synchronous small-input rebuild and `readMirrorManifest` remain compatibility interfaces. Full rebuild retains lineage/strategy/entity/semantic IDs; partial export cannot rebuild a complete workspace.

## Streaming vault migration boundary

`server/migration.ts` currently exports:

- `planVault(sourceRoot,{maxMarkdownBytes?}):Promise<VaultPlan>`: snapshot/report/source root, **no retained attachment bodies**.
- `applyVault(plan,newDbPath,{onProgress?,availableBytes?}):Promise<VaultApplyResult>`: DB/checkpoint paths, source fingerprint and copied/resumed asset counts.
- `writeVaultReport(plan,outputDirectory):Promise<string>`.

Inventory hashes with 1 MiB chunks. Bounds are 20,000 entries, 10 MiB UTF-8 per note, 128 MiB aggregate Markdown and 64 MiB per attachment; there is no 512 MiB combined-vault cap. Apply checks capacity, uses a target-bound resumable checkpoint, revalidates source/staged payloads, invokes the streaming store adapter and exclusively publishes the new DB. Source provenance persists for full fallback. Source files are never written; plugin/configuration code is never executed. The CLI `scripts/migrate-vault.ts` defaults to preview and needs `--apply` for DB creation. Interface availability is separate from the actual corpus/restart evidence in `MIGRATION.md`.
