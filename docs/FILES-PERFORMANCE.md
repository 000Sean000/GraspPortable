# File projection evidence

Run: 2026-09-27T05:43:31.647Z; v24.18.0, win32. Synthetic corpus only: 2820 notes, 6,318,510 Markdown bytes, 100 records and one 4 KiB attachment. Layout: Workspace/.grasp/workspace.grasp.db plus one live Workspace/Markdown tree.

| Operation | Time | Verified result |
| --- | ---: | --- |
| Cold single Markdown projection | 15152.69 ms | 2821 public payloads written / 0 reused |
| Reuse existing projection through compatibility alias | 2718.66 ms | Same Markdown path; 2821 existing payloads; no filesystem mutations or second tree |
| Warm one-note edit | 9251.46 ms | 1 public payload written / 2820 reused; paths unchanged |
| Full verified rebuild read | 2756.1 ms | Exact snapshot and attachment bytes; no writes |

The compatibility buildAiFolder call returns the same projection. Before/after inventories check paths, file identities, sizes and modification timestamps across both Markdown and .grasp; they are excluded from the timing. No second persistent AI directory is created.

Warm updates avoid rewriting the other 2,819 notes and attachment, but still scan file metadata and publish a full manifest (1,009,520 bytes), index and internal recovery metadata. This is asynchronous filesystem cost, not typing latency. Stat-signature caching avoids repeated hashing; rebuild verifies every byte. Internal recovery objects, prior manifests and external edits are retained without automatic pruning.

Reproduce: `node --import tsx scripts/benchmark-files.ts`. Synthetic workspaces are retained outside the repository under `../Scratch/file-benchmark`; set `GRASP_SCRATCH_ROOT` to choose another Scratch root. JSON: [files-latest.json](benchmarks/files-latest.json).
