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
