# P0：完整 MainVault 性能基線

**狀態：進行中，尚未完成正式三輪基線。** 本文件只記錄已取得證據；性能預算是否通過與量測是否完整分開判定。接受的 scope、後續階段與停止條件見 [計畫](PERFORMANCE-ISOLATION-PLAN.md)，操作與計時定義見 [instrumentation](PERFORMANCE-INSTRUMENTATION.md)，接續入口見 [工作狀態](EXECUTION-STATE.md)。

## 實作與驗證

已加入預設停用的 bounded host/browser/worker 觀測、HTTP/request/job 關聯、同步工作與 awaited filesystem 階段、event-loop/CPU/memory 樣本，以及 run-specific evidence roots。既有 benchmark/E2E/package smoke 的報告輸出不再覆寫 tracked 歷史證據。產品排程、timeout、快取、Worker topology、資料 schema 與保存語義保持本次觀測範圍。

- 單元整合：47 files／589 tests PASS；最新 fixture／輸入／ACK 修正後 runner19及aggregator8項 focused tests、TypeScript／production build PASS。
- Production build PASS，整合 build ID `77c39e00-579e-40ad-aa13-f720f69e8c59`。既有 Vite 大 chunk 提示仍存在，不構成性能歸因。
- Production browser regressions：45 tests PASS，Edge headless，約1.7分鐘；包含 draft recovery、shared atomicity/undo、late reply、workspace guards、projection/import/rebuild 與既有 editor 工作流。
- 小型 harness smoke：28,734 host events，無事件遺失、sink error 或未結束 host spans，IPC graceful exit。這是量測流程驗證，不是 MainVault 性能結果。
- 第一個完整 corpus smoke：首次 hydrate 與搜尋輸入的啟動競態導致 locator timeout；在正式 workload 前停止。證據保留，正式副本未使用。修正目標是 harness 啟動順序，未提高產品 timeout。
- 第二個完整 corpus smoke：七情境完成，3,866,695 host events；無事件遺失、sink error 或未結束 span，184 個 actual publication overlap，原資料相同且正常關閉。保留小 API timeout 與 checkpoint pending；此輪使用較早載入的 harness 及 smoke 樣本數，不是正式基線。
- 此 smoke 的 post-measurement correctness PASS：兩個同 workspace 的有效 recovery generations、standalone fallback、新 DB rebuild、重新開啟、完整 semantic/strategy/draft/lineage/provenance 比對、506 attachments 的 hash，原有2,821notes及folders/records/attachments均未變更。
- 舊小型 full-count run 曾回報完整 coverage：471typing、45search/navigation/selection、53mode、15panel、23save；229,609host events、0loss/open spans；970publication overlaps。後續 audit 發現極端 fixture 寫入失敗未阻止認證，因此撤回其完整 coverage 判定；保留其他診斷資料，不能替代 MainVault。

瀏覽器操作與 rAF 都不證明 native IME／Explorer；原 E1 native gap 保留。正式三輪仍需各自執行 post-measurement recovery/rebuild 驗證。

## 凍結來源與環境

來源為既有完整 Acceptance workspace，僅以 readonly SQLite 與檔案讀取核對。SQLite online backup 的 raw DB bytes 可以不同；所有 SQL rows/blobs 必須相等，所有非 DB 檔案與目錄必須相等。三份 trial 都是 frozen tree 的獨立 ordinary-file copies。

| 項目 | 已驗證值 |
| --- | --- |
| 完整來源 | 40,016 files；3,144 directories；8,027,848,074 bytes |
| 資料庫 | Schema 5；workspace revision 53；629,207,040 bytes |
| Corpus | 2,821 notes；244 folders；0 records；506 attachments／433 unique blobs |
| Markdown source | 6,211,836 UTF-8 bytes |
| Attachment metadata bytes 合計 | 540,671,245 bytes（含重複 hash 的邏輯附件） |
| Source tree SHA256 | `b119a89481bc56e5ed33ce850b1ab21f6bb39350c3a3e20df0f5583ab3843c24` |
| SQL logical fingerprint | `91e1d8af2a02c0033ba0dc0d491ad600f89ce01e0669111f07113912e9a780aa` |
| Frozen／三 trial tree SHA256 | `bf3b87d5217a5719f8d9ac30bf45010fc5013ed10e3316f976ec8173ae5f64a9` |
| Node／browser | Node 24.18.0；Edge 154.0.4258.37 headless，1440×1000（smoke 實測；正式 run 各自再記） |
| OS cache | 未清除；不宣稱 disk-cold |
| Hardware／storage／power | 正式 run 由 harness 記錄可取得資訊；storage contention、power profile 無證據者記 Unknown |

來源未變更的目前證據範圍止於凍結驗證；正式試驗結束後仍須重新比對原始 inventory。首次 host 啟動與首次 deliberate checkpoint 分別記錄；copy 已含既有 generation，不宣稱空樹首次生成。

## 正式結果

尚無有效完成的正式 trial。第一輪 `2026-09-29T14-44-27-998Z-trial-1-83f8c9c8` 在 source5f3103f/build460b1220… 下正常結束，但極端 fixture PUT 收到HTTP422；harness吞下required mutation失敗後仍填入預定規模。此輪及先前小型 full-count 的「完整」判定因此不足以證明極端 workload，明確排除正式驗收。原始report/trace保留，旁置audit.json校正；其他階段仍可作診斷資料。這是量測認證缺陷，不是以性能超標為由排除樣本。

修正需使用獨立合成Extreme note及不碰撞的bindings、canonical reference caches，並在成功寫入後重新讀取，驗證實際source/hash/bytes/definitions/references。任何required mutation或驗證失敗均使cell incomplete。從Frozen另建Trial-1R後，重新執行三輪同協定驗證；舊Trial-1不重用。三輪需分別列出 idle、cold、warm、same-revision no-op、validation、large DB／graph、extreme-note 與 publication overlap 的樣本數、失敗／取消／timeout、實際 overlap 及 direct-browser／driver 指標。

15:13UTC 的 `replacement-trial-summary.json` 確認 Trial-1R 與 Frozen 的完整 fingerprint 相同。接續 synthetic diagnostic `2026-09-29T15-15-03-131Z-verified-extreme-ba33419d` 已證明 Graph 1,000 definitions／5,000 references，以及獨立 Extreme note 的實際 1,750,000 UTF-8 bytes／10,000 definitions／50,000 references；returned snapshot 與獨立 readback 的原文 hash 相符。但 Source 的 30 次輸入都在編輯器仍 inert 時失敗，Live 20 次成功；此輪同樣不算完整 coverage。修正測試器每種模式的 writable readiness，另記準備等待，並加入 Source／Live 直接輸入證據 gate；不改產品行為。

此診斷另於15:38UTC超過600,000ms測試器關閉等待上限：hard stop、缺少trace footer且6個host span未結束，3,488,200事件不能視為完整trace。後續同協定統一使用既有CLI支援的1,800,000ms測試等待上限，產品timeout維持原值。修正後的synthetic與正式結果仍待執行，未把等待上限調整寫成性能改善。

`pending` checkpoint response 表示未確認「當前最新版已完整發布」；若 trace 顯示較舊 capture 成功，必須分列 successful publication 與 latest pending，不能把它寫成 publisher crash，也不能當成最新 ready。不存在的 dedicated DB queue／job status API 記 N/A。同步 wall、process-wide CPU 與 filesystem await 不互相代換。

P0 完成需要可信量測與完整 coverage；UX budget 超標是基線結果。缺失 overlap、語料不完整、事件遺失或沒有 terminal outcome 仍屬未完成。後續 P1–P5 不在此輪自動啟動。

## 證據定位

以下均相對於 repository 的上一層 workspace root；private evidence 不進 Git。

| Locator | 用途 |
| --- | --- |
| `Scratch/Performance-P0-20260929/fixture-summary.json` | 凍結／三副本校驗摘要 |
| `Scratch/Performance-P0-20260929/source-before-private.json` | 原始完整 inventory，私有 |
| `Scratch/Performance-P0-20260929/Frozen/Workspace/` | 凍結完整來源，保持唯讀 |
| `Scratch/Performance-P0-20260929/Trial-1R/Workspace/`、`Trial-2/Workspace/`、`Trial-3/Workspace/` | 待重跑的三個獨立正式 trial；舊 Trial-1 保留 |
| `Scratch/Performance-P0-20260929/Evidence/2026-09-29T13-53-47-445Z-smoke-small-76c9e151/` | 小型 smoke；原始分類與後續校準保留 |
| `Scratch/Performance-P0-20260929/Evidence/2026-09-29T13-54-41-291Z-smoke-full-83b34f68/` | 初始化失敗的完整 smoke |
| `Scratch/Performance-P0-20260929/Evidence/2026-09-29T13-58-20-755Z-smoke-full2-14d6e904/` | 完整七情境 smoke；原始事件及失敗保留 |
| `Scratch/Performance-P0-20260929/Smoke-full-correctness/correctness.json` | 完整 recovery／fresh-DB／原資料驗證 PASS |
| `Scratch/Performance-P0-20260929/Evidence/2026-09-29T14-40-13-740Z-fullcounts-ready-19f146ed/` | 舊 full-count synthetic；fixture audit 後撤回完整 coverage 判定 |
| `Scratch/Evidence/2026-09-29T13-50-29-027Z-29208-5a6b776c/playwright/e2e-results.json` | 45 項 production browser regression |

Commit、正式 build、試驗結果、完整 correctness、原來源最終比對與最後 Git 保存狀態待完成後補實際值。
