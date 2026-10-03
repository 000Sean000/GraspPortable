---
title: GraspPortable — Architecture Model Decision
version: 1.0.2
updated: 2026-10-03
status: selected-under-delegated-architecture-authority
scope: product-adapted-explicit-architecture
supersedes: Architecture-Model-v1.0.1.md
---

## 決定與目的

採用 Explicit Architecture，以功能模組組織應用核心，模組內區分 Application、Domain 與 Adapters；核心透過自有 Ports 連接外部技術。目的是讓產品責任、變更影響與問題位置可直接查明，同時保留高互動與跨平台所需的實作空間。

使用者於 2026-10-03 授權：若無必須由使用者裁定的問題，直接將模型調整為適合本產品的方案。本文件記錄此授權下的工程決定；不表示具體實作、性能或使用者操作驗收已完成。

[產品架構](../GraspPortable-Architecture-v1.0.0-rc.3.md) 描述功能配置及執行設計；[技術選擇](Technology-Selection-v1.1.2.md) 記錄實際 stack；[方法指引](../graspportable-architecture-planning-guide-v1.0.0-rc.8.md) 維持通用規劃方法。

本專案使用 [自己的架構圖](../GraspPortable-Architecture-Diagrams-v1.1.0.md) 表達下列取捨；原文圖保留作概念來源。

## 相對原模型的取捨

| 面向 | 本產品採用方式 | 原因 |
| --- | --- | --- |
| 功能 Component | 以功能與資料責任劃分，內部按需分層 | 能按功能找到完整責任，避免全產品只有橫向資料夾 |
| Ports／Adapters | 核心決定契約，外部工具實作或呼叫契約 | 編輯器、DB、平台及傳輸可替換 |
| 模組解耦強度 | 允許明示、無循環的公開契約依賴 | 高頻且需立即結果的協作保留直接呼叫；不強制所有模組經事件轉接 |
| 一致性 | 共享修改由明確 use case 協調單一提交 | 定義、依賴結果與持久引用快取不靠多模組事件逐步補齊 |
| CQRS | 修改 use case 與查詢投影分工，按用途選模型 | 讀取可最佳化，仍共用本機資料權威 |
| 事件 | 已提交結果的通知與可恢復後續工作 | 事件不承擔核心共享修改的原子性；通知遺失可依版本補讀 |
| Shared Kernel | 最小穩定 ID、版本及必要共用值契約 | 各模組保留自己的規則；共享型別更改有明確影響範圍 |
| 部署 | 核心模組共同部署；Windows UI 與本機後端分程序 | 邏輯模組邊界與程序邊界分開，控制 UI 受背景工作影響 |
| 執行品質 | 明確排程、有限佇列、取消、過期結果拒絕與分批 I/O | 補足責任分層本身未提供的即時互動能力 |

表內是本專案採用的強度與配置。Command／Query Bus、Event Sourcing、外部 message broker、service discovery 目前不納入基準，日後依具體需求另外評估。

## 選擇後仍需遵守的界線

- UI／HTTP／資料庫型別停在相應 adapter；Domain 不引用這些框架。
- 直接呼叫僅限公開契約。其他模組的內部 entity、私有資料表及可變狀態保持由 owner 管理。
- 事件與共享契約仍形成依賴。變更契約要追蹤消費者，不能以間接呼叫宣稱沒有耦合。
- 功能模組不必逐一成為 project、程序或服務；拆分依可替換性、依賴與執行需求決定。
- 替換 storage 或 editor 仍可能有語義、資料遷移或 UX 成本，接面隔離不代表零成本替換。

## 決策與未定事項

本次採用模型與責任安排所需的決策已具備，沒有需要使用者先補充的阻擋項。S1 語法及暫定效能尺度已接受；fallback 可接受落後窗口及跨裝置衝突行為，留在後期對應產品決策；不在本次以工程假設補成產品規則。它們可能影響局部設計，若牽動資料語义或已承諾品質，提出具體案例再裁定。

## 依據

- [Herberto Graça：Explicit Architecture](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/)：採用其功能組織、核心與 adapters 概念；模組完全解耦的強度依上述表格調整。
- [More than concentric layers](https://herbertograca.com/2018/07/07/more-than-concentric-layers/)：共享部分需明確且保持內聚。
- [Martin Fowler：CQRS](https://martinfowler.com/bliki/CQRS.html)：讀寫模型可共用 DB，依適用範圍取捨複雜度。
- [產品 Seed](../../Project_Seed/README.md)、[Prototype insight](../../Reference/README.md) 及本輪使用者明確決策。
