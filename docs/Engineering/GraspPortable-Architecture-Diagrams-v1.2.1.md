---
title: GraspPortable — Architecture Diagrams
version: 1.2.1
updated: 2026-10-05
status: accepted-design-diagrams
scope: code-runtime-markdown-recovery-and-records
supersedes: GraspPortable-Architecture-Diagrams-v1.2.0.md
---

## 圖解用途

對應 [Architecture rc.6](GraspPortable-Architecture-v1.0.0-rc.6.md)、[Plan rc.11](Implementation-Plan-v1.0.0-rc.11.md) 與 [模型決策](Decisions/Architecture-Model-v1.1.1.md)。圖是接受的設計，不是完成證據；動態進度見 [EXECUTION-STATE](../EXECUTION-STATE.md)。Markdown 為已保存原文，SQLite 兼管投影、版本基底及不可丟棄的草稿／journal。

## 1. 四個 Projects 的編譯依賴

箭頭指向被依賴者。App 不引用 Core／Host、不直接開 SQLite。

```mermaid
flowchart LR
    APP["App<br/>MAUI／Razor／CodeMirror<br/>Views／Client／Platform"]
    HOST["Host<br/>API／DI／Jobs<br/>SQLite／Filesystem adapters"]
    CORE["Core<br/>Use cases／Domain／Ports<br/>Syntax／Graph／Records codec"]
    DTO["Contracts<br/>Commands／Queries／Results"]
    APP --> DTO
    HOST --> DTO
    HOST --> CORE
```

## 2. 模組與 ports

箭頭表示 source dependency。同 project 模組仍以公開契約及無循環依賴分工；沒有一模組一程序。

```mermaid
flowchart TD
    API["Host endpoints"] --> K["Knowledge<br/>Identity／Notes／Records／Change rules"]
    API --> Q["Query／Views"]
    API --> X["Exchange／Recovery"]
    Q -->|"public read contracts"| K
    X -->|"public change contracts"| K
    K --> V["ValueEngine<br/>Context／Codec／Graph／Evaluate"]
    K --> P["Persistence／Document ports"]
    X --> P
    SQL["Host SQLite adapter"] -->|"implements"| P
    FS["Host Filesystem adapter"] -->|"implements"| P
```

Authoring 管 durable draft、Workspace 管設定及生命週期，由 Host 組裝。ValueEngine 僅計算輸入快照；adapter／UI 型別不進入 Core。

## 3. Windows 執行配置

箭頭表示執行資料流。Markdown／附件是正常工作資料；backup 是獨立完整 generation，非第一次可讀輸出。

```mermaid
flowchart TD
    subgraph APP["App 程序"]
        E["CodeMirror<br/>文字／IME／Undo"] <--> R["Razor／ViewModel<br/>Note／Table／Card"]
        R <--> C[".NET Client<br/>Credential／Receipts"]
    end
    subgraph HOST["獨立 Host 程序"]
        API["Loopback JSON／SSE"] <--> K["Core use cases／Query"]
        K <--> W["最多兩個 prepare workers"]
        K --> J["單一提交協調／Journal"]
        J <--> D[("SQLite<br/>投影／基底／草稿／Receipts")]
        J <--> F["Markdown／附件"]
        OBS["Watcher／Reconcile"] --> K
        F --> OBS
        B["Checkpoint／Restore"] --> D
        B --> F
        B --> GEN["完整 backup generations"]
    end
    C <--> API
    O["Obsidian／其他編輯器"] <--> F
```

App 管 Host 啟停；啟動 reconciliation，正常關閉 flush／追蹤操作／補 checkpoint，再結束 Host。前台輸入不等 HTTP，credential 不交給 JS。Writer 鎖限制 Grasp Host，不阻止其他編輯器，因此仍核對外部 hash。

## 4. 共享更新與跨檔恢復

```mermaid
sequenceDiagram
    participant U as App 或外部檔案變動
    participant K as Knowledge／Reconcile
    participant V as ValueEngine
    participant D as SQLite journal／投影
    participant F as Markdown files
    U->>K: 最新原文／來源版本／operation ID
    K->>K: 保存草稿或確認外部原文，核對共同基底
    K->>V: 固定 source／policy snapshot 準備
    V-->>K: 補丁／相依結果／診斷
    alt 語法未完整或衝突
        K-->>U: 保留新原文，標過期／衝突，不發布部分 definitions
    else 可接受
        K->>D: 短交易保存 intent／guards／恢復材料
        loop 各受影響檔案
            K->>F: 核對 hash，再套用對應補丁
            F-->>K: 已寫入 hash 或第三方衝突
            K->>D: 記錄已完成／待處理狀態
        end
        K->>D: 短交易保存語意投影／receipt
        K-->>U: Revision／受影響 IDs／完整或待恢復狀態
    end
```

多檔不承諾 ACID。中斷後用 journal、來源 hash 與 receipt 判斷續作；第三方新版本不覆寫。原文保存、語意接受及全部回寫完成分開顯示。回覆遺失查同 operation receipt；取消不撤銷已接受結果。UI 補讀後局部更新，保留 dirty／IME。

## 5. Records 的單一來源與多種呈現

```mermaid
flowchart LR
    MD["縱向 Markdown<br/>H2／H3／H4 或 nested list<br/>欄位唯一正文"]
    META["YAML frontmatter<br/>IDs／Schema／定位"]
    CODEC["Records codec<br/>UTF-16 ranges／型別／關聯"]
    DEF["Generated definitions<br/>RecordKey.FieldKey"]
    ENGINE["同一 ValueEngine<br/>Computed Markdown"]
    VIEW["Query／Views<br/>分頁／排序／篩選"]
    TABLE["Table<br/>凍結行列／長文摘要"]
    CARD["完整角色卡／cell editor"]
    MD --> CODEC
    META --> CODEC
    CODEC --> DEF --> ENGINE
    CODEC --> VIEW
    ENGINE --> VIEW
    VIEW --> TABLE
    VIEW --> CARD
    TABLE -->|"版本化 field edit"| CODEC
    CARD -->|"版本化 field edit"| CODEC
    CODEC -->|"寫回原文位置，不另存值"| MD
```

自動屬性與手寫 bindings 共用名稱及相依規則；求值輸出不遞迴解析。Relation 按 record ID，UI 焦點按 record／field ID，不依 row index。轉換後 headings 不用 H1，保留首次原文及層級 mapping；unknown／不明定位停止回寫。

## 維護

改 project dependency 更新第 1 圖；改 owner／ports 更新第 2 圖；改程序或資料角色更新第 3 圖；改 journal／交易順序更新第 4 圖；改 Records source／projection 更新第 5 圖。同步架構、計畫與入口版本，實作／驗證／使用者接受分開記錄。
