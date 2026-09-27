# Implementation contract

The two Project_Seed core documents are authoritative. This is a short map of the v0.2 source contracts, covered by the current 179-test and 20-production-E2E runs; exported source types and tests remain the exact implementation reference. It does not freeze technology choices. Packaged smoke and private manual-workspace verification are tracked separately in VERIFICATION.md.

## Plain domain data and language

- src/domain/model.ts owns WorkspaceSnapshot {id,name,revision,notes,folders,records,attachments,settings}. Note has a stable id, title, Markdown, revision, updatedAt and nullable folderId. Folder has id, nullable parentId, name and revision. Attachment metadata has id,name,path,mimeType,sha256,size,revision,createdAt; bytes never travel in snapshots.
- src/domain/knowledge.ts exports parseNote(note): ParseResult and buildKnowledge(notes,records?): ParseResult. Definitions/references include exact UTF-16 source locations, optional nameLocation and explicit note/record owner metadata for safe editing.
- Current provisional grammar: standalone @name = "JSON string with {other.name} interpolation"; body {{name}} renders a value. Templates escape literal braces with {{ and }}. Fenced/inline code does not participate. Identifiers match [A-Za-z_][A-Za-z0-9_.-]*.
- Structured field identity is collection.name.field. src/editor/query.ts exports parseQuery and executeQuery for a grasp-query JSON fence with collection and optional where:{field,equals}; no SQL/JavaScript execution.
- src/domain/graph.ts exports ValueGraph.update(parsed,revision,options?): RuntimeResult, getDefinition, findReferences and getValue. It has no DOM, Node, editor or SQLite dependency.
- src/domain/links.ts exports parseNoteLinks, buildNoteCatalog and buildLinkIndex(notes,folders?,assets?,previous?). Wiki/Markdown links and grasp-asset:ID are independent from value identifiers.
- src/domain/rename.ts exports planRename(snapshot,{from,to,mode:'identifier'|'namespace'}): RenamePlan. It returns proposed notes/records, precise edits, ownership, diagnostics and direct/transitive impact; it never writes storage.

## Editor and runtime

src/editor/editor.ts exports createEditor(parent,options): EditorAdapter. Options require onChange(markdown), onNavigate(name), onFindReferences(name); onOpenRecord(id) and onOpenQuery(query) are optional.

~~~ts
interface EditorAdapter {
  setDocument(markdown: string, documentKey?: string): void;
  getDocument(): string;
  insertText(text: string): void;
  setRuntime(result: RuntimeResult, records?: StructuredRecord[]): void;
  setAssets(workspaceId: string, attachments: readonly EditorAsset[],
            links?: readonly EditorAssetLink[]): void;
  focusRange(from: number, to: number): void;
  setMode(mode: 'live' | 'source'): void;
  destroy(): void;
}
~~~

setDocument does not emit onChange. Document keys separate per-note history; runtime/assets are effects, not source edits. Public ranges are UTF-16 offsets in raw Markdown. src/editor/raw-source.ts preserves existing LF/CRLF/CR separators, maps normalized editor positions, and records separator changes in undo history. CodeMirror objects stay inside the adapter. src/runtime/client.ts provides RuntimeClient.update(snapshot), retry(), destroy(); only committed snapshots enter the worker, and metadata-only updates reuse matching knowledge.

The Navigator, KnowledgePanel, RecordsPanel and FilesPanel modules under src/app own bounded/paged UI and command callbacks. src/app/main.ts serializes commands and owns drafts, focus and snapshot acceptance; it does not access SQLite or filesystem handles.

## Persistence, file lifecycle and HTTP

server/store.ts exports WorkspaceStore, strict validators, MAX_MARKDOWN_CHARACTERS and MAX_ATTACHMENT_BYTES. Schema 3 keeps notes/folders/records/settings/history plus attachment metadata and immutable blobs. Known v1/v2 upgrades require validated independent backups. Mutations return complete committed snapshots; per-entity/workspace conflicts return HTTP 409.

server/api.ts exports createApi({defaultPath?,openDirectory?}) with handle(req,res):Promise<boolean> and close():Promise<void>. Always await close: active exports and mirror jobs must drain before DB close. server/main.ts owns loopback Host/Origin validation and static hosting; the API also rejects cross-origin writes. Browser requests send X-Grasp-Workspace; image/download URLs can carry ?workspace=id.

| Routes | Request / result |
| --- | --- |
| GET /api/host; GET /api/workspace | Host path/warning/backup/unavailable error; or committed snapshot. Unavailable DB returns 503 while /host and recovery routes stay alive |
| POST /api/workspace/open | {path,create?,name?} → snapshot |
| POST /api/workspace/rebuild | {manifestPath,newPath,name?} → fresh-ID workspace from validated manifest/bytes; newPath must not exist |
| POST /api/notes; PUT/DELETE /api/notes/:id | Create {title,markdown,folderId?}; update {title,markdown,revision,folderId?}; delete {revision}. Omitted folderId on update preserves location |
| PUT /api/notes/:id/move | {folderId:null|string,revision} |
| POST /api/folders; PUT/DELETE /api/folders/:id | Create {name,parentId}; update {name,parentId,revision}; delete {revision,workspaceRevision,recursive?}, nonempty requires explicit recursive |
| PUT/DELETE /api/records/:id; PUT /api/settings | {record,revision}; {revision}; or {settings} replacing the string map |
| POST /api/assets?name=&path=optional | Raw bytes, Content-Type MIME, at most 64 MiB → snapshot |
| GET/DELETE /api/assets/:id | Verified bytes; or JSON {revision} → recoverable deletion |
| GET /api/export; POST /api/import/plan; POST /api/import/apply | Download grasp-markdown v2; {markdown} → ImportPlan; {token,workspaceRevision} → snapshot. Import accepts v1 and plain Markdown |
| POST /api/rename/plan; POST /api/rename/apply | {from,to,mode} → reviewed RenamePreview; {token,workspaceRevision} → atomic snapshot |
| GET /api/history; GET /api/history/:id/preview | Recent recovery entries; or whole-workspace change scope/counts and current revision |
| POST /api/history/:id/restore | {workspaceRevision} → snapshot, with recovery of the pre-restore state |
| GET /api/files/status; GET /api/files?path= | FilesStatus; bounded directory entries |
| GET /api/files/download?path= | Managed file download; path is relative to the active .db.files root |
| POST /api/files/inbox?name= | Raw Markdown/text bytes → saved inbox FileEntry; does not import |
| POST /api/files/exchange; POST /api/files/export | {} → real outbox exchange FileEntry; or complete AI-folder FileExportResult |
| POST /api/files/import/plan | {path} → ImportPlan; use the normal import/apply route after review |
| POST /api/files/mirror/refresh; POST /api/files/open-folder | {} → FilesStatus after flush; or {path} → validated directory opened by the host |

ExchangeService and RenameService keep proposed payloads on the host, with 30-minute single-use tokens bound to workspace/revision. Clients cannot replace the reviewed payload in apply requests. Restore/import/rename remain atomic and recoverable.

server/files.ts exports WorkspaceFiles(dbPath): schedule(snapshot,readBlob), status(), flush(), close(), list(), read(), directoryPath(), saveInbox(), saveExchange(), buildAiFolder(). schedule coalesces asynchronously and reports errors without failing a committed DB save. readMirrorManifest(absolutePath) validates reconstruction data read-only; WorkspaceStore.rebuild creates a distinct new DB. FilesStatus/FileEntry/FileExportResult live in src/domain/files.ts. Files are projections, never a second live authority.

## Read-only vault migration

server/migration.ts exports planVault(sourceRoot):Promise<VaultPlan>, applyVault(plan,newDbPath):Promise<{snapshot,databasePath}>, and writeVaultReport(plan,outputDirectory):Promise<string>. VaultPlan contains the proposed snapshot, immutable blob bytes, source root and a private path/hash/size/mtime report. It preserves raw UTF-8 Markdown and hierarchy, resolves links without rewriting source, excludes plugin/tool directories and reports unsupported patterns. Apply rechecks the included source manifest, validates payloads and exclusively creates a new DB; output inside the source tree is refused. The CLI scripts/migrate-vault.ts defaults to preview and requires explicit --apply for DB creation. Its input bounds are intentionally separate from general DB storage limits; see MIGRATION.md.

Default host: workspaces/Welcome.grasp.db, 127.0.0.1:43821. The path pointer only remembers selection. No package/user-content coupling is assumed; copied artifacts and private migration workspaces stay outside source control.
