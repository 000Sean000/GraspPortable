# Grouping links snapshot codec

`GroupingLinks.Plan(notes, files, knownFilePaths, languages)` performs no filesystem access. Supply all observed Markdown file snapshots, attachment paths, and known members. Unchanged members use equal before/after paths and anchors.

Each `GroupingLinkNote` contains canonical identity, old/new physical path, exact member body, its UTF-16 `SourceStart` in the original full physical file, and optional old/new presentation heading. Existing presentation headings must be plain H2 immediately before the matching `grasp:note` opening marker; planned headings need not exist yet. The service owns writing headings and storing their identity mapping in metadata.

The result contains `CanApply`, `Patches` and `Issues`. **Do not apply any patches when `CanApply` is false.** Each patch addresses an exact original substring of a physical source; verify `Before` and apply descending offsets. `OriginNoteId` identifies patches inside a member, so the service can update the future framed body without copying whole files into members. A link outside moving members requires an explicit preservation-note destination and blocks this plan.

Examples:

| Operation | Original | Result |
| --- | --- | --- |
| Merge A into All, presentation `Member A` | `[label](Notes/A.md "title")` | `[label](Groups/All.md#Member%20A "title")` |
| Merge with unique original H1/H2/Setext `Intro` | `[[A#Intro|alias]]` | `[[Groups/All#Intro|alias]]` |
| Split member A | `[[Groups/All#Member A|alias]]` | `[[Out/A|alias]]` |
| Split unique member heading | `[x](Groups/All.md#Intro)` | `[x](Out/A.md#Intro)` |
| Split group without member | `[[Groups/All]]` | Preview rejected; no implicit primary member |

Relative attachment URLs are rebased from the member's old physical origin to its new origin. Self `#heading` links participate in the same identity mapping. Alias, label, title, raw newline and non-destination content are left intact. Existing original heading fragments retain their spelling/encoding; no nested-heading syntax or heading-level change is introduced.

`FindHeadingAnchors(body, languages)` exposes plain ATX and single-line Setext headings that are unique within a member, using case-insensitive ambiguity checks. The resolver must also check across members. Formatted or multiline headings make rendered-name uniqueness uncertain, so the query returns no guaranteed anchors for that body and affected heading-based grouping is blocked with the offending heading in its issue.

The bounded scanner handles inline Markdown links/images, reference definitions and wiki links; excludes frontmatter, code/fences, Grasp regions/literals/reference caches and HTML comments. Missing/ambiguous paths, unsupported anchors, HTML local links and Markdown note embeds are explicit blockers when affected. Note embedding cannot safely be reduced to an H2 section while preserving arbitrary original heading levels. This does not block ordinary source saving.

The scanner currently mirrors the relevant bounded source-span rules from `FileLinks`; it does not modify that codec or add a general Markdown parser. A future shared helper can consolidate them under coordinated ownership.

```powershell
dotnet run --project tests/GraspPortable.GroupingLinks.Tests -c Release
```

Fixtures prove snapshot mapping and reversibility. They do not substitute for Obsidian GUI verification of heading navigation.
