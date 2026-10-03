---
title: "GraspPortable — 軟體架構與模組開發指令"
version: 1.0.0-rc.6
updated: 2026-10-03
audience: coding-agent
scope: architecture-planning-and-module-development
supersedes: graspportable-architecture-planning-guide-v1.0.0-rc.5.md
---

## 執行目標

將 GraspPortable 組織成責任、資料歸屬、公開接面與依賴可直接查明的模組。優先完成重要主幹及其必要驗證；非主幹可保持 `WAITING_FOR_IMPLEMENTATION`，且不妨礙已承諾的主幹流程。

讓不依賴指定本機或裝置的工作能在 Cloud 接續。為每個模組維護 Importance、Status、Environment、Agent 四個獨立維度，分別安排開發順序、實作狀態、執行環境與 agent 能力。

維持已接受的產品語義與替換邊界。長程工作開始前集中確認重大決策；交棒後自主選擇實作方法、適時委派、做足以保護當次成果的必要驗證，並留下可跨 thread 與環境接續的 repo 工作狀態。

本文件描述整體架構規劃方法。實際技術選擇由 [Engineering 入口](README.md) 連至獨立決策；已接受的具体模組與實作映射由後續架構文件承載。

## 架構責任與邊界

### 按產品能力劃分模組

先依業務能力與 use case 劃分 Module／Component，再安排模組內部的技術層次。一個業務模組可跨越 Application、Domain 與 Adapters；技術分層與業務模組分別表達不同責任。

為每個模組定義功能責任、持有資料、公開契約與依賴，並提供 source／tests 入口。讓程式碼可按模組定位；檔案因平台或技術層分散時，維護清楚的實作映射。

將 use case 編排放在 Application Layer，將領域規則放在 Domain Model／Domain Services。核心使用 Grasp 自有的 identity、command、snapshot、result 等資料契約。

### 以 Ports／Adapters 隔離外部實作

將 Port 定義在 Application Core。由 Driving Adapter 將外部操作轉成核心 use case；由 Driven Adapter 實作核心所需的 Port，連接儲存、檔案及其他外部工具。

保持原始碼依賴朝向內部。執行流程需要呼叫外部工具時，核心仍依賴自己的 Port；編輯器套件、儲存引擎、OS 等具體型別與操作留在相應 adapter。

按實際需求選用直接呼叫、Command／Query Bus 等配置。依必要責任決定結構與實作規模，按已接受的重寫或維護範圍建立接面，處理實際的耦合與替換障礙。

### 明確管理跨模組協作

由資料 owner 負責修改其資料，其他模組透過明示的查詢或操作契約協作。

採公開接面直接協作時，記錄實際依賴；interface 依賴仍屬模組間依賴。若已接受的契約要求 Component 完全解耦，進一步移除跨 Component 的直接型別與 interface 依賴，採事件及最小 Shared Kernel 協作。依可替換性、停用需求與維護成本決定所需程度。

維持既定資料含義、共享修改原子性與持久化契約。協作方式若會改變這些語義，先處理相應的重大決策。

### 自主選擇模組內部方法

依問題評估 OOP／FP 的互補：解析、計算、驗證與計畫等轉換可採純函式；生命週期、資源與可變狀態可採具封裝邊界的物件。將其視為方法選項，依實際品質選擇 class、function 與內部分工。

## 模組四維與紀錄

在既有 repo 模組紀錄中維護下列欄位。前兩項管理產品順序與實作狀態，後兩項安排執行環境與推理能力；四維是規劃與派工資訊，不是架構分層。

| 維度 | 使用值 | 判定與使用 |
| --- | --- | --- |
| Importance | `Trunk`／`Non-trunk` | 依產品目標、使用價值與必要依賴判定。優先完成 Trunk；架構內層不自動等於 Trunk，關鍵 adapter 也可屬於 Trunk。 |
| Status | `WAITING_FOR_IMPLEMENTATION`／`IN_PROGRESS`／`Implemented`；其他中間狀態沿用 repo 慣例 | 按實際實作進度更新。`Implemented` 表示已有實作；測試結果與 Human 驗收另行記錄。 |
| Environment | `Cloud-capable`／`Local-required` | 依必要 source、工具、測試資料與環境存取判定。需要指定本機、裝置或現場環境時標為 Local-required，並說明具體依賴。Cloud-capable 工作也可在 Local 執行。 |
| Agent | `High-capability`／`Lower-capability suitable` | 依未定語意、跨模組影響、推理與驗證難度判定。產品重要度、程式行數與 Cloud／Local 不直接決定 agent 能力需求。 |

將 Environment 與 Agent 記為模組的預設需求；局部工作有差異時，在該工作註明。核心邏輯可於 Cloud 開發、指定 Windows 行為需要 Local 驗證時，分開安排，保留 Cloud 可持續推進的範圍。

除四維外，每個模組保留名稱、功能責任、持有資料、公開接面、依賴與 source／tests 入口。詳細設計隨實作需要展開。

## 開發順序與決策權

### 先完成主幹及必要依賴

優先完成已選主幹的實作與必要整合驗證。未排入當前工作的非主幹模組保持 `WAITING_FOR_IMPLEMENTATION`，保留目的、預期接面、依賴與驗收要求。

讓可選模組未接入時，已完成主幹仍能執行已承諾的流程。若主幹的必要行為依賴未實作模組，將必要部分納入本次工作，或重新劃分責任。測試替身可隔離接面；真實模組接入後仍須完成整合測試。

### 在 Preflight 集中處理重大決策

新的長程自主工作段或重大階段轉換前，使用 Execution Preflight 恢復有效決策，確認本次成果、主幹範圍、驗收要求與自主權。自行查明可取得的事實，沿用仍有效的決策與授權。

由 Human 掌握 intent、資料語義、重要責任邊界與重大取捨；普通 HOW 由執行 agent 決定。將 Human insight 作為需評估的設計輸入；明確的 Decision／Constraint 才形成方法限制。

交棒後持續研究、實作、除錯與處理可逆選擇。只有新資訊造成重大影響、涉及 Human 保留的判斷，且既有決策與授權不足以裁決時，才暫停受影響部分並提出必要決策；其他獨立且已授權的工作繼續。

## Coding 工作流程

### 1. 恢復當前工作

讀取 `docs/Project_Seed/README.md` 路由的現行產品需求，以及 `docs/Engineering/README.md` 路由的開發方法、已接受的 Plan、適用的 repo instructions，以及 `docs/EXECUTION-STATE.md`。依任務需要讀取 `ARCHITECTURE.md`、`docs/DECISIONS.md` 與相關 source／tests，核對基底、有效決策及在製變更。

形成足以支援當次 Goal 的模組邊界、責任摘要與四維分類，再進入相應工作。

### 2. 實作與派工

以完整、可驗證的成果安排工作段，允許涵蓋必要的多個檔案與模組。按 Importance 排序，再依 Environment 選擇可執行環境，依 Agent 安排推理能力。

由高階 coordinator 負責架構、重大模糊問題、跨模組整合與最終整合判斷。Cloud 與 Local 均適時將邊界清楚、可獨立驗證的低判斷密度工作交給低階 subagent；由 coordinator 衡量分派與整合成本，並核對結果。

### 3. 驗證與整合

驗證服務產品決策與交付，不自行成為新的開發主線。先依本次變更的 contract、資料風險與使用者可感知結果決定最小充分驗證，再依已授權範圍安排 build／tests／操作流程。

只有實際改到相應邊界時才擴大到接面、整合、端到端或平台測試；benchmark／profiling 只有在性能是本次驗收目標，或其結果會改變架構／實作決策時才執行。不得僅因「工程上通常應該測」就建立新的大型 harness、重複 trial 或完整 evidence pipeline。

分開記錄實作完成、必要驗證結果與 Human 驗收。環境不足時只保留真正影響交付的缺口；測試替身、headless、API 或 benchmark 結果只代表其實際覆蓋範圍。

### 4. 保存與跨環境接續

在 repo 保存基底版本、工作範圍、變更、測試結果、未完成事項與下一步。換 thread 或環境前留下可恢復狀態；接手後核對版本與契約變動，再沿原工作繼續。

由開發方法承載協作流程，由 `ARCHITECTURE.md` 承載已接受的模組邊界與實作映射，由模組／工作紀錄承載四維實際值與進度。讓 `AGENTS.md` 等入口以短指引路由至對應文件。Planning Bridge 保存規劃決策，development working state 留在 repo。

在當次授權範圍內完成修改與提交，維持文件、公開契約、程式及測試的一致性。
