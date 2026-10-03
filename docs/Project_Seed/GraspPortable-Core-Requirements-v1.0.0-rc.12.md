---
title: GraspPortable — Core Requirements
version: 1.0.0-rc.12
updated: 2026-10-04
status: current-product-direction
scope: product-intent-and-requirements
supersedes: GraspPortable-Core-Requirements-v1.0.0-rc.11.md
---

## Interface｜目標、需求與重要界線

### 為什麼做

現成工具無法同時滿足自然筆記、可追溯的值引用、集中資料管理及低負擔的跨工具使用。GraspPortable 以筆記為中心，讓人自然書寫，讓程式以明確結構維護資料；大量 identifiers 與 records 可以共用 Markdown 檔案，身分不必綁定一檔一筆。

產品要降低使用者的管理與校正負擔。高度巢狀與交互引用必須支援真實知識工作；資料與依賴關係持續成長時，使用者仍能流暢書寫與操作。

### 核心使用模型

1. Note 是正常 Markdown；binding 可依使用者習慣放在筆記中方便的位置，不要求固定 Binding section。已接受外層語法為 `@code{ ... }`；已確認只有定義左側使用 `@Name =`，取值不加 `@`，不用分號。Literal 已選預設 `{value}`，依內容括弧 run 增加 marker 層數；value 原文優先保留，只有貼著 marker 的首尾括弧作局部 escape，精確定界依已接受的 S1 syntax profile，舊版「不允許要求 outer container」不再作本輪設計限制。Assignment 是 binding；真正程式仍由另一個 compiler／runtime 層處理。
2. 正文使用兩種 managed reference：`[value](:ref:Identifier)` 與 `[[@Identifier|value]]`。每個引用保存 identifier 與可讀的 rendered／cached value。
3. Binding 使用 raw literal 與字串串接；literal 外的 identifier 代表取值，`+` 連接片段。Binding 的排版應容許不同習慣，例如 assignment operator 與 opening delimiter 可在同一行或跨行；排版空白不應被誤當成 logical value。
4. Markdown 是已保存原文的權威。Grasp 與 Obsidian 可交替編輯同一工作資料夾；Grasp 自動辨識外部修改，維護身分、相依及可讀引用。SQLite 承載可重建索引、計算結果、版本基底，以及不能任意丟棄的草稿與恢復日誌。
5. 分組策略能實際合併／拆分工作檔案，保留各筆身分、metadata、bindings、附件與連結。資料表以縱向 Markdown 保存長文欄位，再由 Grasp 呈現可凍結行列的表格；不要求使用者閱讀擁擠的寬 Markdown table。
6. 工作資料可直接取得及閱讀；完整 checkpoint 能恢復身分、內容、策略、附件及必要草稿。備份不代替日常保存。

### 產品使用路徑

先使用授權副本驗證 Grasp／Obsidian 共用 Markdown 工作資料夾；未通過資料一致性驗證前不轉移正式日用資料。Mobile 的長期目標是獨立離線工作及跨裝置資料延續，provider 與同步策略另行確認。

目標裝置至少包含 Windows PC，未來再嘗試擴充至 iPhone／iPad。Windows 是必要平台；mobile 是後續探索方向，不是首版同步交付承諾。

[正文與互動](#2-note-first-authoring) · [Reference](#3-identifier-與-reference) · [Binding](#4-binding-與-value-sync) · [資料與匯出](#6-data-authority工作檔案與恢復) · [完成判準](#12-完成判準)

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

S2 側邊欄參照 Obsidian／VS Code，顯示 workspace **實際的資料夾與檔案樹**，可展開／收合及搜尋，保留父層與兄弟項脈絡。這不是 Records view 的虛擬群組；資料夾搬移也不等於 S3 內容合併／拆分。前後導覽仍保留於長期導航方向。側邊欄有清楚的捲動與空間分工；放大字體、125%／150% zoom 或縮窄視窗後，主要操作仍可讀、可用。

右鍵選單整合選中檔案／資料夾的常用快捷功能：新增筆記、新增資料夾、重新命名、搬移、複製路徑、開啟筆記及在系統檔案總管顯示。選單內容依目標類型提供，這個範圍不擴展成完整 VS Code clone。改名／移動後保留 canonical IDs 與可可靠辨識的引用／連結；版本衝突或部分失敗不丟資料。`.grasp`、`.git`、`artifacts` 等內部／生成內容不列入日常筆記樹。

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

外部編輯定義自動更新相依；外部把引用的顯示值由 apple 改成 banana，視為共享修改意圖。以共同基底辨識實際修改，只在能唯一對應 literal、版本有效且沒有矛盾修改時更新來源與其他引用。不能反推 composition 時導向來源，不把展開結果攤平。外部一般存檔不要求逐筆匯入確認；高影響、矛盾或身分不明的修改才呈現處理介面。

App 的 dirty draft 或 IME 組字不得被外部更新覆蓋。原文保存、語意接受與跨檔引用回寫是可觀察的不同狀態；跨檔中斷必須可恢復，不能把部分寫入稱為全部成功。

修改應盡量像 Obsidian 一樣即時反映；至少退出編輯時，立即送出最終有效編輯並更新相依內容，不等待下一個 idle debounce。計算或保存尚未完成時明示 pending，不能把舊值標為最新成功；語法不完整仍保留最新原文及可恢復草稿，不發布部分 definitions，最後成功結果明示為過期。這是更新時機要求，不是承諾大型計算零耗時。

[返回 Interface](#interface目標需求與重要界線)

## 4. Binding 與 Value Sync

### 4.1 為什麼屬於 App Runtime

Assignment 是 binding：把 identifier 與 literal value 或 composition 連結。Note 中的 binding 由 App Runtime 解析與求值，使 desktop、iPhone／iPad 的日常筆記可使用同一組資料關係。

Binding 不要求集中於專屬 section。外層 `@code{ ... }` 區域已接受，可分布於 Note 各處；它與「整篇只能有一個固定 Binding 區」不同。區域不建立 Note-local namespace。

真正 code 屬真實程式語言及對應 compiler／runtime 的責任；binding 不因為可以組合字串，就等同一段任意可執行程式。Fenced code block 依第 2.1 節清單決定是否解析；停用的展示文字完全不參與 Grasp 資料關係。

### 4.2 已選的 Binding 表達方向

已接受以文字為主的 literal、identifier 取值與 `+` 串接；只有定義左側加 @，不用分號。使用者已選下列单層起始與 marker 疊層方向，已整體接受相應的精確 lexical 邊界；完整 grammar 由 [Binding Syntax Review](../Engineering/Binding-Syntax-Review-v1.0.0-rc.5.md)維護。

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

## 5. Structured Data 與長文屬性

### 5.1 資料表與角色卡

同型知識保存為具有穩定 ID 的 records；一列可開成完整角色卡，多個 views 共用同一批資料，不複製欄位內容。每筆身分與名稱、檔案、表格及 view 分開。

支援文字／Markdown、數字、布林、日期、單選、多選、tag、單筆關聯及多筆關聯。日期先為 date-only，數字不靜默截斷，空值、空字串、零及 false 分開。多選選項由欄位管理，tag 可跨資料表搜尋。外部無效型別保留原值及診斷。關聯依 record ID 維持，正文保有可讀連結，缺失目標明示；本階段不包含 rollup、通用公式或任意關聯鏈求值。

使用者可新增／編輯列及欄位、搜尋、排序、篩選、調整欄位顯示／順序及保存多個 views。長文 cell 先顯示摘要，點開後編輯完整 Markdown；角色卡可容納多段文字、圖片、清單、wikilink 及 Grasp 語法。

### 5.2 單一 Markdown 值與自動屬性

欄位正文是唯一可編輯值來源；YAML 保存必要 ID、schema、型別與定位資訊，SQLite 保存投影，不另生成第二份可獨立修改的 `@定義`。

自動屬性採 `RecordKey.FieldKey`，例如 `Characters.Triensa.Description`。Key 沿用 ASCII case-sensitive 規則，中文顯示名稱另存；表格／view 名稱不參與識別。可靠改 key 延續身分並更新引用，移檔、分組及換 view 不改 key。同 workspace 的自動屬性與手寫 binding 共用名稱唯一性。

引用欄位取得計算後的 Markdown。欄位內原始 source 的 Grasp 引用參與相依更新，並遵守停用 parsing 區、missing／cycle 及版本規則；求值結果、literal 及 reference cache 不再遞迴解析。修改欄位或共享值回到原 Markdown 區域，不把正文誤序列化為 literal。

### 5.3 可讀的縱向保存與表格還原

過寬的二維 Markdown table 改成縱向表示。優先使用 H2 資料集、H3 record、H4 欄位；複雜內容或 heading 結構衝突時，次選階層式巢狀清單及明確縮排邊界。結構及轉換後實際 Markdown 標題不使用 H1。首次轉換預覽標題調整，深度超限改用巢狀清單而非壓平；保存轉換前原文及層級對應供恢復。後續編輯以新原文為準，不猜測舊層級意圖；code fence 內的 `#` 不是標題。

格式必須保留 record／field 身分、型別、順序、空值、多值與關聯，可重新建立 DB table。不能只把下一個 heading 當作任意長文結尾；結構不明時保留原文、停止自動改寫。

Grasp render 成真正表格：固定欄位標題列及 record 標題欄，可依 view 設定凍結前幾列／欄，支援橫向／縱向捲動。排序、篩選及延遲回應不得把編輯套到其他 record；凍結區不能遮住 editor、選單或鍵盤焦點。大量資料以分頁／虛擬化保持流暢。

## 6. Data Authority、工作檔案與恢復

### 6.1 同一資料夾共同編輯

Markdown 是已保存原文權威；正常原文保存不等待語法完整或整庫備份。Grasp 與 Obsidian 可交替修改同一工作資料夾，外部修改、移檔、改名、刪除均可辨識。關閉 Grasp 時結束後端，重開自動處理期間變動。未完成語法保存來源及診斷，不以舊內容覆寫。

SQLite 保存索引、計算結果、版本基底、草稿及恢復日誌；草稿與日誌不當成可任意清除的快取。身分與檔案路徑分離，必要 ID、schema、成員對應放 YAML frontmatter，保留使用者 metadata。普通 Markdown 沒有 Grasp metadata 仍可開啟，不因掃描就重寫整庫。

既有 DB-only workspace 遷移到新資料夾並核對，原資料保留；新行為必須經實作驗證，不以文件接受代替完成。

### 6.2 外部變動與身分

保存內容、來源路徑、metadata、可辨識關係及附件對照，未知語法保留原文。重複 ID、身分配對不唯一或共同基底缺失時，不無聲合併或覆寫；呈現需處理的衝突。

來源變更與 Grasp 自己的回寫須可區分，避免更新循環。部分跨檔修改中斷後能恢復，已完成與待處理結果分開顯示。

### 6.3 工作檔案分組

策略是可保存、可編輯的結構資料，描述成員、順序、路徑、呈現與定位。實際套用可合併／拆分工作檔案，不僅是備份時改版面。預覽未知／漏分配／重複成員、路徑衝突、過期方案、metadata 及連結影響。

合併保留每筆 ID、原 metadata、bindings、附件與定位；Grasp 仍辨識多筆，Obsidian 可視為一篇實體筆記。可可靠辨識的普通連結及 Grasp 引用更新到相應位置，未知連結列出限制。刪除舊檔前，先驗證新檔、連結更新與恢復材料；不把整理等同不可回復的刪除。

### 6.4 備份與 Fallback checkpoint

工作資料本身可在 App 外閱讀。另以手動備份及自動 checkpoint 留下獨立完整版本：有變更時每五分鐘啟動一次，正常關閉前補做，保留最近三份完整版本；頻率與保留數可設定。這是備份排程，不是日常保存延遲，也不保證每次備份零耗時。

固定快照輸出新 generation，包含 Markdown、附件、身分、schema、解析設定、分組策略及必要草稿／恢復狀態；草稿與已接受內容分開。完整驗證後發布完成標記，失敗或取消保留上次成功版本。

介面顯示最後成功時間、資料版本、進度、落後及缺件。App 故障時仍有已完成的可讀備份，不能依賴故障後啟動 App 才匯出。

### 6.5 還原

預設建立新 workspace，核對內容、身分、bindings、relations、策略、附件及必要狀態後才開啟，不覆寫目前資料。可讀、可導航、可重建分開驗證；遇到不相容格式或缺件時保留資料及診斷。

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

自由度與資料主權至少對標 Obsidian：資料位置由使用者控制，核心本機工作不依賴強制雲端帳號；資料可取得、可讀及可恢復。Markdown 工作檔案、備份及還原共同承擔資料可攜，不能只因提供 Portable executable 就宣稱達標。正式安裝若非執行環境或功能必要，不將其作為啟動前提；優先評估 Portable 目錄發布，首版先方便目前 Windows PC 試用。

iPhone／iPad 的目標是完整本機 App Runtime 與離線資料。跨裝置同步優先採成熟儲存／同步服務，Grasp 處理自己需要的版本、衝突與一致套用語義。Provider、同步格式及平台實作由後續計畫確認。

Workspace 在支援的目標 filesystem 上可攜帶，並能在寫入中斷後恢復一致狀態。

## 11. 外部匯出策略協作

App 提供工作檔案分組規劃資料及結構化策略接面。使用者或外部 AI 可審視資料後，協助決定哪些獨立 records／notes 共用 Markdown；App 負責解析、驗證、預覽、接受與保存策略。

Contract 須能表達資料身分、基底版本、提供的審視範圍、成員及輸出配置；未知成員、漏分配、重複分配、路徑衝突與過期提案須可識別。提出方案的自然語言理由可供人閱讀，執行部分必須是結構化資料。

日常編輯、搬運與匯出均由確定性程序完成。對外部協作者的選擇與操作留在 App 外，筆記匯出同樣可以交給一般工具使用。

## 12. 完成判準

產品完成判準：

1. 可啟動、開啟 workspace、正常中文寫作、閱讀與導航；從實際檔案樹展開／搜尋並以右鍵執行常用檔案操作，改名／搬移不失去身分及引用。
2. 正文 reference 保存 identifier 與可讀值；binding 保存 raw literals、串接順序與 dependencies，且不要求固定 placement。
3. 共享修改後，受影響資料與引用值一致；missing／cycle／stale 可觀察並保持資料。
4. Grasp／Obsidian 交替編輯、保存及重啟後保持內容、身分與來源對照，衝突不丟資料。
5. 使用者能審查／調整分組策略；獨立 rows 可實際合併／拆分檔案而不失去 identity。
6. 匯出資料可在 App 外直接取得及閱讀；完整 fallback 可重建內容、關係和必要狀態。
7. Literal、delimiter pairing／autocomplete、escaping、LF／CRLF、首尾空白／換行及宿主 context 在保存與往返交換後保有正確內容與資料含義。
8. 功能由清楚的模組完成，替換點及 debug 入口可理解。
9. 真實資料及預期成長規模下，Excel 類型的高互動依賴關係、UI 流暢度與效能餘裕達成第 8 節要求。

10. Records 的所有已選欄位、單／多關聯、自動屬性、縱向 Markdown、凍結行列與多 views 可操作，且外部編輯及還原後內容／身分一致。
