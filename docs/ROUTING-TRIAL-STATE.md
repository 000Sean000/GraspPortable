---
title: GraspPortable — Routing Trial State
version: 1.0.0
updated: 2026-10-04
scope: routing-deployment-readiness-and-observations
status: pending-local-readiness
---

## 現在的停點

已依使用者要求將 [Routing Policy](Engineering/Model-Routing-Policy-v1.0.0-rc.1.md)、repository `AGENTS.md` 與專案子模型預設納入同一提交。這是 repo 設定交付，不代表使用者 PC 已同步、原 Codex thread 已載入、child 已按指定模型執行，或 Goal 已恢復。

核對的產品基線為 `f634bcd9b650d89f57ff0d866a086612e7e2fc2e`，工作狀態 1.33.0。最新記錄是使用者要求收工暫停；S4 未完成。產品權威仍是 [EXECUTION-STATE](EXECUTION-STATE.md) 的最新 checkpoint／Exact next step；本文不重寫其草稿、驗收或程序狀態。

| 項目 | 本次狀態 |
| --- | --- |
| 策略／config 入庫 | 由包含本檔的 Git commit 查核 |
| 使用者 PC 同步／衝突核對 | 未執行 |
| 原 thread 載入／effective config | 未驗證 |
| Child 實際 model／effort | 未驗證 |
| Sol 實作／UI、Luna 工作觀察 | 尚未開始 |
| Root Medium 比較 | 尚未開始；Root baseline 保持 Astra High |
| 原 Goal 恢復 | 本次未操作；等待使用者明確恢復 |

以上分開表示 repo 部署、本機生效及實測結果，不能互相代替。

## 本機接手：先保持 Goal 暫停

1. 在原開發 thread 核對實際 Workspace／repository、branch、HEAD、未提交／未追蹤檔案與 active agents。Fetch `origin/rewrite/dotnet` 後先看差異；乾淨且可 fast-forward 才更新。有本機在製成果、同名未追蹤 `AGENTS.md`／config 或分歧時保留並 reconcile，不以 reset、覆蓋或丟棄處理。
2. 保留原 thread 及 repo 外的 Workspace `AGENTS.md`。讀 `GraspPortable/AGENTS.md`、現行 Routing Policy 與本檔；核對父層指引。如父層仍寫子模型沿用，指出本次已授權的 project routing 取代該專案選模預設，其餘工作目錄／操作邊界保持。較高優先的管理限制仍須遵守。
3. 讀原 session 的實際 cwd、effective config 與可用工具。現有文件記載 cwd 是 repository 上一層的 Workspace；下層 `.codex/config.toml` 不保證會被該 session 載入，shell 命令加 `cd` 也不能證明 session 配置已改變。
4. 若原 session 可用 explicit model／effort spawn，直接按政策明示選模，保留原工作上下文；不要為了讓 config 自動發現就新開空白 thread。記錄 project default 是否載入、自訂 role 是否覆寫及可用限制。若需 reload，保存 checkpoint 後用平台支援方式恢復同一 thread；實際確認前不宣稱生效。
5. 此步只做本機接手與唯讀配置核對。回報可用路徑與缺口後保持 Goal 暫停，直到使用者明確恢復；不為驗證設定先啟動 GUI 或付費 child。

## 恢復 Goal 後的試行

先依 Exact next step 保留既有草稿與驗收資料，釐清 Records query 的首次／暖機來源，再按既有優先序處理 IME、縮放／凍結區焦點及足量代表操作。不要為了「先測 Sol coding」跳過這些工作或發明修改。

首次合適的真實委派，同時驗證設定生效：使用明確的 model／effort，核對 child 實際執行 metadata。只有要求值或快取清單時標為未驗證；意外使用不同模型時先停止該試行並核對原因，不累積失真的比較資料。這不是要求另建 benchmark 或額外同題重跑。

工作選擇：Root 可先直接釐清量測語意；契約固定且需要有界修正時才交 Sol 實作。尚未完成 Sol UI 生效及操作核對前，敏感／探索式流程保留 Root；Luna 只在自然出現且核對便宜的機械整理工作試用。沒有合適工作，該候選維持未驗證，Goal 仍可由適任 owner 繼續。

首個新角色使用時在普通進度回報說明 task／owner／理由，不另設逐包批准流程。必要使用者決策、前台提醒、資料安全或工具權限仍依既有邊界處理。

## 最小觀察

每個具 routing 意義的工作段只留一筆，沿既有 coherent checkpoint 更新本節：

```text
task／commit 或證據定位：
要求配置 → 實際配置及來源：
起始 affinity／context 補充量：低／中／高；一句話。
執行／工具等待／前台占用：可取得才記，無值則未量測。
handoff／Root 必要核對：低／中／高；返工及人工介入次數。
結果與決定：合格／部分／受阻；維持有限試行／接回／重新分類。
```

尚無觀察。產品驗證 PASS 與 routing 有收益分開判斷；正常整合驗證不算無效重做。帳戶共享百分比不能當成單任務費用；少量自然案例只支持有限試行，不宣稱最優或全面等效。

在既有 Goal checkpoint 根據實際證據決定同類工作是否繼續試行；出現錯誤驗收、關鍵契約漏判或反覆重做時停止該角色擴用並交 Root。Root Medium 比較要等 worker 分工穩定且使用者另選擇，不能在同批同時變動 Root。
