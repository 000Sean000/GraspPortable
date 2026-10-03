---
title: GraspPortable — Core Requirements
version: 1.0.0-rc.10
updated: 2026-10-03
status: current-product-direction
scope: product-intent-and-requirements
supersedes: GraspPortable-Core-Requirements-v1.0.0-rc.9.md
---

## Interface｜目標、需求與重要界線

### 為什麼做

現成工具無法同時滿足自然筆記、可追溯的值引用、集中資料管理及低負擔的跨工具使用。GraspPortable 以筆記為中心，讓人自然書寫，讓程式以明確結構維護資料；大量 identifiers 可以分別存在 DB 中，而不必各自占一個實體檔案。

產品要降低使用者的管理與校正負擔。高度巢狀與交互引用必須支援真實知識工作；資料與依賴關係持續成長時，使用者仍能流暢書寫與操作。

### 核心使用模型

1. Note 是正常 Markdown；binding 可依使用者習慣放在筆記中方便的位置，不要求固定 Binding section。已接受外層語法為 `@code{ ... }`；已確認只有定義左側使用 `@Name =`，取值不加 `@`，不用分號。Literal 已選預設 `{value}`，依內容括弧 run 增加 marker 層數；value 原文優先保留，只有貼著 marker 的首尾括弧作局部 escape，精確定界依已接受的 S1 syntax profile，舊版「不允許要求 outer container」不再作本輪設計限制。Assignment 是 binding；真正程式仍由另一個 compiler／runtime 層處理。
2. 正文使用兩種 managed reference：`[value](:ref:Identifier)` 與 `[[@Identifier|value]]`。每個引用保存 identifier 與可讀的 rendered／cached value。
3. Binding 使用 raw literal 與字串串接；literal 外的 identifier 代表取值，`+` 連接片段。Binding 的排版應容許不同習慣，例如 assignment operator 與 opening delimiter 可在同一行或跨行；排版空白不應被誤當成 logical value。
4. Grasp 運作時以 DB 為 authority。使用者在 UI 修改共享 identifier／value，取得一致的共享結果、依賴與持久化引用值；實體 Markdown 依匯出或 checkpoint 產生。
5. MainVault → DB 是確定性搬運；匯出策略才決定哪些獨立 rows 共用一份 Markdown。策略可由使用者編輯，或由外部協作者提出結構化方案後審查保存。
6. 按需匯出與 fallback checkpoint 共用資料語義。輸出須可讀，完整 fallback 須能重建身分、bindings、依賴及附件。

### 產品使用路徑

使用者先繼續以 Obsidian／Obsidian Sync 日用，Grasp 以副本驗證；正式切換後，各裝置使用本機 DB。Mobile 的目標是裝置可獨立離線工作，再利用成熟雲端儲存／同步服務延續資料。

目標裝置至少包含 Windows PC，未來再嘗試擴充至 iPhone／iPad。Windows 是必要平台；mobile 是後續探索方向，不是首版同步交付承諾。

[正文與互動](#2-note-first-authoring) · [Reference](#3-identifier-與-reference) · [Binding](#4-binding-與-value-sync) · [資料與匯出](#6-data-authority-與-markdown-交換) · [完成判準](#12-完成判準)

## 1. 產品定位

GraspPortable 結合 Markdown authoring、identifier／reference、value sync、structured data、查詢與可攜資料輸出。知識本身是主要內容，資料關係讓它可被程式維護。

產品保留可程式化的接面；日常 Note 的正文與 binding，和真正程式的編譯／執行，是不同責任。

## 2. Note-first authoring

### 2.1 Markdown 是主要寫作介面

一般正文直接寫成 Markdown。需要為 identifier 建立或修改 value／composition 時，binding statement 可以直接寫在當下最方便的位置；不要求先移到固定 Binding 區，也不要求使用者維護特定 section layout。

Binding parser 依明確 syntax 辨識 statement，而不是依資料夾、heading、固定區域或 UI panel 判斷。Fenced code block 是否解析由 workspace 可設定的語言清單決定：起始清單啟用未標語言及 `grasp`，停用 `json`、`grasp-demo` 及其他未列語言。停用區不建立定義、引用或相依，也不作共享值回寫，讓使用者可以安全展示 syntax；啟用仍須符合 Grasp grammar，不代表任意程式執行。

Source、Live Preview、Reading View 分別服務完整原文編輯、同區編輯預覽、閱讀與直接操作。Obsidian 是主要互動參照；宿主呈現需以實際操作驗證。

正文 inline reference 利用 Markdown link／wikilink 的 label 或 alias 顯示 value、弱化 identifier。Binding statement 本身可直接顯示供人閱讀編輯；`@code` 的目的是明確定界與自由排版，不是為了隱藏文字。

### 2.2 寫作、導航與可讀性

中文 IME、選取、複製貼上、undo／redo、游標及長文輸入應保持自然。非編輯位置的 code fences、links、tables 應有相應閱讀效果；正文中的連結應可直接導航。

長期導航提供可展開／收合且保留父層與兄弟項脈絡的階層、搜尋及前後導覽。側邊欄有清楚的捲動與空間分工；放大字體、125%／150% zoom 或縮窄視窗後，主要操作仍可讀、可用。

小型編輯優先在目標附近進行。高影響變更以能理解影響範圍的審查介面處理。

## 3. Identifier 與 Reference

### 3.1 穩定身分與資料角色

Identifier、binding、reference occurrence、value observation、resolved value 分開保存。程式能解析到某個 occurrence 的文字，不等於該來源取得定案或覆寫其他資料的權限。

Canonical identity 與顯示名稱、資料夾位置、輸出檔案位置分開。Note、records、binding 與未來程式接面共享可追溯的 identity，而不是共享某套件的 AST 或資料庫 handle。

Identifier 採經典 ASCII 子集：每個 segment 為 `[A-Za-z_][A-Za-z0-9_]*`，以 `.` 分 namespace，點號兩側不可有空白，大小寫敏感。`Person.Job` 合法，`Person . Job` 非法。它是容易辨識的 ID mark，不保證外部 AI 不解讀名稱語義，也不宣稱等同完整 C# 規則。整個 workspace 中，相同 namespace 的同名 identifier 只有一個 definition，不能跨 Note 再定義；不同 namespace 可有同 local name，例如 `Recipe.Fruit` 與 `Dessert.Fruit`。

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

修改應盡量像 Obsidian 一樣即時反映；至少退出編輯時，立即送出最終有效編輯並更新相依內容，不等待下一個 idle debounce。計算或保存尚未完成時明示 pending，不能把舊值標為最新成功；語法不完整則保留可恢復草稿並明示未套用。這是更新時機要求，不是承諾大型計算零耗時。

[返回 Interface](#interface目標需求與重要界線)

## 4. Binding 與 Value Sync

### 4.1 為什麼屬於 App Runtime

Assignment 是 binding：把 identifier 與 literal value 或 composition 連結。Note 中的 binding 由 App Runtime 解析與求值，使 desktop、iPhone／iPad 的日常筆記可使用同一組資料關係。

Binding 不要求集中於專屬 section。外層 `@code{ ... }` 區域已接受，可分布於 Note 各處；它與「整篇只能有一個固定 Binding 區」不同。區域不建立 Note-local namespace。

真正 code 屬真實程式語言及對應 compiler／runtime 的責任；binding 不因為可以組合字串，就等同一段任意可執行程式。Fenced code block 依第 2.1 節清單決定是否解析；停用的展示文字完全不參與 Grasp 資料關係。

### 4.2 已選的 Binding 表達方向

已接受以文字為主的 literal、identifier 取值與 `+` 串接；只有定義左側加 @，不用分號。使用者已選下列单層起始與 marker 疊層方向，已整體接受相應的精確 lexical 邊界；完整 grammar 由 [Binding Syntax Review](../Engineering/Binding-Syntax-Review-v1.0.0-rc.4.md)維護。

~~~grasp-demo
@code{
    @Fruit = {apple}
    @Person.Job = {doctor}
    @Slogan = {An } + Fruit
        + { a day, keeps } + Person.Job + { away.}
    @Description =
    {
第一段。

第二段。
    }
}
~~~

正文可引用 Slogan 等單一具名結果。Assignment operator 與 expression 間的排版空白／換行屬結構；literal 裡實際內容空白才屬值。區域不引入 Note-local scope。一般正文、literal 內容不受 ASCII identifier 限制。

Literal 優先調整 marker 來避碰，不改 value。預設 {value}；內容有單個括弧時用兩層，有連續兩個時用三層以上，以此類推。{|x|} 直接表示 |x|。JSON 可把 marker 與內容分行，並選較長 marker，內容的大括弧與反斜線無須為 Grasp 逐一 escape。單行邊界黏合可用 {\{...\}} 表達 {...}。不引入固定雙括弧或舊 pipe 的並行可寫 grammar。

### 4.3 Literal 編輯體驗與多行序列化

Delimiter 必須容易輸入。Editor 提供成對補完、游標定位及必要的局部 escape 協助；本版 marker 疊層時两端同步；配對行為集中於可替換的 syntax profile。自動補完可撤銷，不 aggressive 改寫既有內容；parser 不依賴使用者曾用過補完。

已確認：marker 與真正 value 分行時，opening marker 後到該行結束的排版空白、closing marker 行前方的排版空白不算 value，兩個邊界的結構換行也不加入值。上例值為第一段、空行、第二段。真正內容行的首尾空白仍保存，不 trim／dedent；inline literal 的空白也不能刪除。確實需要首尾換行時，另留真正的內容空行。

Raw source、logical string 與 composition 分開保存，局部 escaping 不得造成資料損失。Block literal 保存原樣內容，不解碼反斜線；inline 的局部邊界 escape 與普通內容明確區分，不全面替換反斜線或中間括弧。Parser／serializer 必須能替換 syntax，既有 source 不得無聲套用新 grammar。

第一個可操作 UI 必須涵蓋多段落引用：完整呈現、相依更新、保存與重新載入均保留段落。停用 parsing 的展示區不產生 managed occurrence；修改語言清單須能理解定義／引用變動的影響。外部 Markdown 交換另驗證。

### 4.4 Dependency 計算

Binding 保留 literal fragments 與 identifier references 的順序及身分。值變更後，受影響的巢狀與共享引用結果保持一致。

Value Sync 須支援 Excel 類型的高互動依賴關係，包括深層相依、大量相依者、共享依賴及頻繁小幅修改。循環、缺失、取消及過期結果有明確狀態；過期結果不覆蓋新資料。重算期間，編輯器與日常互動維持流暢。

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

App Runtime 涵蓋筆記編輯／閱讀、binding／reference、value sync、查詢、保存、檔案交換與復原。Binding 語法區可自然分布在 Note 內，不需要集中於專屬 section；`@code` 名稱本身不授予任意程式執行能力。

程式開發／編譯由真正程式語言與 compiler 處理。PC 的 Programming Runtime 可透過穩定資料接面操作知識；其選型與交付依個別計畫處理。

## 8. Performance 與 UX Requirement

效能是產品品質要求，包含以下三項：

1. Excel 類型的高互動依賴關係：在高度巢狀、交互引用、廣泛連動與反覆小改的情境下，持續得到一致結果並保持流暢互動。
2. 真實資料下 UI 流暢：以實際 Vault／workspace 的日常使用為準，中文輸入、游標、選取、捲動、導航、搜尋及視圖切換保持及時回應；高延遲到像當機，即未達產品要求，不能以「仍可操作」判定完成。
3. 未來成長的效能餘裕：除目前資料外，也能承受預期的筆記量、identifier／reference 數量、依賴深度與連動範圍成長，並維持約定的互動品質。只解決目前瓶頸、剛好跑完當前資料，尚不足以滿足此要求。

大型計算、匯出、checkpoint 或重建可以耗時較久；進行時，日常互動仍須流暢，並呈現可理解的進度與狀態。

實作規劃已記錄使用者接受的暫定效能門檻及候選資料組；真實資料集、最低 PC 硬體與最終尺度仍待實測校準。驗證成本保持合理，不無限擴大測試。

## 9. Replaceability Requirement

Grasp 擁有自己的 identity、binding、reference、value、change 與 projection contracts。Editor、binding parser／evaluator、計算、persistence、exporter、匯出策略介面與 platform host，須有可測試、可局部替換的責任邊界。Syntax 日後可能調整；delimiter／escape、Markdown 解析政策、binding 邏輯須分開，保存格式版本與可逆來源，不讓更換 syntax 迫使重寫依賴計算。

## 10. Portability 與跨裝置延續

筆記庫、設定及可合理攜帶的使用者狀態可隨 workspace 帶走；App binary、compiler 與 runtime 可安裝於電腦。帳號 session 能否跨機續用須個別驗證。

自由度與資料主權至少對標 Obsidian：資料位置由使用者控制，核心本機工作不依賴強制雲端帳號；資料可取得、可讀及可恢復。這與既有 DB runtime authority 並存，Markdown export／fallback 仍須完成，不能只因提供 Portable executable 就宣稱資料可攜已達標。正式安裝若非執行環境或功能必要，不將其作為啟動前提；優先評估 Portable 目錄發布，首版先方便目前 Windows PC 試用。

iPhone／iPad 的目標是完整本機 App Runtime 與離線資料。跨裝置同步優先採成熟儲存／同步服務，Grasp 處理自己需要的版本、衝突與一致套用語義。Provider、同步格式及平台實作由後續計畫確認。

Workspace 在支援的目標 filesystem 上可攜帶，並能在寫入中斷後恢復一致狀態。

## 11. 外部匯出策略協作

App 提供匯出規劃資料及結構化策略的匯入接面。使用者或外部 AI 可審視資料後，協助決定哪些 DB rows 共用 Markdown；App 負責解析、驗證、預覽、接受與保存策略。

Contract 須能表達資料身分、基底版本、提供的審視範圍、成員及輸出配置；未知成員、漏分配、重複分配、路徑衝突與過期提案須可識別。提出方案的自然語言理由可供人閱讀，執行部分必須是結構化資料。

日常編輯、搬運與匯出均由確定性程序完成。對外部協作者的選擇與操作留在 App 外，筆記匯出同樣可以交給一般工具使用。

## 12. 完成判準

產品完成判準：

1. 可啟動、開啟 workspace、正常中文寫作、閱讀與導航；從實際畫面完成操作。
2. 正文 reference 保存 identifier 與可讀值；binding 保存 raw literals、串接順序與 dependencies，且不要求固定 placement。
3. 共享修改後，受影響資料與引用值一致；missing／cycle／stale 可觀察並保持資料。
4. 原始資料經確定性匯入、保存及重啟後保持內容與來源對照。
5. 使用者能審查／調整匯出策略；獨立 rows 可共用檔案而不失去 identity。
6. 匯出資料可在 App 外直接取得及閱讀；完整 fallback 可重建內容、關係和必要狀態。
7. Literal、delimiter pairing／autocomplete、escaping、LF／CRLF、首尾空白／換行及宿主 context 在保存與往返交換後保有正確內容與資料含義。
8. 功能由清楚的模組完成，替換點及 debug 入口可理解。
9. 真實資料及預期成長規模下，Excel 類型的高互動依賴關係、UI 流暢度與效能餘裕達成第 8 節要求。
