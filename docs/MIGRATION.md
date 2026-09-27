# MainVault migration rehearsal

This is a bounded rehearsal, not a complete Obsidian replacement or a migration of the original vault. Original `gitignored/main-vault-snapshot/` remains read-only. Private copies, paths, source text, reports and databases remain in ignored `.cache/phase2/rehearsal/`; the public evidence contains aggregate counts only.

## Actual data and verified behavior

Forty feature-coverage seeds plus a bounded link closure selected **160 Markdown notes and 11 images**, totaling **6,784,617 bytes** in **44 folders**. They were copied before any migration experiment. Every copied file hash matches its original. The import retains note/folder identity, logical paths, raw frontmatter, Markdown, CRLF and attachments. No prose is automatically converted to records.

The private database is `.cache/phase2/rehearsal/MainVault-Verified.grasp.db`. It can be opened from the app's workspace dialog. Its sibling `.grasp.db.files` directory contains the persistent mirror and actual inbox/outbox. A separate `MainVault-Verified-Rebuilt.grasp.db` was created from the validated mirror with a new workspace UUID and the same note metadata and attachment hashes.

Programmatic rehearsal verified all 160 Markdown hashes and all 11 attachment hashes after import and reopen. Export/reparse yielded zero content changes. A controlled AI exchange changed one note, demonstrated nested reactive values (`Before` → `After`), then recovery restored **all original note hashes**. The final database reopened with the exact committed snapshot. Mirror verification and fresh-DB rebuild retained all note metadata and attachment bytes. Private detailed evidence: `verification-private.json`; public results: [migration-rehearsal.json](benchmarks/migration-rehearsal.json).

The subset has 730 link occurrences: 302 resolved, 9 external and 419 unresolved. Read-only resolution against the full 2,820-note / 506-asset source catalog explains **404 of those unresolved links as targets outside the selected subset**; 15 remain unresolved under the current Grasp resolver. Full-catalog parsing found 11,710 links: 11,399 resolved, 219 missing, 1 unsupported and 91 external, in 412 ms. These are current-parser results, not a claim of exact Obsidian compatibility; they differ from the earlier heuristic inventory. See [migration-links.json](benchmarks/migration-links.json).

The final manual browser pass used this real private database on port 43822: searched a deep note, located its folder breadcrumb, changed and restored its title, inspected resolved and missing links, selected the exact image source through the Links panel, verified the DB-backed image loaded, and viewed the real inbox/mirror paths and revision status. All 160 Markdown and 11 attachment hashes still matched the copied source afterward. A real host stop/start returned the exact post-UI snapshot; the browser reopened on the same note and folder. This is separate from the synthetic CRLF production E2E.

The final original-vault inventory still matched the baseline: **3,365 files, 254 directories, 557,533,195 bytes**, all content hashes and modification times unchanged, no symlinks followed. Manifest SHA-256: `816fffced7d391094e3101a745c404162e0bda14197c19cbc89c23cde749fe37`. The machine-readable manifest remains private.

## Preserved but not fully interpreted

- The subset contains two Excalidraw notes, two Mermaid notes and six math-pattern notes. Source is retained; those specialized renderers are not implemented. Pattern counts are a static inventory.
- Frontmatter remains Markdown source, not a typed metadata or record schema. Tags and repeated outlines remain readable/searchable text.
- `.obsidian` and tool/plugin directories are excluded. Plugin code and configurations are not executed or migrated.
- Missing/ambiguous links remain explicit; no target is guessed and no link text is silently rewritten after note moves/renames.
- Record candidates are repeated fields/section outlines, such as a named item's properties. Convert deliberately through the Records UI after deciding the desired fields; narrative, journal and long-form research stay notes. There is no automatic semantic extraction or class system.

## Repeat safely from another copy

Use a copied subset, never the original snapshot as a working directory. From a source checkout:

```sh
node --import tsx scripts/migrate-vault.ts --source=".cache/my-copy" --output=".cache/my-migration-report"
node --import tsx scripts/migrate-vault.ts --source=".cache/my-copy" --output=".cache/my-migration-report" --apply=".cache/MyImported.grasp.db"
```

The default is preview. Explicit apply creates a previously nonexistent DB, rechecks the included path/hash/size/mtime manifest, and refuses output inside the source tree. Unsupported names, symlinks, malformed UTF-8 and executable input outside excluded directories fail before import. Limits are 20,000 entries, 512 MiB aggregate, 10 MiB per Markdown input and 64 MiB per attachment; split a larger corpus into reviewed subsets. Reports include private paths and must remain private.

Before extending a migration, review unresolved links and unsupported syntax; include their target notes/assets in the next copy. Check the new workspace, export for AI, review returns explicitly, then close/reopen. Rollback is opening the previous untouched DB (or recovery for reviewed imports); a mirror rebuild always creates another DB. A migration does not replace the source vault.
