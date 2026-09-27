---
title: GraspPortable — Core Development Method
version: 1.0.0-rc.2
updated: 2026-09-27
status: current-development-method
scope: planning-and-authorized-goal-execution
supersedes: GraspPortable-Core-Development-Method-v1.0.0-rc.1.md
---

## Interface｜Plan 先確認方向，Goal 再完成實作

### 核心目的

依 Core Requirements 的 WHY、產品行為與已接受的 scope，將使用者的心力集中在重要取捨，將已授權的工程工作交由 Codex 持續完成。

Project Seed 的目前文件組合由本目錄 README 集中指定。Seed 是目標與方法，不是 implementation report，也不自動授權開工。

### 工作模式

Plan 階段先核對來源、必要實測及版本差異，提出推薦和少數重大分支，與使用者討論後停止。使用者接受範圍並授權 Goal 後，再完成相應的可操作成果；只有當次明確授權 Plan-first 自動續作時才直接接續。

Goal 內允許完成已接受成果所必要的新功能、修正、重構、測試與封裝。以完整工作流程界定邊界，不以「整理」等任務名稱反向禁止該成果需要的開發。

### 架構與語法主幹

Note 的正文 Reference、可見 Binding、真正程式的 compiler／runtime 是不同責任。正文保留兩種帶可讀值的 reference；Binding 使用 raw literal、identifier 取值與串接。程式碼展示不等於 binding declaration，更不等於執行授權。

一般技術 HOW 由執行者依實務品質、成本與證據決定。會改變資料含義、使用者工作流或造成不可逆影響的選擇，先以具體案例交由使用者裁定。

[語法方法](#4-bindingreference-的實作方法) · [資料流程](#5-database-first-runtime-與資料交換) · [驗證](#11-correctness-and-data-safety) · [交付](#13-goal-deliverables)

## 1. Goal-driven Development

每個工程決策先問：它能否更直接完成使用者要操作的結果？

選擇成熟、來源可取得且維護成本合理的 implementation；必要研究與 spike 為成果提供證據。保留已有正確行為、測試與可用模組，不因技術偏好全面重寫。

Plan 與 Goal 有不同完成條件。Plan 的成果是可供決策的計畫；Goal 的成果是已接受 scope 內完整、可驗證、可操作的產品流程。

## 2. Human Attention Is Scarce

先自行閱讀、研究及篩選，再提交影響判斷的精華。普通套件、資料結構、檔案內部分工等 HOW 自行決定。

重大分支包括難以遷移的 public syntax、來源定案權限、資料權威切換、破壞性 migration、重大付費／license、外部權限，以及會顯著改變使用者體驗的選擇。先用同一 input 的預期輸出或操作樣本說明，再取得裁定。

使用者刪除 scope 時，從現行 requirements、範例、contracts、驗收及任務路由移除對應責任；必要的舊資料相容處理另列 migration。已刪除功能不改寫成一串新的禁止條款。

需求修正時保留有效的 in-progress work，核對當前狀態後更新計畫。不能僅因任務被命名為「驗收整理」，就中斷該成果已授權且必要的功能開發。

## 3. Build for Replaceability

核心 contracts 使用 Grasp 的 identity、note、binding、reference occurrence、logical value、dependency、change、projection strategy 與結果狀態。

Editor、Binding Language adapter、Dependency／Value Engine、Persistence、Exporter、Strategy exchange、Platform Host 分清責任。第三方 editor state、AST、DB handle 停在 adapter；具體 class／project 數量依實作需要決定。

穩定的是資料語意與驗收；可替換的是實作。語法或儲存替換若需要資料 migration，明示成本，不承諾只有換一個 interface 就完全無成本。

## 4. Binding／Reference 的實作方法

### 4.1 已接受的語法責任

正文兩種形式為 `[value](:ref:Identifier)` 與 `[[@Identifier|value]]`。它們保存 identifier 與 rendered／cached value，借宿主顯示弱化 identifier。

Binding 是 assignment 及 composition：raw literal 保存固定文字，literal 外 identifier 取值，`+` 串接。複合內容先有具名 binding，正文再引用單一結果。Binding 區可見、可編輯。

底層模型分開保存原始表示、logical string、literal fragments、dependency references 與快取來源版本。Marker 避碰與宿主 escaping 由 serializer 處理；普通內容不為 parser 方便而被任意 trim、strip 或重新解讀。

### 4.2 Grammar 實作前的校準

已接受的是 raw literal＋串接方向，不是完整語法已通過 conformance。Plan 必須補齊真正影響同一原文含義的邊界，並以最小案例確認：

- Binding 區的外層容器、statement 結束與多行串接。
- Opening／closing marker 的精確匹配、長度避碰、內容恰含 delimiter、相鄰空 literal 的辨識。
- Inline／block literal、結構換行、value 真正的首尾換行、空白、縮排、LF／CRLF 與空值狀態。
- 多行 value 放到正文 reference 時，如何保持可讀與可還原；不能把 inline link 當成任意多段落的透明容器。
- Parser、serializer 與 editor 的 source ranges、diagnostics、錯誤復原及宿主 escaping。

示例必須附 expected logical value／dependencies。兩個例子若對「closing marker 前的換行是否為內容」給出不同答案，先解決矛盾再實作，不把範例複製成衝突規格。

### 4.3 版本與相容

先辨認實際輸入使用的語法版本。新增 parser 不可把舊字串按新含義無聲解讀；轉換保留 literal、identity、composition、cached value 與來源對照，未知形式保留診斷。

舊稿的 forms、comment context、RHS 規則或 update policy，只有在本次已接受的決策仍適用時才沿用。歷史讀取／轉換 adapter 與新版可撰寫的語法分開。

## 5. Database-first Runtime 與資料交換

Grasp workspace 的 DB 是 runtime authority。正式切換前，日用 Obsidian Vault 與 Grasp 測試副本各自有明確資料歸屬，交換經審查。

MainVault → DB 使用確定性搬運，逐筆保存內容、路徑、metadata、可解析關係與 lineage。小檔案各自成 row；匯出分組不作為匯入前置條件。

DB → Markdown 依保存的 Projection Strategy 分組輸出。使用者可編輯策略；外部協作只透過規劃資料與結構化策略接面。App 驗證 identity、基底版本、範圍、漏分配、重複、路徑衝突、過期提案與套用影響。

按需匯出與 fallback checkpoint 共用 exporter 及重建語義。日常 DB 更新不要求逐次整庫 filesystem 發布。Checkpoint 政策根據使用者可接受的落後窗口與目標裝置實測決定；保留最後成功版本與中斷可恢復性。

外部修改經 preview／validation／explicit apply。快取文字、binding、identifier 與普通正文分開識別，避免把一次局部文字修改誤當成整體定義更新。

## 6. Runtime Separation

App Runtime 處理 Note、Binding、Reference、Value Sync、query、persistence、export／rebuild。真正程式由對應語言及 compiler／runtime 處理，透過穩定接面交換資料。

PC 程式接面的能力、版本及執行權限由其獨立計畫承接。Mobile 日常能力採本機 runtime 與資料，保留平台 storage、files、share、lifecycle 接面。

## 7. Performance Strategy

先讓演算法處理 affected graph，再依 measured hotspots 決定 batching、cache、parallelism 或 native implementation。

分開量測：

- 編輯輸入、選取、composition、layout 與 zoom。
- Parsing／index、dirty propagation、重算與 reference lookup。
- DB 保存、持久快取一致性及 snapshot transport。
- 按需匯出、完整 checkpoint、重建及 filesystem 成本。

使用 synthetic deep／wide／diamond／mixed graph，以及可取得的 MainVault 副本。記錄環境、規模、受影響節點與輸出 bytes／檔案量；某一項時間不當成其他項的驗證。

大量檔案搬移用批次 filesystem command 與集中 manifest 驗證。Agent 只讀需要理解的內容，避免逐檔工具回合或把整棵私人資料列印進報告。

## 8. Technology Selection Rule

實務適合度、維護成本、效能證據、source／license、平台能力及可替換性決定技術。歷史討論中的語言、框架或 evaluator 名稱不是新的強制 stack。

普通內部選擇可自行採用；會改變 public syntax 或既有資料解讀的更換先走語義校準。不能為「自由選 HOW」重啟已經由使用者接受的 WHY。

## 9. Portability 與後續平台

Desktop、Apple mobile 共用能合理共用的 domain／editor／calculation contracts，Node、OS、filesystem 與裝置生命週期透過 adapter 處理。

Mobile 及雲端功能依使用者接受的階段交付；產品的長期方向不使目前 Goal 自動擴張。雲端 provider 的 bytes 傳輸、Grasp 的版本／衝突／交易套用，是不同驗證責任。

對 NTFS、exFAT、Apple filesystem、網路磁碟等，只宣稱已測試範圍。相容性未知時列明具體缺口，不以一張架構圖作證。

## 10. Editor Strategy 與 UX 自測

使用者重視真正寫作、閱讀與導航的手感。先把自己當新使用者，依畫面提示完成操作，再讀 source 找根因。

至少對本輪相關流程，實際測 Note／binding 編輯、正文 reference 跳轉、cached value、Reading／Live Preview、table、code fences、錯誤提示、長文及 zoom。區分 bug、missing capability、discoverability、workflow friction 與 scaling。

網頁用 Browser 驗證，桌面視窗與 Explorer 結果用可用的 Computer Use 驗證。API 回應、mock、spawn 成功不等於檔案總管已選中目標。工具不可用時記錄尚未驗證，而不是反覆追求無關測試或改稱已成功。

高頻 editor state 留在適當的本地層。可讀字級、layout 空間與捲動分工一起測，不能靠縮字掩蓋溢出。

## 11. Correctness and Data Safety

共享值修改以已接受的來源／更新政策形成語意命令。完成後 binding、受影響的 dependencies／cached values 與必要原文一致；中途錯誤或過期工作不提交半套結果。

對 raw literal 與 references 做 parser／serializer round-trip、escaping、delimiter collision、LF／CRLF、長字串及 multiline 案例。對 graph 做 differential／invariant tests、cycle、missing、重複更新、取消與 stale result 測試。

對匯出測分組、身分與錨點對照、可讀值、完整 bindings、附件、策略保存及 fresh-DB rebuild；測策略過期、檔案被外部修改、路徑碰撞、部分發布與失敗復原。

原始 MainVault 與指定 Source snapshot 保持唯讀。寫入實驗使用獨立副本；驗收 workspace、私人語料及輸出放在 repo 外。提交只包含 source、tests、文件及適當的 synthetic fixtures。

## 12. Authorized Goal Workflow

1. Rehydrate：讀目前 Seed 入口、已接受的 Plan、repo instructions、實際 source／tests／build 與最新工作停點。
2. Reconcile：確認版本、有效決策及當前工作；未解的重大語義回 Plan，普通 HOW 自主處理。
3. Build：完成已授權的完整 vertical slice，保留有效在製成果，必要的新功能與重構服務該結果。
4. Verify：build／tests／benchmark，再親自走使用者流程；修正當次範圍的明顯問題。
5. Checkpoint：完成 coherent segment 後，按本任務授權建立 Git checkpoint。進度及 exact next step 放工作狀態文件，不放長期 Seed。
6. Deliver：達到該 Goal 的實際完成判準再交付；受環境或額度阻擋時明確標示未完成部分。

### Git

沿用當次明確授權的既有 remote branch。已授權自動 commit／push 的 Goal，在 coherent segment 驗證後提交、推送及核對結果；私人資料、credentials 與生成的驗收資料不進 Git。

保留本機未提交變更；遇到遠端並行修改先 reconcile，不以破壞性 reset、改寫 history 或 force push 解決。Push 暫時失敗可保留 local checkpoint，記錄待推送狀態。

### 額度與停工

主要 milestone 前後記錄實際可取得的 quota snapshot、來源、時間、window、差值、成果及 commit 關聯。只在同一額度窗口計算差值；帳戶總量不冒充單任務精確計費。無法讀值就記 unavailable，不估 token。

正常高能力額度耗盡時停止實質工作，不改以 Luna／Reserve 繼續。工作中持續保存 checkpoint，使突然失去額度時仍可恢復；剩餘權限／額度允許時只做最低必要收尾，不保證零額度後還能跑完整驗證。記錄未完成、blocker、exact next step，等新的明確授權或正常續作條件。

## 13. Goal Deliverables

交付前方只提供立即可操作的資訊：啟動方式、驗收 workspace、已完成流程、實測結果、已知限制及最後 checkpoint。

Repo 內保留 source、tests、必要 benchmark、短 architecture／debug map 與 decision log。可改名的核心文件由 Seed 入口集中路由；歷史報告仍描述其原始版本，不冒充新行為證據。

匯出／檔案工作需明示實際資料夾、取得檔案方式及 fallback 的時間／資料版本。每個未驗證平台或 GUI 步驟都有清楚狀態，避免使用者在複雜 scratch 路徑自行找成品。

## 14. 成品評估方式

使用者實際操作 → 指出具體摩擦 → 定位責任模組 → 接受下一段改進 → 實作驗證，是持續迭代的主流程。

測試通過與使用者接受分開記錄。Seed 更新只保存新目標／方法；不改寫歷史測試結果，也不宣稱 App 已經實作新的資料契約。

[返回 Interface](#interfaceplan-先確認方向goal-再完成實作)
