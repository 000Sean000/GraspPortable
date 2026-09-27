# M4：全量 MainVault 與成品驗收

更新：2026-09-28 Asia/Taipei。產品完成狀態以 EXECUTION-STATE 為準；本頁區分每一份實際證據，原始私人資料不入 Git。

## 全量確定性往返：通過

Windows／Node24.18／Intel i9-13980HX。執行 scripts/verify-portable-roundtrip.ts，2026-09-27 17:47:09–17:54:31 UTC。輸入唯讀 Acceptance/MainVault-Source，寫入全在新 Scratch/MainVault-M4-20260928-0147；不是對原始 snapshot 執行編輯。

| 對照 | 實際結果 |
| --- | --- |
| 全部原始 snapshot | 3,365 files、254 directories、557,532,734 bytes；含排除的工具資料完整前後 inventory/hash/mtime 比對一致 |
| 納入 DB | 2,820 Markdown、244 folders、506 attachments、546,882,934 bytes |
| 筆記原文 | 全2,820筆 SHA-256一致，包含原有換行／raw source；沒有自動語意分類或重写 |
| 附件 | 全506附件 bytes/hash一致，preview不保留全部附件body |
| 既有 links | 11,710 total：11,399 resolved、219 missing、91 external、1 unsupported、0 ambiguous／unsafe；缺失保留診斷，不捏造目標 |
| 分組與共享 | 另加一篇清楚命名的synthetic acceptance note；兩個bindings與正文分開輸出，owner/IDs不變 |
| Partial | 只選M4.Root，不夾带同owner的M4.Nested／其他私人資料或未選附件 |
| 外部匯回 | 修改 canonical literal Before→After；明確Review/Import，nested值及persistent caches一致，原始2,820notes仍hash一致 |
| Full fallback | 完整Markdown樹copy成獨立資料夾；沒有原DB的情況下驗證並重建新DB |
| Rebuild | Exact notes/folders/records/assets/semantic IDs/source placement/dependencies/strategy/lineage/provenance一致；新workspace instance ID |
| 重建後操作 | 再修改shared literal為After rebuild；nested更新；真正close/reopen DB後shared state一致 |
| 來源保護 | 原始snapshot及匯入用Source-copy前後皆完整一致 |

匿名結果：[mainvault-roundtrip.json](benchmarks/mainvault-roundtrip.json)。原文、path mapping、完整hash inventory、錯誤stack及screenshots只在Scratch。

| 階段 | 單次 elapsed |
| --- | --- |
| Preview | 10.72s |
| Migration apply／來源重驗／新DB | 42.76s |
| 全筆記／附件匯入驗證 | 1.84s |
| 初次完整checkpoint | 93.18s |
| Selected export | 2.81s |
| 外部匯回後完整checkpoint | 190.05s |
| 脫離DB的fallback驗證 | 15.53s |
| Fresh DB rebuild | 8.46s |

這些是本機實際整合run的wall-clock階段時間，沒有清空OS disk cache；期間曾執行短build／focused tests，不是隔離硬體benchmark。RSS階段樣本約89–658MB，並非peak allocator profile。Checkpoint含逐檔安全檢查、hash、獨立副本與retention，尚有可改善成本；沒有把完整發布190秒偽裝成打字延遲。

第一輪17:45的匯入成功，但verifier用JavaScript strict prototype比較SQLite null-prototype row與plain DTO而失敗。修正為逐欄完整serialized DTO比較，第二輪從新的副本重跑全流程通過；原失敗目錄保留，沒有略過資料核對。

## 完整 corpus Browser：兩輪通過，file locate 修正版已驗證

2026-09-27 17:57:35–18:02:15 UTC，以 Edge headless 開啟 production build 與完整 Scratch 匯入 DB。這是實際 browser／DOM 操作的自動化證據，不是 Human 看過桌面視窗，也不是 Explorer／Obsidian／實體 Windows IME 證據。

| 項目 | 第一輪結果 |
| --- | --- |
| 資料規模 | 2,821 notes（含一篇獨立 synthetic acceptance note）、244 folders、506 attachments；2 bindings／2 occurrences |
| 開啟到 runtime ready | 1,725.76 ms，單次測量 |
| Reading | 搜尋並開啟 acceptance note，Reading mode 讀到已匯回的 `After` |
| 策略面板 | 顯示 Markdown 與手動完整 checkpoint 入口；當次 catalog DOM 有 41 個 checkbox rows，不能把 DOM rows 當總資料筆數 |
| Files 面板與定位 | 顯示實際 DB path；locate API 回傳的 note 檔案在 filesystem 存在，未啟動 Explorer |
| 窄視窗 | 1024 × 768 viewport；document width 1024、panel width 802，沒有水平 overflow |
| Browser errors | pageErrors = 0；report status = passed |

私人報告 locator：`Scratch/MainVault-M4-20260928-0147/Imported/Browser-verification/aggregate-results.json`。Reading／strategy／files／narrow 的 screenshots 保持私人，不納入 Git；本頁只記彙總結果。

第一輪發現 settings-only revision 使顯示檔案不必要地重建完整 checkpoint；當時未量測 locate latency，也未斷言 published generation 不變，因此另行重跑修正版。

修正版於 **2026-09-27 18:16:48–18:18:19 UTC 通過**，匿名報告：[mainvault-browser.json](benchmarks/mainvault-browser.json)。完整資料規模仍為 2,821 notes／244 folders／506 attachments、41 catalog DOM rows；open to ready **1,651.658 ms**。Note locate **9,088.877 ms**，路徑實際存在，且 **published generation fingerprint 前後一致**，證明此次沒有為 settings-only revision 重建整個 fallback。定位仍需完整樹的 external-dirty 安全掃描，約 9 秒並不即時，保留為可改善成本。

修正版窄視窗仍為 viewport／document width 1024、panel width 802，0 JavaScript page errors；Reading、策略、Files 操作皆通過。它仍是 Edge headless production browser 的操作與 filesystem 路徑證據，不是 Explorer／Obsidian GUI。

## Shared domain／SQLite：具體效能與一致性證據

匿名原始數據：[shared-domain.json](benchmarks/shared-domain.json)。命令 `node --expose-gc --import tsx scripts/benchmark-shared.ts`；產生時間 2026-09-27 18:09:03 UTC，Windows x64／Node v24.18.0／i9-13980HX／32 logical CPUs，explicit GC 開啟，總執行 26.27 s。Fixtures 全為目前 `grasp-v1`，走正式 parser、ValueGraph、semantic preparation 與 SQLite，不含私人 corpus、filesystem publication 或 browser typing。

每種 topology 附 1,000 個正文 references；初次及 root literal edit 都影響整個 topology。以下 parse 與 graph wall 是分開計時的單次階段，不能當成 p95：

| Topology | Definitions | 初次 parse / graph wall | Root edit parse / graph wall | Root edit recalculated |
| --- | ---: | ---: | ---: | ---: |
| Deep chain | 12,000 | 109.18 / 46.08 ms | 82.30 / 48.20 ms | 12,000 |
| Wide fan-out | 10,001 | 101.21 / 35.15 ms | 75.87 / 27.11 ms | 10,001 |
| Mixed diamonds | 6,001 | 69.82 / 16.65 ms | 52.29 / 14.71 ms | 6,001 |

三種 topology 都實際走 missing → recovery、cycle → recovery，斷言最後值／status 正確，未發生遞迴 stack overflow。每組執行 100,000 次 definition＋reference indexed lookups，分別為 2.40／2.02／2.20 ms；這是 in-process lookup loop，沒有 UI 或 transport 成本。

另一組 10,004 definitions／1,000 references 反覆修改小 diamond 共 30 次；每次只重算 **4** 個 affected nodes、產生 **1,000** 個 cache source patches，兩種 reference 的結果及 Binding／Occurrence IDs 每次皆核對一致。初次 prepare 236.06 ms。

| 30 次小改階段 | p50 | p95 | max |
| --- | ---: | ---: | ---: |
| Intent materialization | 0.69 ms | 1.60 ms | 2.11 ms |
| Prepare（parse、graph、identity、cache source、source reindex） | 412.08 ms | 504.60 ms | 513.76 ms |
| Intent＋prepare | 412.67 ms | 505.36 ms | 515.05 ms |
| Graph only（prepare 內含子階段） | 11.39 ms | 20.06 ms | 20.20 ms |

Graph only 不可再加到 prepare，或拿來代表全部 semantic commit latency。每五次 explicit GC 的 boundary samples 顯示 retained heap 較初次增加 15,779,088 bytes；有限次測量不能據此宣稱無 leak。

SQLite 另用 12,000 definitions／1,000 references，初始化 DB＋source 為 1,767.21 ms。5 次真實 durable shared commits 的 p50／p95／max 為 **1,655.63／1,716.49／1,716.49 ms**；每次變更兩篇 Note，保存全部 1,000 個正確 caches，Binding／Occurrence IDs 不變。Receipt reads p50／p95 為 0.60／1.03 ms；同 operation replay 99.28 ms。關閉後重新開啟＋讀取 authority 為 373.47 ms，revision、IDs、最後值與 receipt 全部核對一致；DB 大小 101,203,968 bytes。這些包括 transaction、semantic prepare、receipt／inverse serialization 與同步 durability，沒有 HTTP／Worker／DOM latency，也沒有清空 OS cache。

OS 報告整個 benchmark 的 max RSS 為 567,244 KiB；boundary samples 與 GC 後 RSS 不是 allocation profile，runtime 可能保留已配置記憶體。以上數字已暴露 parse／identity／cache materialization 與 durable commit 的實際成本，不宣稱 100 ms typing 目標已因此通過。

## Scale10 production browser：兩項回歸通過，理想效能目標未完全達成

最終 synthetic `grasp-v1` workload 為 **10,000 identifiers／50,000 reference occurrences**，Chromium／Edge production browser、profiling 關閉；2026-09-27 18:15:57 UTC 報告為 **2 tests passed**。匿名結果：[shared-browser-scale10.json](benchmarks/shared-browser-scale10.json)；私人原始 locator 為 `Scratch/AutomatedTests/shared-performance/1790532891962-21664/performance.json`。公報移除 database path 與 server logs，保留全部計時樣本。

初始 input 為 1,602,237 characters，包含 materialized caches 的 source 為 **1,746,670 characters**。本次 typing 是在普通正文 **EOF 追加**；Source 30 次、Live Preview 20 次，**包含第一次輸入的全部樣本**。計時含 browser automation 的 input completion 成本，不是實體 IME 或純 browser paint 的獨立量測，也不保證中段編輯觸發完整 parse 時具有相同 latency。

| 模式 | 完整 samples | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| Source | 30 | 98.119 ms | 204.285 ms | 247.301 ms |
| Live Preview | 20 | 117.738 ms | 319.283 ms | 319.283 ms |

兩者通過本次 **p95 < 500 ms** 的自動回歸閾值，但沒有達成 Plan 的 **p95 ≤ 100 ms** 理想目標。Long Task API 的最大樣本為 **241 ms**，包含 rendering／save work，因此「沒有 ≥ 200 ms 長任務」的目標也未完全達成。不能用 regression passed 或 Source p50 代替這兩項未達目標。

從 reference 修改共享值到 cascade commit＋browser ready 為 **7,667.457 ms**。接著完整核對 **10,000 results／50,000 persisted caches**，耗時 21.946 ms、0 failures；沒有只抽樣最後一個值。真正 host restart＋readback 為 **4,054.445 ms**，cascade 與 restart 一致性通過；typing 過程保留原有 identities，typing／cascade 均為 0 JavaScript page errors。此處將共享提交與打字反應分開，不拿 7.67 秒當 input latency，也不省略它。

調整期間曾有 Live p95 約 **1,089 → 645 → 319 ms**、cascade 約 **88.43 → 7.67 s** 的觀測；cache patch 整字串重複複製、ChangeDesc 重複掃描及 visible-node 全 semantic spans 掃描已作有界修正。這些是不同修訂下的單輪記錄，不是重複多輪統計或保證每次都能達到相同速度；最終表格只使用上述完整最後一輪。

## Acceptance 副本：完整複製 hash 核對通過

2026-09-27 18:11:14 UTC，已將驗證過的 workspace 建立獨立 Acceptance 副本。核對 **10,003 files／2,478,018,402 bytes**，`exactHashesMatch = true`。這是交付所需 workspace 檔案的完整逐檔比對；不把 staging／benchmark 資料一起放入驗收入口。

本次有意排除 migration checkpoint `workspace.grasp.db.migration`、`Browser-verification` 與 exchange temporary selection exports。完整私人來源／目的地與逐檔證據保持在 `Scratch/MainVault-M4-20260928-0147/acceptance-copy-private.json`，公報不列原機絕對路徑或私人 note titles。Hash copy 與新位置啟動是獨立證據；後者結果見下一節。

## 最終整合檢查與交付

| 項目 | 目前狀態 |
| --- | --- |
| 最終 scale10 browser workload | **兩項回歸通過**：全部 50,000 caches／restart／identity 核對完成；100 ms typing 與無 ≥ 200 ms 長任務目標仍未完全達成，範圍與數據見上節 |
| 修正版 file locate browser | **通過**：9,088.877 ms，published generation 不變；完整樹 dirty 檢查仍有成本，不宣稱即時 |
| 最新 full unit suite | **41 files／528 tests PASS，12.75 s**；2026-09-27 18:18:34 UTC 啟動的獨占 runner 結果 |
| 最新 production Edge E2E | **36 tests PASS，約 1.8 min**；重跑目前 production build，不沿用 M3 較早輸出 |
| 最終 build | **成功**：2026-09-27 18:11 UTC；browser asset `index-D8mLD6B9.js`，之後沒有產品程式變更 |
| Package smoke | **通過**：0.3.0／50 packaged files；repo 外隔離環境，不需安裝 production node_modules |
| Sandbox 一鍵入口 smoke | **通過**：相符 build identity、正確新版 Acceptance DB、UI HTTP served；不是 native desktop GUI 驗證 |

較早的一輪 unit run 雖有 **522 個別 tests 通過**，但在 I/O 同時進行期間發生 suite `afterAll` timeout、process exit 1；該輪不是整套成功，沒有被隱藏或拿來當 final pass。最後在獨占 runner 重跑目前所有測試，得到上述 41 files／528 tests 全套通過。這與較早 M3 的 512 tests 是不同 checkpoint／不同測試集合。

最終 E2E 詳細輸出：[e2e-results.json](benchmarks/e2e-results.json)。36 項 production tests 包括 legacy workflow 在 cascade 期間仍可輸入、stale／cancel，以及共享編輯、draft recovery、策略／外部匯回等整合流程。它與上節 scale10 的兩個大型 workload tests 分開記錄，沒有把兩種數據混為一輪。

執行 `npm run package` 與 `node scripts/smoke-package.mjs`，於 **2026-09-27 18:22:09 UTC 通過**，見 [package-smoke.json](benchmarks/package-smoke.json)。首次封裝 `GraspPortable-0.3.0` 的 50 files 複製到 repository 外的獨立環境，production host 不依賴 node_modules；launcher 啟動、SQLite 寫入、export、附件 bytes、真正 restart 與 mirror publication 全通過，private files absent。交付前另同步最終公開文件及入口驗收報告，不變更執行檔。套件不內含 Node runtime，仍需要獨立安裝 Node.js 24+。

再以 Sandbox 的 `開啟 MainVault 驗收.cmd` 執行真實入口 smoke，於 **2026-09-27 18:23:10 UTC 通過**，見 [delivery-launch.json](benchmarks/delivery-launch.json)。它在 port **43861** 開啟 `Acceptance/MainVault-Grasp-v0.3/.grasp/workspace.grasp.db`，build identity 與交付 build 相符，API 核對 **2,821 notes／244 folders／506 attachments／2 bindings／2 references**，UI HTTP 正常提供。測試 host 已關閉；這證明一鍵入口選到正確資料與 build，沒有將 HTTP／process 成功冒充 Explorer、Obsidian 或 Human 目視桌面驗收。

## 尚未驗證的平台與既有限制

Windows NTFS／Edge browser 之外的 FAT/exFAT、network filesystem、原生 App、iOS/iPadOS 與 Sync 不屬已驗成果。普通 Markdown 可讀與 Grasp 精確重建已有自動化證據；Explorer、Obsidian、實體 Windows IME／原生 zoom 尚無本輪 Computer Use 操作證據，仍需 Human 現場驗收。完整 fallback 不是 DB 全部 operation/history 的二進位備份；草稿復原須明確手動選取。

性能限制保留：scale10 EOF typing 的 100 ms p95／無 ≥ 200 ms 長任務目標未完全達成；中段觸發完整 parse 不保證同樣 latency。完整 corpus 的 note locate 約 9.09 s，初次／更新後完整 checkpoint 分別約 93.18／190.05 s。這些等待雖沒有改變 DB authority 或假裝發布完成，仍會影響日常使用，屬後續可局部改善的成本；不能以 build／test／smoke 通過將其省略。
