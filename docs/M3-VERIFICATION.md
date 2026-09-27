# M3：分組策略、Markdown 與完整重建

驗證時間：2026-09-28 01:37–01:39 Asia/Taipei。正式產品實作；不等於完整 A+B Goal 已完成。

## 已完成與證據

- Stable semantic units（note prose、binding、record information），同篇兩個 binding 可分別輸出，原 owner/source placement 不變。Scoped package、partial/full coverage、explicit unassign、未分配確定性位置、重複配置／unsafe paths／stale proposals 有拒絕測試。
- 相同 renderer 產生 partial/full 普通 Markdown、值、definition links、附件相對路徑。Partial 不含未選 owner source／sibling／draft／private asset。Full 含自足 hidden metadata，保留 raw source、IDs、dependencies、定位、strategy、provenance 與可手動恢复 drafts。
- 外部修改保留 dirty；DB 保存可信發布 baseline，不能藉修改並重簽公開 metadata 取得修改其他 binding 的權限。多個 dirty canonical 檔案共同 preview、hash 檢查及原子 import；已核准 hash 與 import 同 DB transaction，restart 不遺失核准。
- 外部只改普通正文，未改動的相同值／相同名稱 reference 仍保留各自 occurrence ID；protected-token 分段 source edit proof 有 domain＋host 回歸。
- 唯一 publisher：初次發布、10分鐘 coalescing、明確 checkpoint；typing只更新便宜 stamp，不每鍵整理全 catalog。兩次 rename cutover有 durable journal／故障復原；cutover最後時刻的外部修改仍還原並保留。保留兩代獨立普通檔案 recovery。Windows兩次rename之間可能短暫unavailable。
- Fresh DB rebuild驗證hash、coverage、semantic identities／strategy；附件逐項讀取，新的workspace ID拒絕舊分頁。舊schema升級有獨立verified backup。Fullfallback不承諾完整operation history。
- App分組面板可選semantic units、輸出planning package、Review/Apply策略、partialexport、checkpoint、absolute paths／檔案定位。過期panel回應不能把另一workspace替換回舊資料。

## 實際執行

Windows／Node24.18／Edge headless production build，資料全在 repo 外 Scratch。

| 檢查 | 結果 |
| --- | --- |
| npm run build | tsc、Vite client、production server成功；client>500kB advisory仍在 |
| npm test -- --maxWorkers=4 | 38files／512tests通過，9.19秒 |
| npm run test:e2e | 完整36tests通過，1.3分鐘 |
| M3 production新流程 | 同owner分組、partial隔離、外部binding修改／cache拒絕、stale策略、freshDB＋restart、跨workspace延遲回應4tests全部通過 |
| Host故障與authority | journal cutover、末刻外部修改、metadata自簽、跨檔atomic review、restart approvals、duplicate occurrence identity等10tests通過 |
| Migration基礎 | 14tests通過；stream/resume/source recheck/新DB覆蓋拒絕，未以此聲稱全MainVault驗證 |

完整production結果在 [e2e-results.json](benchmarks/e2e-results.json)。實際畫面已檢視 synthetic strategy review screenshot；沒有用API成功冒稱Obsidian或Explorer畫面。

1,000 bindings／5,000 references／162,682 source chars：Source輸入30samples p50 19.82／p95 144.42／max154.59ms；Live20samples p50 26.06／p95=max55.87ms，無typingpage errors，50次輸入及identities保留。這含automation overhead，非原生IME測量，也不代表Plan100ms整體目標已全部達成。Private完整樣本位於Scratch/AutomatedTests/shared-performance/1790530723807-43552/performance.json。10k/50k新量測與全量MainVault屬M4。

## 剩餘與界線

完整MainVault往返、新驗收workspace／package及大型性能仍待M4。現有MainVault-Grasp是舊160-note rehearsal；原snapshot未修改。Obsidian／Explorer／原生IME／真實zoom未當次操作。舊v0.2交換API保留相容；日常UI共用單一Markdownprojection，沒有第二套persistent AI projection。
