---
version: 1.1.0
updated: 2026-10-05
scope: graspportable-repository-agent-routing
---

## GraspPortable Agent Entry

本檔適用於此 repository，補充本機 Workspace 的目錄與操作指引。搜尋以本 repository 為界；Workspace 外層只讀本次必要設定，不展開其他專案或封存目錄。

### 來源路由

- 接手或恢復：讀 [EXECUTION-STATE](docs/EXECUTION-STATE.md) 的最新 checkpoint 與 Exact next step，核對實際 Git、工作目錄及原 thread Goal 狀態。較舊 active 記錄不取代較新的暫停指示。
- 產品需求：由 [Project Seed](docs/Project_Seed/README.md) 取得現行 WHAT／WHY。
- 方法、計畫與驗證：由 [Engineering](docs/Engineering/README.md) 取得相應來源；只讀本工作段所需內容。
- 工作分派：由 [Model Routing](docs/AgentOps/Model-Routing/README.md) 取得現行政策；能力或設定有變時核對該目錄的 Runtime State。
- 觀測紀錄：自然工作已有可記錄的 routing 事件時，依 [Routing Observations](docs/AgentOps/Routing-Observations/README.md) 追加必要事實。跨案例評估由使用者另行發起的外部 review 承接。

### 分派與執行

在新工作段、scope 明顯改變或實質失敗時，按政策主動評估 delegation；不要求使用者逐次下達使用 subagent 的指令。先看能力適任與 ownership，再看誰已有有效 context，最後比較重載、handoff、整合、必要驗證及人工打斷成本。

具體模型與 effort 以政策為準；[專案 config](.codex/config.toml) 只是機械預設，不是任務授權。首次採用或設定改變後，核對原 session 實際載入的配置與可用 spawn 欄位，不能把檔案已存在當成已生效。從 repository 外啟動的原 thread 依 Runtime State 中的接手步驟處理。

### 操作邊界

- Goal 管理目標；Root 在授權內按自然工作段實作、驗證及接續，不先切成大量微任務或逐包索取批准。讀取或更新策略不會自行恢復已暫停的 Goal。
- Git 寫入依當次授權，先核對分支與並行變更，保留本機未提交成果；提交後核對遠端，不 force push。
- 使用指定測試副本及獨立驗收 workspace，保留原文、durable drafts、版本基底與恢復資料；私人資料、credentials 與大量原始測試輸出不進 Git。
- 同時一個 GUI owner，操作前提醒、結束釋放；原生驗證範圍與使用者接受分開記錄。
- 產品進度與 Exact next step 只在產品工作狀態維護；routing 生效狀態與事件分別寫入 AgentOps 對應目錄。本檔只保存來源路由及操作邊界，保留可追溯的版本與證據。
