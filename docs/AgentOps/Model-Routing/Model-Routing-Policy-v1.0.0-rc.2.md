---
title: GraspPortable — Model Routing Policy
version: 1.0.0-rc.2
updated: 2026-10-05
scope: project-agent-routing-and-handoff
status: trial-policy
supersedes: docs/Engineering/Model-Routing-Policy-v1.0.0-rc.1.md
source_commit: 698d7035c970d04c3a103caa5b0934d68ed75925
---

## 決策目標

以合格成果的品質、資源消耗、完成時間及人工打斷評估分派。包含當下 routing、context 重載、worker 執行、handoff、Root 整合／必要驗證及返工；不同單位分開觀察，不把等待秒數當作模型持續推理費用。

本政策承接既有專案選模授權。產品目標、開發順序、驗收及 Goal 暫停／恢復，仍由產品來源與最新使用者授權管理。

## 三個當下判斷

1. 哪個現有 agent 已掌握仍有效的 context，而且能力與 ownership 適任？短而連續的工作優先延續。
2. 是否有可簡短交代、獨立推進且容易核對的成果？沒有就由當前適任 owner 完成。
3. 計入重載、交接、整合、必要驗證及前台成本後，delegation 是否仍有收益？必要的第二視角可以構成獨立審查收益。

Context Affinity 是當前直接相關且有效的理解，不是已投入的時間。程式、契約、workspace、程序或 GUI 改變時核對受影響部分。當前 owner 已定位且只剩短修正時直接完成；形成大段可獨立工作時，可在自然接縫交接。

## 模型與角色

| 角色 | 指定模型／effort | 工作範圍 |
| --- | --- | --- |
| Root | `gpt-6-astra`／`high` | 意圖、scope、共同契約、routing、整合、UX 與完成判定 |
| Implementation Worker | `gpt-6.1-sol`／`medium` | 已定契約的有界實作及其必要 targeted tests |
| UI Operator | `gpt-6.1-sol`／`medium` | 成功與停止條件明確的原生操作、重現與取證 |
| Evidence Worker | `gpt-6-luna`／`low` | 指定來源、已定義規則的摘錄、manifest、test／log 整理 |
| Specialist | `gpt-6-astra`／`high` | 有明確收益的獨立分析、平行工作或第二視角 |

表中是既有試行配置，不是本次重新比較模型的結論；本機支援與實際選模另外核對。五個角色共用三組主要配置，角色不等於常駐 agent。

Root 由原 thread 實際設定提供。日常 Root＋0–1 worker，確有獨立收益才增加，遵守目前專案及 runtime 上限。Root 與 Specialist 同級，派遣根據獨立分析收益，不是形式上的「升級」。相關續作優先原適任 worker。

Sol 同子系統確有推理缺口，可在 runtime 支援的邊界改用 High；跨層契約、資料安全或判斷歧義交 Root。Luna 遇到規則推導、根因解釋或設計選擇則交回。工作量、檔案數、等待或操作多，先檢查工作與工具安排。Root 的設定改變依使用者／runtime 授權，不由觀測紀錄自動決定。

## 選模、交接與等待

[專案設定](../../../.codex/config.toml) 是未明示覆寫時的 child 預設；不等於目前 session 已載入。啟用與變更時依 [Runtime State](Runtime-State.md) 核對 cwd、trust、profile、role、spawn 能力及實際 metadata。

要求值、快取模型清單、agent 自述與執行 metadata 分開記。完整歷史 fork 或 GUI session 的限制以當前工具為準；無法低成本、安全交接時保留適任 owner。設定可解析、實際選模及產品成功分別確認。

派工提供目標、ownership、必要契約／反例、完成與停止條件。Context 以最小充分為原則；同一修改的實作與必要測試通常交給同一 owner。

回報提供接收者缺少的增量：結果、關鍵 finding／diff、證據定位、預期與實際差異、直接驗證與推論、剩餘風險及下一步。通常一屏；關鍵風險不因字數省略。GUI 另交代版本、workspace、保存／草稿及目前 owner，接手者重新觀察。

Root 審查關鍵 diff、契約與整合接縫是正常工作。若回報不足導致全量重查，先補一次必要證據，仍不足則接回或重新分類。等待時做真正獨立工作，否則使用可用的等待／完成通知；狀態查詢依工具的逾時或異常需要進行。

## Computer Use 與失敗處理

已定成功條件且值得交接的流程可由 Sol 操作。首次探索、高判斷密度狀態、dirty／IME 跨層問題，或 Root 已在現場的短流程，由 Root 延續。Luna 的本版角色是整理已取得的證據。

先備妥 build、樣本與步驟，再依既有授權提醒使用者取得前台。同時一個 GUI owner，其他工作不干擾該程序、workspace 或輸入。遇阻保存觀察、釋放前台再分析；結束交代保存、視窗及程序狀態。

產品驗收依實際證據範圍：headless／API／build 不取代原生反例，原生局部 PASS 不代表整體 UX，使用者接受另記。資料安全與效能門檻沿用產品規格。

工具／權限／程序／artifact 問題先修環境，缺 context 先補給原 owner。首次實質推理失敗重新分類；兩輪無改善就重檢目標、反例與驗證方法。根因及契約固定後，大段實作可以交 Sol；短收尾維持原 owner。這是當下交付與安全判斷，不是跨案例政策評估。

## 與觀測的責任分工

原開發 thread 正常推進已授權且 active 的產品 Goal，在自然分派或重要交接後，依 [觀測契約](../Routing-Observations/README.md) 摘記已有事實及簡單分類。正常工程的修正、驗收及必要升級仍由 Root 負責。

產品工作由目前需求、風險與 Exact next step 決定。Sol 實作、Sol UI 與 Luna 整理是事件類別；沒有合適事件就沒有該類樣本，產品照常推進。工作顆粒度由工程成果與 ownership 決定。

跨案例的效果比較、模型取捨及政策修訂由使用者發起的外部 review 承接。外部 review 從獨立觀測紀錄讀取必要證據，提出建議；取得授權後才更新本政策或設定。政策尚未變更前，Root 沿現行政策執行。
