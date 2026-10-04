# Grouping metadata codec examples

`GroupingMetadataCodec` produces a complete frontmatter block with an **empty body**. The service appends the current `GroupedNoteCodec` body exactly once. File bytes, journals, source hashes, output paths and link rewrites remain the service's responsibility.

```csharp
var merge = GroupingMetadataCodec.GetMergeMetadata(
    [new(sourceA, "Notes/A.md", documentA, [noteA]),
     new(sourceB, "Notes/B.md", documentB, [noteB])], newGroupDocumentId);
// Check Success, then include every Preservation and Unassigned item in preview/output.
var mergedSource = merge.FrontMatter + framedCurrentMemberBodies;

var split = GroupingMetadataCodec.GetSplitMetadata(
    mergedSource, noteA, newSingleDocumentId, "Group.md");
var singleSource = split.FrontMatter + currentMemberA.Body;
```

Split returns one member's metadata. Splitting the whole group requires processing **all** members, preserving all extra material, and verifying every output before removing the original file. Repeated split calls report group-wide preservation items again; deduplicate by source path/scope/content in the operation. `Unassigned.Start`/`Length` are raw UTF-16 offsets into the full original source, including its frontmatter.

## Before / merge / split

The IDs below are explanatory placeholders; executable fixtures use valid UUIDs. Suppose A has:

```yaml
tags: [中文, alpha]
grasp:
  schema: 1
  documentId: <doc-A>
  layout: single
  extension: {schema: 9}
  notes:
    - id: <note-A>
      title: 中文
      bindings: {}
      records: {future: {type: rich}}
```

Merge places the unknown note subtree under its same member and moves the original document-level metadata into its unique original owner:

```yaml
grasp:
  schema: 1
  documentId: <new-group-doc>
  layout: grouped
  notes:
    - id: <note-A>
      title: 中文
      bindings: {}
      records: {future: {type: rich}}
    # B's entire member subtree follows.
  grouping:
    schema: 1
    sources:
      <doc-A>:
        originalPath: Notes/A.md
        memberIds: [<note-A>]
        frontmatter:
          tags: [中文, alpha]
        graspExtras:
          extension: {schema: 9}
      # B's original owner follows.
```

Split A restores `tags`, `grasp.extension` and the unknown `records` subtree by YAML value, gives the output a new document ID and `layout: single`, and retains `<note-A>`. It uses the member's **current** body; this metadata codec never stores a backup body in YAML.

If an external editor adds `groupLabel: Work` to the group root, it is returned as a `GroupingMetadataPreservation` item with scope `group-frontmatter`. Extra group-level `grasp` and `grouping` fields are separate mapping fragments. They must become visible preservation output; they are not guessed onto every member. Prefix, generated H2 headings, separators and suffix are separately returned as `Unassigned`, including whitespace. Unknown original-owner extension fields stay in flattened provenance on merge and are explicitly surfaced when splitting that owner.

## Validation boundary

The runner checks merge/split YAML value equivalence, future note fields, flattening, empty output bodies, exact unassigned ranges, explicit preservation output, malformed ownership, identity mismatches, aliases/duplicate keys/unknown schema, reserved-key conflicts and invalid member framing.

YAML formatting/comments are not byte-preserved by canonical conversion; original before bytes belong to the operation journal. Duplicate original owners are rejected rather than automatically reconciled. Invalid framing and ownership block transformation, while ordinary source/draft saving remains independent.

```powershell
dotnet run --project tests/GraspPortable.GroupingMetadata.Tests -c Release
```
