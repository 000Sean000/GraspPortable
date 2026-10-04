---
title: GraspPortable — 模型路由入口
version: 1.0.0
updated: 2026-10-05
scope: model-routing-source-selection
---

## 現行來源

[Model Routing Policy rc.2](Model-Routing-Policy-v1.0.0-rc.2.md) 是本專案現行選模與交接政策；[專案設定](../../../.codex/config.toml) 提供 child 的機械預設。兩者用途不同，實際生效以 runtime 核對為準。

[Runtime State](Runtime-State.md) 只保存本機設定載入、工具支援與 child 實際選模的核對狀態。

## 按需讀取

開始執行本專案工作或政策改變時讀現行政策；同一工作沿用仍有效版本。首次啟用、session／設定或工具能力改變時，才重核相關 Runtime State。

需要記錄一次自然工作中的路由事件時，使用 [觀測契約](../Routing-Observations/README.md)；歷史觀測由外部 review 按需讀取，並非 Root 每段工作的前置材料。

產品進度、優先序與完成條件由產品文件及原 thread 管理。此入口只選取 Agent 執行政策，不建立產品待辦。
