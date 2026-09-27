---
title: GraspPortable — Core Requirements
version: 1.0.0-rc.2
updated: 2026-09-27
status: current-product-direction
scope: product-intent-and-requirements
supersedes: GraspPortable-Core-Requirements-v1.0.0-rc.1.md
---

## Interface｜目標、需求與重要界線

### 為什麼做

現成工具無法同時滿足自然筆記、可追溯的值引用、集中資料管理及低負擔的跨工具使用。GraspPortable 以筆記為中心，讓人自然書寫，讓程式以明確結構維護資料；大量 identifiers 可以分別存在 DB 中，而不必各自占一個實體檔案。

產品要降低使用者的管理與校正負擔。先取得完整可操作的成果，再依真實使用摩擦局部改善；模組可替換、問題可定位，比預先設計所有功能重要。

### 核心使用模型

1. Note 包含正常 Markdown 正文，以及需要時可見、可編輯的 Binding 區。Assignment 是 binding；真正 code 由另一個程式語言／compiler 層處理。
2. 正文使用兩種 managed reference：`[value](:ref:Identifier)` 與 `[[@Identifier|value]]`。每個引用保存 identifier 與可讀的 rendered／cached value。
3. Binding 使用 raw literal 與字串串接；literal 外的 identifier 代表取值，`+` 連接片段。複合內容先建立單一具名 variable，正文再引用它。
4. Grasp 運作時以 DB 為 authority。使用者在 UI 修改共享 identifier／value，取得一致的共享結果、依賴與持久化引用值；實體 Markdown 依匯出或 checkpoint 產生。
5. MainVault → DB 是確定性搬運；匯出策略才決定哪些獨立 rows 共用一份 Markdown。策略可由使用者編輯，或由外部協作者提出結構化方案後審查保存。
6. 按需匯出與 fallback checkpoint 共用資料語義及 exporter。輸出須可讀，完整 fallback 須能重建身分、bindings、依賴及附件。

### 產品路徑與授權

使用者先繼續以 Obsidian／Obsidian Sync 日用，Grasp 以副本驗證；正式切換後，各裝置使用本機 DB。Mobile 的目標是裝置可獨立離線工作，再利用成熟雲端儲存／同步服務延續資料。

本文件保存產品方向，不代表語法、平台或功能已驗證完成，也不自動授權實作。每次 Goal 以使用者接受的範圍及驗收結果為準。

[正文與互動](#2-note-first-authoring) · [Reference](#3-identifier-與-reference) · [Binding](#4-binding-與-value-sync) · [資料與匯出](#6-data-authority-與-markdown-交換) · [完成判準](#13-完成判準)

## 1. 產品定位

GraspPortable 結合 Markdown authoring、identifier／reference、value sync、structured data、查詢與可攜資料輸出。知識本身是主要內容，資料關係讓它可被程式維護。

產品保留可程式化的接面；日常 Note 的正文與 binding，和真正程式的編譯／執行，是不同責任。

## 2. Note-first authoring

### 2.1 Markdown 是主要寫作介面

一般正文直接寫成 Markdown。只有為某個 identifier 定義 literal 或 composition 時，才使用 Binding 區。

Source、Live Preview、Reading View 分別服務完整原文編輯、同區編輯預覽、閱讀與直接操作。Obsidian 是主要互動參照；宿主呈現需以實際操作驗證。

正文 inline reference 利用 Markdown link／wikilink 的 label 或 alias 顯示 value、弱化 identifier。Binding 區直接顯示供人閱讀編輯；其辨識容器由配套語法規格確定。

### 2.2 寫作、導航與可讀性

中文 IME、選取、複製貼上、undo／redo、游標及長文輸入應保持自然。非編輯位置的 code fences、links、tables 應有相應閱讀效果；正文中的連結應可直接導航。

長期導航提供可展開／收合且保留父層與兄弟項脈絡的階層、搜尋及前後導覽。側邊欄有清楚的捲動與空間分工；放大字體、125%／150% zoom 或縮窄視窗後，主要操作仍可讀、可用。

小型編輯優先在目標附近進行。高影響變更以能理解影響範圍的審查介面處理。個別 Goal 可先完成阻擋當次流程的部分，再分期完成整體 UX。

## 3. Identifier 與 Reference

### 3.1 穩定身分與資料角色

Identifier、binding、reference occurrence、value observation、resolved value 分開保存。程式能解析到某個 occurrence 的文字，不等於該來源取得定案或覆寫其他資料的權限。

Canonical identity 與顯示名稱、資料夾位置、輸出檔案位置分開。Note、records、binding 與未來程式接面共享可追溯的 identity，而不是共享某套件的 AST 或資料庫 handle。

### 3.2 正文 Reference 的兩種形式

Pure Variable Inline Reference：

```text
[value](:ref:Identifier)
[apple](:ref:Fruit)
```

Value 在 label；identifier 在 destination。不需要為該 identifier 建立獨立實體筆記。

Managed Wikilink Reference：

```text
[[@Identifier|value]]
[[@Fruit|apple]]
```

Value 在 alias；target 保留 `@`，用於確實需要實體筆記 target 及其導航關係的情況。普通 wikilink 仍按普通筆記連結處理，與 managed value reference 分開。

在 table 等 context 中，宿主需要的 escaping 屬表示層；logical value 與 identifier 不因此多出字元。實際 Obsidian 顯示、點擊與 escaping 相容性須驗證。

### 3.3 可讀值與可還原結構

引用本身保存可讀的 rendered／cached value 與 identifier。只留 identifier、把值完全留在記憶體，不能滿足單篇 Markdown 閱讀與交換需求。

引用保存展開結果；binding 保存 literal fragments 與 dependencies。完整重建須恢復兩者，展開文字不能取代 composition definition。

使用者可由引用找 definition、查看 references、理解 missing／stale／cycle。快取值須能追溯至所對應的資料版本；解析失敗不能以空字串假裝成功。

### 3.4 共享修改與一致性

UI 提供對共享 identifier／value 的語意操作，包括重新命名與從引用位置進入值的修改。一次有效操作完成後，共享定義、受影響的巢狀結果及持久引用快取整體一致。

修改展開文字若不能唯一對應回 binding，介面引導編輯 literal 或 dependency。外部 Markdown 的變更經差異審查、來源／版本驗證及明確套用；來源角色的精確更新權限須由已接受的政策處理。

DB 內的共享更新與 filesystem 輸出分開：正常編輯完成，不表示必須立即發布整棵 Markdown 樹。

[返回 Interface](#interface目標需求與重要界線)

## 4. Binding 與 Value Sync

### 4.1 為什麼屬於 App Runtime

Assignment 是 binding：把 identifier 與 literal value 或 composition 連結。Note 的 binding 由 App Runtime 解析與求值，使 desktop、iPhone／iPad 的日常筆記可使用同一組資料關係。

真正 code 屬真實程式語言及對應 compiler／runtime 的責任；binding 不因為可以組合字串，就等同一段任意可執行程式。

### 4.2 已選的 Binding 表達方向

以下是 Binding 區的內容示例，不替外層容器定名：

```text
@Fruit = <|apple|>
@Person.Job = <|doctor|>
@Slogan = <|An |> + Fruit + <| a day, keeps |> + Person.Job + <| away.|>
```

正文直接引用具名結果：

```text
There is a slogan [An apple a day, keeps doctor away.](:ref:Slogan).
```

Raw literal 使用 opening／closing marker。Literal 內的引號、`+`、`=`、Markdown 文字等按內容保存；literal 外的 identifier 是取值，`+` 是字串串接。

遇到內容與 closing marker 衝突時，由 serializer 選擇不碰撞的 marker 層級，例如 `<||...||>`。使用者輸入的反斜線仍可能是真正內容；避免以全域 escape／unescape 破壞它。

複合文字的 composition 集中在 binding，正文僅引用單一 identifier 與其保存值。

### 4.3 多行與序列化

Binding literal 可保存真實換行：

```text
@Description = <|
第一段。

第二段。
|>
```

此 block 表達方向中，開頭 marker 後與 closing marker 前的邊界換行不作為內容；中間換行與內容空白保留。若 value 本身需要首尾換行，也必須能無損表達。

Raw source、logical string、literal／reference composition 及宿主 escaping 分層處理。一般 Note 本文直接保留 Markdown；只有 binding 的字串片段需要 literal 定界。

精確詞法邊界、不同 delimiter 層級、空值、換行／縮排、statement 結束及外層容器須以配套 grammar 與 expected-value 案例補齊。多行 binding 的支援，不等於兩種 inline reference 已驗證能直接容納所有多段落結果。

### 4.4 Dependency 計算

模型保持 literal fragments 與 identifier references 的順序及身分。從 bindings 建立 dependency graph；值變更後只重算受影響部分。

驗證 deep chain、wide fan-out、shared dependencies、反覆小改、cycle、missing、取消及舊結果拒絕。正常編輯與重算期間，editor 仍可操作。

[返回 Interface](#interface目標需求與重要界線)

## 5. Structured Data

同型知識可集中保存為 records，再產生表格或其他 views。每筆資料的 identity 與語意內容保留；row 數量與實體 Markdown 檔案數量分開。

例如 Aura records 可分別搜尋、編輯、引用，在不同筆記產生 view，而匯出時依策略共用少量 Markdown 文件。使用者可以管理 collection、資料關係與輸出分組。

## 6. Data Authority 與 Markdown 交換

### 6.1 過渡與正式使用

過渡期繼續使用 Obsidian／Obsidian Sync 維持日用 Vault，Grasp 以副本和受控交換驗證。Grasp workspace 的 DB 管理自己的狀態，不代表日用 Vault 已經切換 authority。

正式使用 Grasp 後，以本機 DB 保存 authoritative notes、bindings、identifiers、records、關係、匯出策略與必要使用者狀態。外部檔案變更須經可理解的審查與版本核對。

### 6.2 MainVault → DB

匯入是確定性搬運：逐筆保存內容、原始路徑、metadata、來源對照及能可靠辨識的關係。小檔案可各自形成獨立 row。

未知語法先保留 raw source 與診斷。減少輸出檔案的語意分組不是搬進 DB 的前提，也不是刪掉原始內容或合併 canonical identities 的理由。

### 6.3 Markdown Projection Strategy

匯出策略是 App 可解析、可保存及可由使用者編輯的資料，描述哪些實體共用一份 Markdown，以及必要的輸出位置、順序、呈現和定位。

策略一次接受後，後續匯出為確定性處理。使用者仍可調整群組、成員、獨立成檔與路徑；新增資料的未分配狀態須可觀察。

多筆資料共用檔案，保留每筆 identity、說明、binding 與相依關係。引用位置保有可讀值；完整匯出保存重建所需的結構及定位。

### 6.4 按需匯出與 Fallback checkpoint

App 的階層瀏覽可完全來自 DB。需要帶走筆記、資料夾或 records 時，按需實體化 Markdown，顯示位置並提供檔案總管／平台檔案分享入口。

另以適當 checkpoint 留下可獨立閱讀、以 Obsidian 開啟及供 Grasp 重建的完整 Markdown。介面標示最後成功時間、資料版本及失敗／落後狀態。Fallback 在 App 故障時必須已有可用資料，不能只依賴故障後再啟動 App 匯出。

兩個用途共用匯出策略與格式，不要求使用者管理兩套同義的完整文件樹。更新頻率、保留政策與可接受落後窗口由已接受的計畫及實測決定。

### 6.5 匯回與還原

外部修改 rendered value、binding、identifier 或一般正文，是不同類型的變更；匯入審查應呈現其實際影響。

單篇匯出首先滿足可讀與交換；完整 fallback 承諾恢復約定的內容、身分、bindings、依賴、匯出策略及附件。可讀、可導航、可重建是分開驗證的成果。

[返回 Interface](#interface目標需求與重要界線)

## 7. App Runtime 與 Programming Runtime

App Runtime 涵蓋筆記編輯／閱讀、binding／reference、value sync、查詢、保存、檔案交換與復原。Note 使用正文 reference 及可見的 binding 區。

程式開發／編譯由真正程式語言與 compiler 處理。PC 的 Programming Runtime 可透過穩定資料接面操作知識；其選型與交付依個別計畫處理。

## 8. Performance Requirement

效能來源是 MainVault 與 Excel-like 高互動 dependency workload。分別測量輸入、解析／索引、dirty propagation、重算、DB 保存、搜尋、匯出及重建，不能互相替代。

使用真實副本與 synthetic deep／wide／mixed graph；記錄 cold／warm、反覆小改、受影響節點數、記憶體及背景計算中的 UI 延遲。技術名稱本身不構成效能證明。

## 9. Replaceability Requirement

Grasp 擁有自己的 identity、binding、reference、value、change 與 projection contracts。Editor、binding parser／evaluator、計算、persistence、exporter、匯出策略介面與 platform host，須有可測試、可局部替換的責任邊界。

第三方型別留在 adapter。替換是否便宜，依實際影響面與資料遷移成本判斷，不以 interface 數量判斷。

## 10. Portability 與跨裝置延續

筆記庫、設定及可合理攜帶的使用者狀態可隨 workspace 帶走；App binary、compiler 與 runtime 可安裝於電腦。帳號 session 能否跨機續用須個別驗證。

iPhone／iPad 的目標是完整本機 App Runtime 與離線資料。跨裝置同步優先採成熟儲存／同步服務，Grasp 處理自己需要的版本、衝突與一致套用語義。Provider、同步格式及平台實作由後續計畫確認。

可攜驗證需涵蓋目標 filesystem 與中斷復原，不能只憑 Windows 本機一次成功就宣稱所有隨身碟可用。

## 11. 外部匯出策略協作

App 提供匯出規劃資料及結構化策略的匯入接面。使用者或外部 AI 可審視資料後，協助決定哪些 DB rows 共用 Markdown；App 負責解析、驗證、預覽、接受與保存策略。

Contract 須能表達資料身分、基底版本、提供的審視範圍、成員及輸出配置；未知成員、漏分配、重複分配、路徑衝突與過期提案須可識別。提出方案的自然語言理由可供人閱讀，執行部分必須是結構化資料。

日常編輯、搬運與匯出均由確定性程序完成。對外部協作者的選擇與操作留在 App 外，筆記匯出同樣可以交給一般工具使用。

## 12. 需求與單次 Goal 的關係

本文件的產品範圍不等於單次 Goal 的工作量。每次先確認可操作成果、影響的 contracts、重要取捨及完成證據，再授權對應的實作段落。

資料與語法方向的採用，不等於所有邊界已證明正確；需要改變同一合法資料含義的選擇，先以版本化範例討論。進度、實作現況及開放決策分別留在工作計畫／狀態文件。

## 13. 完成判準

個別 Goal 依已接受範圍驗證下列相關成果：

1. 可啟動、開啟 workspace、正常中文寫作、閱讀與導航；從實際畫面完成操作。
2. 正文 reference 保存 identifier 與可讀值；binding 保存 raw literals、串接順序與 dependencies。
3. 共享修改後，受影響資料與引用值一致；missing／cycle／stale 可觀察並保持資料。
4. 原始資料經確定性匯入、保存及重啟後保持內容與來源對照。
5. 使用者能審查／調整匯出策略；獨立 rows 可共用檔案而不失去 identity。
6. 匯出資料可在 App 外直接取得及閱讀；完整 fallback 可重建內容、關係和必要狀態。
7. Literal、escaping、LF／CRLF、首尾空白／換行及宿主 context 有精確 round-trip 案例。
8. 效能、中斷恢復及平台結果按實測範圍陳述；未驗證部分明示。
9. 功能由清楚的模組完成，替換點及 debug 入口可理解。

產品已做出、測試已通過、使用者已接受，是不同狀態。
