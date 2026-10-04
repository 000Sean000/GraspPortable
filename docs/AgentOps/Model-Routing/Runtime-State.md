---
title: GraspPortable — Routing Runtime State
version: 2.0.0
updated: 2026-10-05
scope: routing-deployment-and-effective-configuration-only
status: statically-reconciled-runtime-unverified
source_commit: 698d7035c970d04c3a103caa5b0934d68ed75925
---

## 記錄範圍

只保存模型路由文件、專案設定、本機載入與執行 metadata 的核對狀態。事件資料在 [Observations](../Routing-Observations/Observations.md)，產品停點由產品工作狀態維護。

本檔承接原 [Routing Trial State 的部署紀錄](https://github.com/000Sean000/GraspPortable/blob/698d7035c970d04c3a103caa5b0934d68ed75925/docs/ROUTING-TRIAL-STATE.md)。舊 state 記載本機同步、effective config 與 child metadata 均未驗證，沒有真實 routing 事件；下表保留未知項目並加入 2026-10-05 本機靜態核對，沒有把舊試行順序轉成產品待辦。

## 生效核對

| 項目 | 目前可支持的狀態 | 更新依據 |
| --- | --- | --- |
| 第一版 repo 配置 | 來源 commit 已有 Astra／Sol／Luna policy 及 child defaults | 本檔 source_commit |
| 本次目錄遷移／連結 | 五份 AgentOps 文件與新現行工程入口已建立；靜態核對結果見下節 | 包含本檔的遷移 commit 與 changed paths |
| 使用者 PC 同步與未提交內容 | 起始 HEAD f634bcd，index／工作目錄／非忽略 untracked 均乾淨；fetch 後 fast-forward 至 source_commit | 本機 Git status、fetch、merge --ff-only；未 reset 或套 v1 patch |
| 專案 TOML 有效值 | 解析成功，與來源及候選完全相同；只改版本、日期及 state 路徑註解 | Python tomllib，四個 agents 設定值 |
| 原 thread effective config | 仍未驗證；cwd 為 repository 父 Workspace，shell 工作目錄不等於 session reload | 本回合 environment context；沒有取得原 session 的 effective-config metadata |
| 本機設定／trust／role | user config 靜態值為 Astra High；未見匹配 Workspace／repository／祖先的 projects trust entry 或 agents role table；是否有平台／profile／session 覆寫未知 | 唯讀解析本機 config，只記相關欄位，未變更全域設定 |
| 工具可要求的 child 配置 | 本回合 spawn schema 提供 model／reasoning_effort；full-history fork 不接受 override，需 none 或有限 turns | 本回合實際工具宣告；這是要求能力，不是 child 執行證據 |
| 實際 Root／child model／effort | 原 session 實際選模未取得權威 metadata；本次未派 child，仍未驗證 | 原 thread UI／runtime metadata 留待可取得時核對；不以 user config 代替 |

表中部署、生效與實際選模分別記錄；任一項成功不替其他項目作證。

## 本機接手

確認原 thread、repo、branch、未提交／未追蹤內容與上層指令。原 session 若從 repository 的父 Workspace 啟動，先核對實際設定來源；shell 的 `cd` 不是 session 配置已重載的證據。

原 session 支援 explicit model／effort 時，可按已授權政策明示選模，保留原工作 context。需要重載時，使用本機支援方式恢復同一 thread；載入與模型可用性未確認時如實保留缺口。

本次套用只做文件、設定、連結與可取得的唯讀 runtime 核對。產品 Goal 暫停／恢復不由本檔改寫。第一次自然委派後才追加實際 child metadata 的核對結果；付費 smoke worker 不屬本次套用驗證。

## 最近核對

2026-10-05 由原 thread 的目前 Root 直接遷移。附件 SHA256SUMS 的 13 個檔案 hash 全部相符，manifest 的八個來源 Git blobs 與已同步基底完全相符。舊 state 沒有事件可移轉，Observations 保持空紀錄；原始部署未知狀態及不可變來源連結保留。

專案設定有效值維持 `enabled = true`、`default_subagent_model = "gpt-6.1-sol"`、`default_subagent_reasoning_effort = "medium"`、`max_concurrent_threads_per_session = 2`。本機 CLI 回報 `codex-cli 0.160.0`，僅讀版本與 help；這不證明四個 keys 已被原 thread 載入或通過該 runtime 的 schema 驗證。Workspace 根目錄無 `.codex/config.toml`，上層 AGENTS 保留原文。

靜態驗證檢查新連結、唯一現行入口、版本／supersedes、有效 TOML 值、產品文件與停點保全，詳見該遷移 commit 的差異。沒有啟動 App、Computer Use、付費 worker、模型效果實驗，也沒有修改產品 Goal。實際 project trust、profile／role 覆寫、runtime keys 支援、原 session 生效及 child 選模仍是未確認項目；下一次已授權產品工作自然委派時再核對，不為補證據另製任務。
