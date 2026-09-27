# File projection evidence

Run: 2026-09-27T01:18:02.984Z; v24.19.0, win32. Synthetic corpus only: 2820 notes, 6,318,510 Markdown bytes, 100 records and one 4 KiB attachment.

| Operation | Time | Payload files written / reused |
| --- | ---: | ---: |
| Cold immutable mirror | 2540.99 ms | 2821 / 0 |
| Fresh conventional AI folder | 2239.08 ms | 2823 files including metadata/index |
| Warm one-note edit | 674.37 ms | 1 / 2820 |
| Full verified rebuild read | 4427.8 ms | no writes |

Warm updates avoid rewriting the other 2,819 notes and attachment, but still scan file metadata and publish a full manifest (1,254,355 bytes) plus human-readable index. This is an asynchronous projection cost, not typing latency. The stat signature cache avoids repeated content hashing; rebuild always verifies every byte. Old revisions and externally edited files are retained; there is no automatic pruning.

Reproduce: `node --import tsx scripts/benchmark-files.ts`. JSON: [files-latest.json](benchmarks/files-latest.json).
