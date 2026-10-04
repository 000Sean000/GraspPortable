---
title: GraspPortable — Model Routing Trial Policy
version: 1.0.0-rc.1
updated: 2026-10-04
status: trial-policy
scope: project-agent-selection-delegation-and-handoff
---

## 目的與適用範圍

依已審閱的 Model Routing Strategy v2，將少量分派規則用於 GraspPortable 的正常開發。v2 是對話草案修訂序號；本檔是首次納入 repository 的版本化執行政策。這組配置尚未證明最優，部署、生效與實測進度分別記在 [Routing Trial State](../ROUTING-TRIAL-STATE.md)。

產品目標與開發暫停／恢復由 [EXECUTION-STATE](../EXECUTION-STATE.md) 的最新 checkpoint 及原 thread 實際狀態管理。本政策不建立另一個 Goal，也不將策略部署當成開發恢復。

## 決策規則

以一項合格成果比較三件事：總資源消耗、端到端完成時間、人工打斷。涵蓋 routing、context 重載、worker 執行、handoff、Root 整合／必要驗證與返工；等待時間和 token／額度分開記，不把不同單位直接相加。

每個自然工作段只判斷：

1. 哪個現有 agent 已掌握有效 context，而且能力與 ownership 適任？短而連續的工作優先延續。
2. 是否有可簡短交代、獨立推進且容易核對的成果？沒有就由當前 owner 完成。
3. 加上重載、交接、整合及驗證後，delegation 是否仍有收益？必要的獨立風險審查可因第二視角而成立。

Context Affinity（上下文親近度）是當前仍有效且直接相關的理解，不是已花的時間。版本、檔案、程序或 GUI 改變時只重核受影響部分；接手者重新觀察焦點與畫面。高 affinity 不阻止把大段獨立後續工作交出，也不排斥有證據支持的獨立審查。

## 模型與角色

| 角色 | 模型 | Effort | 適用範圍 |
| --- | --- | --- | --- |
| Root | `gpt-6-astra` | `high` | 意圖、契約、routing、整合、UX 及完成判定 |
| Implementation Worker | `gpt-6.1-sol` | `medium` | 已定契約的有界 coding 與 targeted tests |
| UI Operator | `gpt-6.1-sol` | `medium` | 已定流程、原生操作、重現及取證 |
| Evidence Worker | `gpt-6-luna` | `low` | 明確規則的摘錄、manifest、測試／log 整理 |
| Specialist | `gpt-6-astra` | `high` | 有界獨立分析、平行工作或必要第二視角 |

五個角色共用三組主要配置，不是五個常駐 agents。模型名稱是指定的試行配置；帳戶與 runtime 是否支援仍由當次工具核對。Astra Medium Root 留待後續單獨驗證，不是本政策預設。

Root 由原 thread 的模型設定提供，不能靠自然語言假裝已切換。Sol 同子系統確有推理缺口時可在支援的工作段邊界改為 `high`；跨層契約、資料安全或判斷歧義交 Root。Luna 需要推導規則、解釋根因或選擇修法時交回。Root 與 Specialist 同級，沒有獨立收益就由 Root 直接分析。

預設 Root＋0–1 worker；確有獨立收益才增加第二個。專案 config 上限為兩個同時開啟的 spawned threads，不含 Root，並服從更低的 runtime 限制。Worker 的拆分需求交 Root；相關工作優先延續適任的原 worker。

## 選模與配置生效

[.codex/config.toml](../../.codex/config.toml) 設定未明示 override 的子模型為 Sol Medium；它不覆寫 Root、權限、sandbox、provider、登入或付費政策。Explicit spawn 值及自訂 role 仍可能覆寫預設，因此預設值不是支出保證。

首次採用、重新載入或配置變動後，先查原 session 的有效設定、自訂 role 與實際 spawn 支援範圍。試行時明示 model／effort，並核對實際 child 的執行 metadata；不能把 agent 自述、要求值或模型快取清單當成實際執行證據。缺少執行證據就記未驗證，不宣稱已節省額度。

使用最小充分任務 context。工具若將 full-history fork 與 model override 設為不相容，就改用支援的短任務包，或由原 owner 完成；不為複製歷史而默默回到昂貴父模型。模型或工具不支援時回報具體差異，由 Root 在既有授權內選適任路徑，不能虛構已套用指定 tier。

## Handoff 與驗證

派工說清目標、ownership、契約／反例、完成判準、範圍與停止條件。Worker 原則上負責同一修改的實作及必要 targeted tests，不為形式把 coding／testing 拆成不同 agents。

回報只傳接收者缺少的增量資訊，通常一屏：

```text
結果：完成／部分完成／受阻；一句話。
變更／finding：3–5 項以內。
證據：file:symbol/line、命令與結果；GUI 加版本、workspace、流程。
差異與可信範圍：預期 vs 實際；直接驗證 vs 推論。
未驗證／風險及下一步：含必要的差異、版本與 GUI／程序 owner。
```

短格式不截斷關鍵風險；完整 log 留在既有適當證據位置。Root 審查關鍵 diff、契約與跨模組接縫是必要整合，不等於重做；若回報不足導致全量重查同一問題，先補一次精簡證據，仍不足就接回或重新分類。

等待 worker 時使用可用的等待／完成通知機制，或處理真正獨立工作；不以頻繁查詢狀態替代等待。單純工具等待不等於 Root 持續生成 token，實際推理與工具時間分別觀察。

## Computer Use

已定成功條件的原生操作可由 Sol 執行並判斷該條件；首次 UX 探索、高風險 dirty／IME 狀態、跨層診斷與整體完成判斷由 Root 處理。Root 已在現場且只剩短流程就延續；流程固定且有足夠工作才交接，不因是 Computer Use 就固定換 agent。

操作前備妥 build、樣本與步驟，先提醒使用者；同時一個 GUI owner。其他 agent 不干擾驗收程序、測試 workspace 或前台 input。遇阻先保存觀察並釋放前台，再背景分析；結束交代保存、視窗及程序狀態。操作段依實際流程決定，以減少前台占用與來回接管為目標。

Headless／API／build PASS 只支持其實測邊界，不能取代 Windows 原生反例、輸入法或焦點驗證。原生局部 PASS 不能擴張為整體 UX；使用者接受另記。保留現有主驗收資料及草稿，模型比較使用可逆且適當隔離的材料。

## 升級與停損

工具、權限、程序或 artifact 問題先修環境；缺 context 先補給原 owner。第一次實質推理失敗即重新分類，兩輪無改善就重檢目標、反例與驗證方法，不讓低階 worker 反覆猜測。

工作量、檔案數、等待或 tool calls 多不單獨觸發升級；`xhigh`／`max`／`ultra` 不作日常預設。根因與契約固定後，大段有界實作可回 Sol；短續作由原 owner 完成，避免為降級付出新交接成本。額度耗盡依當次既有政策處理，不藉此切換未授權模型或 Reserve。

## Goal 與自然試行

Goal 繼續管理已接受的產品成果；Root 動態選下一個自然工作段，完成必要驗證再接續，不要求使用者逐包批准。產品風險與 Exact next step 優先於模型試驗順序；沒有合適工作就保留候選，不為測模型製造修改或阻擋產品續作。

固定 Astra High Root，先觀察 Sol 實作，再觀察已知 UI 流程與 Luna 整理，最後才在使用者選擇下比較 Root Medium。試行準備、目前階段與極簡觀察留在 Routing Trial State，不把進度寫入本政策。

## 官方配置依據

2026-10-04 核對：[Config Basics](https://learn.chatgpt.com/docs/config-file/config-basic)、[Config Reference](https://learn.chatgpt.com/docs/config-file/config-reference)、[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。專案 config 依原 session 工作目錄與 trust 載入；一般設定不能代替本機有效設定與 child 執行核對。
