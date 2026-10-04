---
title: GraspPortable — Core Development Method
version: 1.0.0-rc.13
updated: 2026-10-05
status: current-development-method
scope: planning-and-authorized-goal-execution
supersedes: GraspPortable-Core-Development-Method-v1.0.0-rc.12.md
---

## Interface｜Plan 先確認方向，Goal 再完成實作

### 核心目的

依 Core Requirements 的 WHY、產品行為與已接受的 scope，將使用者的心力集中在重要取捨，將已授權的工程工作交由 Codex 持續完成。

產品 WHAT／WHY 由 [Project Seed](../Project_Seed/README.md) 指定；開發方法與架構規劃由 [Engineering 入口](README.md) 指定。本文件承載整體方法策略；實際選型結果由 Engineering 入口連到獨立的技術決策文件。當前授權與交付範圍見 [工作狀態](../EXECUTION-STATE.md)。

### 工作模式

Plan 階段先核對來源、已知事實與真正影響當前決策的資訊，提出推薦和少數重大分支，與使用者討論後停止。使用者接受範圍並授權 Goal 後，再完成相應的可操作成果；只有當次明確授權 Plan-first 自動續作時才直接接續。

Goal 內允許完成已接受成果所必要的新功能、修正、重構、測試與封裝。以完整工作流程界定邊界，不以「整理」等任務名稱反向禁止該成果需要的開發。

### 架構與語法主幹

Note 的正文 Reference、可自然分布於 Note 各處的 Binding 語法區、真正程式的 compiler／runtime 是不同責任。正文保留兩種帶可讀值的 reference；Binding 使用 raw literal、identifier 取值與串接。不要求集中於專屬 section；外層區域依最新 Seed 的語法方向，不能用舊稿「不設 container」否定新提案。程式碼展示是否參與 Grasp parsing 依 workspace 的語言清單；停用區不可建立或回寫資料。啟用 parsing 也不等於任意程式執行授權。

一般技術 HOW 由執行者依實務品質、成本與產品適合度決定；只有會改變當前決策或驗收結果時才補充研究、測試或量測。會改變資料含義、使用者工作流或造成不可逆影響的選擇，先以具體案例交由使用者裁定。

[語法方法](#4-bindingreference-的實作方法) · [資料流程](#5-markdown-工作資料與恢復) · [驗證](#11-correctness-and-data-safety) · [交付](#13-goal-deliverables)

## 1. Goal-driven Development

每個工程決策先問：它能否更直接完成使用者要操作的結果？

選擇成熟、來源可取得且維護成本合理的 implementation；研究與 spike 只在能降低當前重大不確定性時進行。依已接受的重寫或維護範圍安排工作；既有成果是否可沿用，以當前決策為準。先完成可操作成果，再依真實使用摩擦局部改善；以責任可替換及問題可定位控制長期成本。

產品完整需求與單次交付範圍分開；每次依已接受 scope 確認可操作成果、受影響契約及完成判準。實作完成、必要驗證通過與使用者接受分別記錄，效能及平台結果只陳述實際確認範圍。

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

Binding 是 assignment 及 composition：raw literal 保存固定文字，literal 外 identifier 取值，`+` 串接。複合內容先有具名 binding，正文再引用單一結果。Binding 本身可見、可編輯，不要求固定 section；語法區的 opening／closing 與 statement grammar 依現行 Seed 和已接受語法決策，與 Note 中的自由放置分開處理。

底層模型分開保存原始表示、logical string、literal fragments、dependency references 與快取來源版本。Marker 避碰與宿主 escaping 由 serializer 處理；普通內容不為 parser 方便而被任意 trim、strip 或重新解讀。

### 4.2 Grammar 實作前的校準

S1 已整體接受 Syntax Review rc.3 profile；現行語法文件保存同一 profile 與必要明確化。接受規格不等於 parser 已通過 conformance。實作以少量 exact-value 案例保護下列邊界：

- Binding 語法區的起始／終止、literal 優先權、statement 分隔、相鄰區域與未閉合錯誤；已接受 `@code{ ... }`，依現行語法文件的確定性邊界實作。
- Assignment operator 與第一個 expression token 之間的排版空白／換行；opening marker 是否與 `=` 同行不得成為資料語意。
- Opening／closing marker 的精確匹配、空值、內容恰含 delimiter；本版依使用者方向採單層起始及 marker 疊層，value 僅在 inline 邊界作局部 escape，block 原文保留。具體 profile 仍可替換。
- Inline／block literal、結構換行、value 真正的首尾換行、空白、縮排、LF／CRLF 與空值狀態。
- 分行 marker 的水平排版空白與內容行空白分開；對目前選定 profile 保留少數 delimiter／backslash／邊界字元的 exact-value 反例，不強迫 pipe 值改成多行。
- ASCII 連續 qualified name、只在定義左側使用 @、不使用分號；可設定 code fence allowlist、disabled 區不遞迴啟用，以及政策變更造成的資料影響。
- 多行 value 放到正文 reference 時，如何保持可讀與可還原；不能把 inline link 當成任意多段落的透明容器。
- Parser、serializer 與 editor 的 source ranges、diagnostics、錯誤復原及宿主 escaping。

示例必須附 expected logical value／dependencies。兩個例子若對「closing marker 前的換行是否為內容」給出不同答案，先解決矛盾再實作，不把範例複製成衝突規格。

### 4.3 Raw Literal 的輸入負擔

Raw literal marker 不容易手打，因此 Editor 應提供 paired-delimiter autocomplete：

- 輸入 opening marker 時，自動補出 matching closing marker，游標留在中間。
- 配對及避碰依已選 syntax profile；本版 marker level 增加時同步兩端，不改寫 value 內部括弧或反斜線。
- Autocomplete 是 UX 輔助，不是 grammar 前提；手動輸入或外部匯入的合法 source 同樣可解析。
- 刪除、undo／redo、paste、IME 與 delimiter 調整不可 aggressive 改寫使用者內容。

常用語法若難以鍵入，可調整 syntax 與 editor affordance，依使用者體驗選擇；不以補完為理由強留不順手的符號，也不要求記憶大量 escape。

### 4.4 版本與相容

先辨認實際輸入使用的語法版本與 workspace parse policy。Markdown context、syntax lexer／parser／serializer、syntax-independent binding AST、名稱解析／計算分層；不讓 delimiter 進入 graph 或 persistence 語義。Source ranges 保留可逆映射，editor 與 Host 共享規格及代表案例，由 Host 最终裁定。新增 parser 不可把舊字串按新含義無聲解讀；轉換保留 literal、identity、composition、cached value 與來源對照，未知形式保留診斷。

舊稿的 forms、comment context、RHS 規則或 update policy，只有在本次已接受的決策仍適用時才沿用。歷史讀取／轉換 adapter 與新版可撰寫的語法分開。

## 5. Markdown 工作資料與恢復

以現行 Seed 的資料權威為準：Markdown 是已保存原文，SQLite 承載索引、計算、版本基底、durable drafts 與恢復日誌。草稿與日誌不是可任意丟棄的快取；改寫來源前核對共同基底，任何失敗都不能把新原文替換成舊成功結果。

檔案 watcher 提供線索，reconciliation 才核對真實來源。Grasp 回寫、外部引用值修改與普通編輯分開辨識；依現行產品政策自動接受一般外部修改，只對衝突／不明身分要求處理。資料庫短交易與跨檔恢復日誌分開驗證，不用 ACID 宣稱多檔同時原子更新。

工作檔案合併／拆分、Markdown table 轉縱向 records 及舊 DB workspace 遷移，先預覽並保留可恢復材料。已接受的來源／schema／屬性規則不可由 serializer 或表格 UI 自行重定義。

備份／checkpoint 使用固定快照及完整 generation；日常保存不等待備份。頻率、保留數及還原政策以 Seed／實作計畫的已接受設定實作，不再重問已定案的取捨。

## 6. Runtime Separation

App Runtime 處理 Note、Binding、Reference、Value Sync、query、persistence、export／rebuild。真正程式由對應語言及 compiler／runtime 處理，透過穩定接面交換資料。

PC 程式接面的能力、版本及執行權限由其獨立計畫承接。Mobile 日常能力採本機 runtime 與資料，保留平台 storage、files、share、lifecycle 接面。

## 7. Performance 與驗證成本

依 Seed 的互動品質與成長要求，先界定代表性 workload、預期成長、裝置與延遲門檻，再評估端到端成本及 CPU／記憶體／I/O 餘裕。分別記錄已觀測結果與成長推估，避免只用目前樣本或單一計算階段代替整體品質。

依 binding 關係建立 dependency graph，值變更只重算受影響部分。依當次風險檢查 deep chain、wide fan-out、shared dependencies、反覆小改、cycle、missing、取消與舊結果拒絕，同時確認編輯互動。

先定義使用者可感知的 UX／性能要求，再以最低必要成本確認產品是否達成。測試、benchmark、profiling 與 instrumentation 是手段，不是產品交付物；除非使用者明確要求，不把性能工作擴張成全面量測平台、統計認證或多輪實驗工程。

若已有產品使用摩擦、既有量測、workload 特性或架構事實足以支持下一個決策，就直接做該決策所需的比較或實作。只有當「不知道瓶頸在哪裡」會實質改變解法時，才深入 profiling。

效能改善完成後，以能代表真實使用的 UX acceptance 驗證前後結果。某項 UX 失敗時，再針對該失敗做 bounded diagnosis；不要求先完整歸因現有 implementation 的所有成本。

## 8. Technology Selection Rule

技術選擇以產品 workload、長期平台方向、維護成本、可替換性、migration 成本、source／license 與合理的性能預期共同判斷。沿用舊成果不計為技術選型加分。選型方法與實際決策分開保存：本節描述評估方式，獨立決策文件記錄本次選擇、適用範圍、理由與待確認事項。

當 application host、runtime、storage 或其他基礎技術已成為長期架構選擇，可以直接比較候選 stack 與 migration surface；不需要先證明現有 stack 已經無法修復，也不需要先完成 exhaustive benchmark。

會改變 public syntax、資料含義或不可逆資料格式的更換仍須先處理相應的 Human 決策與 migration 邊界。普通可逆 implementation HOW 由執行者自主選擇。

## 9. Portability 與後續平台

Desktop、Apple mobile 共用能合理共用的 domain／editor／calculation contracts，宿主 runtime、OS、filesystem 與裝置生命週期透過 adapter 處理。

Mobile 及雲端功能依使用者接受的階段交付；產品的長期方向不使目前 Goal 自動擴張。雲端 provider 的 bytes 傳輸、Grasp 的版本／衝突／交易套用，是不同驗證責任。

對 NTFS、exFAT、Apple filesystem、網路磁碟等，只宣稱已測試範圍。相容性未知時列明具體缺口，不以一張架構圖作證。

## 10. Editor Strategy 與 UX 自測

使用者重視真正寫作、閱讀與導航的手感。先把自己當新使用者，依畫面提示完成操作，再讀 source 找根因。

至少對本輪相關流程，實際測 Note／binding 編輯、正文 reference 跳轉、cached value、Reading／Live Preview、table、code fences、錯誤提示、長文及 zoom。區分 bug、missing capability、discoverability、workflow friction 與 scaling。

網頁用 Browser 驗證，桌面視窗與 Explorer 結果用可用的 Computer Use 驗證。API 回應、mock、spawn 成功不等於檔案總管已選中目標。工具不可用時記錄尚未驗證，而不是反覆追求無關測試或改稱已成功。

高頻 editor state 留在適當的本地層。可讀字級、layout 空間與捲動分工一起測，不能靠縮字掩蓋溢出。

## 11. Correctness and Data Safety

驗證強度與變更風險相稱。資料語義、DB 交易／跨檔恢復邊界、身份、外部 dirty 保護、fallback／recovery 等被本次變更觸及時，必須保留相應 correctness；未觸及的層面不因一般工程慣例自動擴張成完整測試矩陣。

在已接受的程式沿用範圍內使用現有 tests 與可操作驗收；從零重寫時，沿用文件中的需求與有效反例，再驗證新的實作。新增測試只覆蓋本次新增／修改的 contract、已發現 regression 或具有實質資料風險的邊界。不得為了「證明測試本身可信」無限遞迴擴張測試工程；若驗證成本開始接近或超過產品改動本身，先重新判斷其決策價值。

使用者指定 TestData 是可供測試的副本，依需求選適量樣本；工程預設把試驗放獨立 workspace 保留比較基線，不據此增加整庫測試。私人資料、驗收 workspace 與大量生成 evidence 不進 Git。Legacy1 不在日常搜尋範圍。

## 12. Authorized Goal Workflow

1. Rehydrate：讀目前 Seed 入口、Engineering 入口所指的整體方法與技術決策、已接受的 Plan、repo instructions、實際 source／tests／build 與最新工作停點。
2. Reconcile：確認版本、有效決策及當前工作；未解的重大語義回 Plan，普通 HOW 自主處理。
3. Build：完成已授權的完整 vertical slice，保留有效在製成果，必要的新功能與重構服務該結果。
4. Verify：只做足以驗證當次成果與重大風險的檢查；與 UX 有關時親自走使用者流程。Benchmark／profiling 只在性能本身是驗收目標或仍存在會改變決策的不確定性時使用。
5. Checkpoint：完成 coherent segment 後，按本任務授權建立 Git checkpoint。進度及 exact next step 放工作狀態文件，不放長期 Seed。
6. Deliver：達到該 Goal 的實際完成判準再交付；受環境或額度阻擋時明確標示未完成部分。

### 主動 subagent 協作

Agent 選模與交接的執行設定由 repository [AGENTS.md](../../AGENTS.md) 路由至 AgentOps 的現行模型路由入口；本文件維護產品成果、ownership 與必要驗證。

每個自然工作段開始，主代理評估獨立收益與完整交接成本；有實際收益才委派，不等待使用者逐次指定，也不為填滿名額拆工。Root 保留範圍、共同契約、資料所有權、交易邊界、跨模組整合與最終驗收。

每次交棒附目標、ownership、契約／反例、完成判準、範圍及停止條件。共享工作目錄採不重疊責任，Contracts、DI、migration 與活躍 GUI 維持單一 owner。原 agent 適任且已有有效 context 時優先延續；主代理已定位的小修正直接完成。

以一個可驗證成果組成工作段，通常包含實作與必要 targeted tests；不把同一修改的 coding／testing 無必要地拆給多個 agents。Root 審查關鍵差異與跨模組接縫，不重做全量探索或把 worker 的完成回覆直接當驗收。Goal 在已授權範圍內持續選下一段，不要求使用者逐包批准；暫停與恢復仍依最新使用者指示及原 thread 狀態。

### 全局檢視與有界驗證

每個里程碑結束，同一問題連續兩輪修正無改善，或驗證成本接近產品改動成本時，暫停局部擴張，短記：距離下一個可體驗流程缺什麼、哪個假設被證據推翻、目前是否為主要風險，以及下一步繼續／簡化／調整邊界／延後的理由。

先跑本次必要驗證，修正後重跑受影響項目。只有新失敗、契約變動或具體未解風險才擴大；不設覆蓋率配額、不以 benchmark 平台或統計認證替代產品成果。資料一致性失敗不得完成；UX／性能未達可交早期試用但必須標示失敗，不自行放寬門檻。普通 HOW 自行調整，產品語意、主要技術、部署或重大成本取捨才提具體選項。

### Git

沿用當次明確授權的既有 remote branch。已授權自動 commit／push 的 Goal，在 coherent segment 驗證後提交、推送及核對結果；私人資料、credentials 與生成的驗收資料不進 Git。

保留本機未提交變更；遇到遠端並行修改先 reconcile，不以破壞性 reset、改寫 history 或 force push 解決。Push 暫時失敗可保留 local checkpoint，記錄待推送狀態。

### 額度與停工

主要 milestone 前後記錄實際可取得的 quota snapshot、來源、時間、window、差值、成果及 commit 關聯。只在同一額度窗口計算差值；帳戶總量不冒充單任務精確計費。無法讀值就記 unavailable，不估 token。

正常額度不足時依當次已授權政策處理。本次 Goal 已授權：正式回應確認正常額度耗盡後，才以正式支援介面使用可用重置券；同一邏輯重試沿用 idempotency key，兌換後重讀額度。不能把網路錯誤當耗盡，不購買額度、不因額度不足改用未授權模型或切換 Reserve；依已授權 routing policy 分派子任務與額度不足的 fallback 分開處理。監測僅服務本次 Goal，完成或使用者停止時一併結束。正式工具不可用或零額度後續跑未驗證時如實記錄，不繞過平台限制、不承諾必定自動恢復。

每個工作段持續保存 checkpoint、驗證範圍及 exact next step，使突然失去額度時仍可恢復。Goal 只在完成條件成立時標 complete；阻礙時先推進不受影響工作，真正無法續作才按工具的阻礙規則處理。不自行暫停或以單次回合結束冒充完成。

## 13. Goal Deliverables

交付前方只提供立即可操作的資訊：啟動方式、驗收 workspace、已完成流程、實測結果、已知限制及最後 checkpoint。

Repo 內保留 source、真正需要的 tests、短 architecture／debug map 與 decision log；benchmark 只在實際服務當前產品判斷時保留。需求文件由 Seed 入口路由，方法與架構文件由 Engineering 入口路由；歷史報告仍描述其原始版本，不冒充新行為證據。

匯出／檔案工作需明示實際資料夾、取得檔案方式及 fallback 的時間／資料版本。每個未驗證平台或 GUI 步驟都有清楚狀態，避免使用者在複雜 scratch 路徑自行找成品。

## 14. 成品評估方式

使用者實際操作 → 指出具體摩擦 → 定位責任模組 → 接受下一段改進 → 實作驗證，是持續迭代的主流程。

測試通過與使用者接受分開記錄。Seed 更新只保存產品需求與 WHY；方法更新保存在 Engineering；不改寫歷史測試結果，也不宣稱 App 已經實作新的資料契約。

[返回 Interface](#interfaceplan-先確認方向goal-再完成實作)
