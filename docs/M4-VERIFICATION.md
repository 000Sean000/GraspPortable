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

## Browser、性能、package 與交付

本段仍在驗證，最終結果會補入此處。M3已有512tests／36productionE2E；新editor／launcher等修改需要本段對應重驗，不沿用舊結果冒稱當前全部通過。

已觀察完整資料庫的Reading、策略與Files面板實際productionbrowser畫面。發現settings-only revision觸發顯示檔案時不必要的全checkpoint，正在修正並回歸。Explorer／Obsidian／原生Windows IME沒有本輪可用Computer Use操作證據，API成功不算桌面GUI。

大型v1 workload的初次Live p95超過500ms regression gate，已保存失敗資料；之後發現cache patch的整字串重複複製、ChangeDesc重複掃描及visible-node掃全部semantic spans。修正與最終完整50kcache／restart量測尚待以下成果補齊。Plan的100ms理想目標與500ms自動回歸閾值是兩個不同數字，不互相代替。

## 尚未驗證的平台與既有限制

Windows NTFS／Edge browser之外的FAT/exFAT、network filesystem、原生App、iOS/iPadOS與Sync不屬已驗成果。普通Markdown可读與Grasp精確重建已有自動化證據，Obsidian實際畫面須由Human另驗。完整fallback不是DB全部operation/history的二進位備份；草稿復原須明確手動選取。
