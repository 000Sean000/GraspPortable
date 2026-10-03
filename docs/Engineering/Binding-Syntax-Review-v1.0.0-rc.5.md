---
title: GraspPortable — Binding Syntax and Parsing Policy Review
version: 1.0.0-rc.5
updated: 2026-10-04
status: accepted-s1-syntax-profile
scope: binding-syntax-markdown-policy-and-parser-replaceability
supersedes: Binding-Syntax-Review-v1.0.0-rc.4.md
---

## 結論與決策狀態

已確認：identifier 採經典 ASCII 子集、區分大小寫，qualified name 的點號兩側不能有空白；**只在定義左側加 @，取值不加 @，不用分號分隔**。同 workspace／namespace 的同名 definition 唯一，不因 Note 不同而例外。

已確認需用可設定的 code block 語言清單控制 Grasp parsing：未標語言及 grasp 啟用，json／grasp-demo 預設停用。Parser 要容易維護與替換 syntax。原先分號、允許點號兩側空白、強迫用多行隔開首尾 pipe 的建議均已撤回。

使用者已指定 **單層 {value} 起始，按內容的連續括弧增加 marker 層數**；內容優先原樣保存，JSON 可自然分行隔開邊界，首尾貼著 marker 的括弧才作局部 escape。此方向取代前版固定雙括弧與全面有限 escape；S1 已整體接受 rc.3 的精確邊界補充；rc.4 同步接受狀態及 reference／context 明確化；rc.5 更新現行路由與 Records 原文解析邊界，未更換 syntax profile。外層沿用使用者原提案 @code{ ... }；保留容器。以下程式區塊皆是文件示例，不是實作證據。其餘階段、部署與效能見[實作規劃](Implementation-Plan-v1.0.0-rc.8.md)。

## 1. 已接受的組合外觀

~~~grasp-demo
@code{
    @Fruit = {apple}
    @Person.Job = {doctor}
    @Slogan = {An } + Fruit
        + { a day, keeps } + Person.Job + { away.}
}
~~~

@ 只標記 assignment 左側；Fruit、Person.Job 是 RHS 取值。正文仍使用 [value](:ref:Identifier) 與 [[@Identifier|value]] 兩種既定 reference，wiki target 的 @ 不受此修改影響。

@code 是 binding DSL 區域，初期只包含定義、literal、取值與串接，不執行 C#／JS。不要求固定 Note section；可以放多個區域。首輪不加入巢狀 Region 或 comment grammar，說明可寫在區域外。這些是保持首輪範圍的小型工程安排；外層容器已整體接受。

## 2. Identifier 與不使用分號的邊界

~~~text
Segment       := [A-Za-z_][A-Za-z0-9_]*
QualifiedName := Segment ('.' Segment)*
Declaration   := '@' QualifiedName WS '=' WS Expression
Expression    := Atom (WS '+' WS Atom)*
Atom          := Literal | QualifiedName
Region        := '@code{' WS (Declaration WS)* '}'
WS            := (space | tab | CRLF | LF | CR)*
~~~

這是 grammar 骨架，實際 lexer 以完整 token 辨識，不先刪空白，也不靠逐行正規表示式串接。@ 與 name 之間不可有空白；Person.Job 是一個 qualified name，Person . Job、Person. Job、Person .Job 均非法。ASCII 名稱限制不套用一般正文或 literal。名稱以 ordinal case-sensitive 比較；Fruit 和 fruit 不同。

首輪無隱含 using／相對 namespace：Recipe.Fruit 與 Dessert.Fruit 可並存，引用用完整名稱；根層 Fruit 就是根層名稱。Canonical ID 與名稱分離，rename 不換 ID。DSL 不嵌入 C#，class 等外部語言 keyword 可作名稱；若日後產生 C#，由 adapter 處理該語言 escaping。完整 @code{ 才是 opener，@code = {x} 則是區域內名為 code 的定義。

新的 @Name = 在 literal 外開始下一筆定義。前一個 expression 必須完整；新 marker 不能自動修補前一筆。換行、空格只是 token 間排版，= 後可換行，+ 可放上一行或下一行。

~~~grasp-demo
@code{ @A = {x} @B = A + {y} }  // 此行尾說明在區域外
@code{ @A = B C }                  // 錯：兩個 atom 間缺 +
@code{ @A = B + @Next = {x} }     // 錯：A 缺 operand；不先提交 Next
@code{ @A = @B }                   // 錯：取值不能加 @
~~~

Literal 中的 @Name =、+、= 都是內容。名稱後的 token 識別只需順序掃描；不允許點號空白讓 grammar 更直接，但本輪沒有量測證据可聲稱因此顯著提升效能。

## 3. Literal：單層起始、marker 疊層

**使用者已選方向**：預設 {value}；value 中有括弧時增加 marker 層數，有連續兩個括弧時使用三層以上，以此類推。優先改 marker，保留 value 原文。只有 value 的邊界與 marker 黏合時才使用邊界 escape，或以自然的多行排版隔開。

~~~grasp-demo
@code{
    @Empty = {}
    @Text = {x}
    @Pipes = {|x|}
    @Braces = {{before {x} after}}
    @Double = {{{before {{x}} after}}}
    @Boundary = {\{...\}}
}
~~~

值依序為空字串、x、|x|、before {x} after、before {{x}} after、{...}。這裡的 layers 是 delimiter 長度，不是 JSON／程式語言的巢狀解析；literal 不做插值，不建立內層 definition 或 reference。

### 已接受的確定性規則

以下為已接受 S1 profile 的工程規格；規格接受不代表 parser 已通過實測：

1. 只在 Expression 需要 Atom 的位置，把連續左括弧當 literal opener；最大連續長度為 n，n ≥ 1。@code{ 的外層括弧由 Region 狀態處理。
2. 普通 raw content 的左／右括弧各自按同方向連續長度計算，最大值為 m。選 n > m；不要求括弧平衡，也不解析 JSON quote。已明確標示的邊界 escape 不計入 raw run，因此 {\{...\}} 可以使用 n=1。
3. 在 inline literal 中，第一段足以提供 n 個右括弧的 run 關閉 literal；消費 n 個，後續字元交回外層 grammar。值本身結尾的右括弧若與 mark 黏合，必須用邊界 escape；不從長 run 猜使用者想保留多少個。Serializer 在 literal 與 Region close 之間保留空白／換行，避免視覺黏合。
4. {} 是 n=1 的空值，{{}} 是 n=2 的空值；{{{}}} 是 n=3 的空值。Canonical 空值輸出 {}。{{x}} 表示 x，不猜成 {x}；同一 source 只保留最長 opener 的一種解讀。
5. 多行模式仍使用 n > m。只在合法 closing line 位置接受 n 個右括弧；不足長度的內容行照原文保存。內容含等長／更長 raw run 是 delimiter 衝突，不用「看起來像 JSON」推斷跳過。
6. 增加層數時 editor 同步調整兩端，保持一個可撤銷編輯單位。既有合法 source 未改內容時保持表示，不強制降低 marker 層數或全篇重排。

### 邊界 escape 與原樣反斜線

已接受的簡寫是 {\{...\}} → {...}。**撤回前版對整個 value 解码三種 escape 的提案**：不把一般 \\ 改成一根反斜線，不把 \n／\t 變成控制字元，也不全面替換 value 中間的 \{／\}。

已接受的局部定界規則：

- Inline opener 後緊接的一串 \{ 是 leading-brace escape，每組得到一個 {。
- Inline closer 前緊接的一串 \} 是 trailing-brace escape，每組得到一個 }；只有整串後面確實還有 n 個右括弧可作 closer 時才成立。先識別這個完整 suffix，再按普通 closer 處理，不能先全域 unescape。
- 其他反斜線逐字保留。特別是 {\} 中沒有多餘右括弧可構成「escaped value＋closer」，所以值是一根反斜線；{\}} 才是值 }。未閉合仍依最後的確定性 token 規則報錯，不根據想像的作者意圖補字。
- 若真正 value 自己就以 \{ 開頭、以 \} 結尾，會與這個 shorthand 撞形；使用 raw block 可逐字保存，不另加全面的 \\ escaping。這是罕見 compact 表示的限制，須在 editor／診斷說清楚，不靜默吃掉反斜線。
- **Block literal 不解碼任何反斜線 escape**，直接保存 value；增加 marker 層數與結構換行已提供無損表示。Inline 與 block 共用一份 profile，但 lexical mode 明確。

~~~text
source {C:\temp}           → value C:\temp
source {\\server\share}    → value \\server\share
source {\}                → value 一根反斜線
source {\}}               → value }
source {{a \{x\} b}}      → value a \{x\} b
~~~

最後一例中的 escape 外觀在 value 中間，保留反斜線；n=2 避開其中單個括弧。本輪使用者已選擇整組 rc.3 作 S1 基準，以上邊界優先序隨之接受。

## 4. 多行 literal：JSON 原文與 marker 分行

JSON 首尾的括弧與 marker 用換行隔開；JSON 裡的括弧靠較長 marker 避碰，內容不加 escape：

~~~grasp-demo
@code{
    @Config = {{
{
  "name": "Grasp",
  "path": "C:\\temp",
  "pattern": "\\{x\\}"
}
    }}
}
~~~

此例 JSON 最長連續括弧為一個，所以 marker 用兩層。JSON 自己已有的 backslash 逐字保存，不由 Grasp 先行解碼。若緊湊 JSON 出現 }}，marker 改三層以上即可；換行解決邊界黏合，不取代內部 delimiter 避碰。

多段落預設單層即可：

~~~grasp-demo
@code{
    @Description = {
第一段。

第二段。
    }
}
~~~

沿用已接受的 mark 行規則：opener 後只有 space／tab 再接 EOL 時是 block；opening padding 與第一個 EOL 是結構。Closer 在後續行的行首或水平縮排後；closing indentation 與前一個 EOL 是結構。只移除這兩個邊界 EOL，重合時一次；保留其餘內容行空白、空行與原 EOL，不 general trim／dedent。

因此 Description 的值是第一段、空行、第二段，不附帶額外首尾換行。要保留首尾換行就在 value 內另留空行。{   } 的三個 inline 空格仍是內容。Serializer 必須避免 value 的 lone CR 與結構 LF 合併；這是 codec 往返責任。

對任意有限字串，block 以大於所有 raw brace runs 的 n 加上結構換行，即可不改 value 表示；包含 \{／\} 也不例外。首尾括弧可選 inline boundary escape 或 block；不為 pipe 內容強制換行，也不需要 JSON parser 介入。

## 5. Code block 的 parsing allowlist

Workspace 持久設定的起始值：

~~~json
{
  "graspParsing": {
    "enabledFenceLanguages": ["", "grasp"]
  }
}
~~~

空字串代表未標語言。清單可修改；不要求使用者改 parser code。首輪設定 UI 提供清單編輯及套用影響提示，不只是藏在程式常數裡。

| Markdown context | 起始行為 |
| --- | --- |
| 一般正文 | 依 Grasp 語法辨識 Region／managed references |
| 無語言 fenced block | 啟用 Grasp parsing |
| grasp fenced block | 啟用 Grasp parsing |
| json、grasp-demo、其他未列出語言 | 整塊停用 |
| inline code、indented code、frontmatter、HTML attributes／blocks、link destination | 預設停用新的 binding；managed reference destination 只作既有 reference 的名稱欄位 |

「啟用 parsing」仍須匹配 Grasp 語法；首輪仍寫 @code{ ... }，不把 grasp fence 自動視為另一種可省容器的 assignment grammar，也不執行真實程式。Enabled fence 中的 managed references 可辨識／更新；literal value 與 reference 的 cached value 內不再遞迴建立定義。Disabled fence 中不建立 definitions、references、dependency edges，也不作 rename／cache 回寫；它是完整展示區，不只是停止計算。

Scanner 按當前宿主 context 辨識 fence 的真正範圍；已成功辨識的 Grasp literal／reference value 為 opaque，不因內容看似 fence 而二次切割。CommonMark 使用相同字元、至少同長的 closing fence；info string 的首詞通常作語言，但規範不強制它的意義。**以下 allowlist 行為是 Grasp 政策**：取 info string 第一個空白分隔詞，以 ASCII lowercase 比對清單；grasp-demo 不是 grasp 的 prefix match，grasp extra 取 grasp。空 info string 取空字串。語言標籤的正規化不影響 identifier 大小寫。[CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)

Disabled 外層 fence 永不遞迴啟用內部看起來像 grasp fence 的文字。展示完整含三個 backticks 的示例時，用四個或更長的 grasp-demo 外層 fence；若 literal 要含 Markdown fence 原文，可放在足夠長的 enabled grasp 外層 fence，使內部短 fence 保持內容。

Grasp Region 不可跨越其所屬可解析宿主範圍的真正 closing fence 去吞掉另一塊停用示例。Enabled fence 的外層 delimiter 限定範圍；正文中已成功辨識的完整 literal／reference span 為 opaque，其 value 內的假 fence 不開啟新的宿主區域。未成功閉合的候選不得藉這項優先序越過已識別的停用區。未闭合在該可解析宿主範圍結尾產生診斷；普通跨段落 Region 可以在同一可解析正文範圍內延續。宿主語法的 list／quote prefix 和縮排保留 raw offset 映射，不以全篇 trim 或 Markdown rendered text 作權威來源。

### 修改清單如何影響既有定義

Allowlist 改變可能使既有定義消失或新增；不是單純上色設定。預覽將受影響的 Note／definitions，再套用設定与重解析的共享交易，確認同 namespace 重複、missing 等結果。Policy revision 參與 prepare／parse cache 的版本核對，舊結果不能回寫；取消或失敗保留原設定與原 committed state。

政策配置隨 workspace 保存，syntax version 與 policy revision 分開，export／restore 保存解析所需設定。普通 workspace 同時只有一份現行政策；不允許每個 editor 自作不同解讀。

## 6. 正文 Reference codec：多段落與局部定界

兩種 reference 保留完整 logical value、真實 LF／CRLF／CR、空白及 raw UTF-16 ranges。S1 採 canonical wiki separator `|`，不加入舊版相容 adapter。Reference escaping 與 brace literal 不同：value 內只接受 `\\`、`\[`、`\]`、`\|` 四種局部 escape，解碼後各得到一個對應字元。Serializer 對這四個保留字元作可逆編碼，不能 general unescape 或把換行改成 `\n`。

Pure reference 的第一個未 escape `]` 必須立即接 `(:ref:QualifiedName)`；wiki reference 的第一個未 escape `]` 必須再接 `]`。Value 內未 escape 的 `[`、非法 delimiter、unknown escape、名稱不合法或未閉合都保留原文與診斷，不建立可回寫 occurrence；不能跳過壞 closer 找更後面的合法 suffix。Scanner 向前恢復，不以整篇 regex 回溯。

成功辨識後的整個 occurrence 是 opaque；cached value 裡看似 definition／reference／fence 的文字不建立新語意。UI 解碼並呈現值，也不重新啟用 Grasp parsing。多段落需由 Grasp range/rendering adapter 處理，不假定普通 Markdown link AST 可跨空行。

~~~grasp-demo
[第一段。

第二段。](:ref:Description)

[[@Description|第一段。

第二段。]]
~~~

以下兩種表示同一個 value：`a]`、真實換行、`b|c`、一根反斜線。

~~~grasp-demo
[a\]
b\|c\\](:ref:X)

[[@X|a\]
b\|c\\]]
~~~

這部分沿用新版 repository 內歷史 binding contract 的可用 reference insight，升為本次 S1 明示契約；歷史 literal grammar、授權與全面禁止 code parsing 不沿用。只加入本次相關的小型 fixtures，不重跑舊 M1 平台。

## 7. 維護與替換 syntax 的實作邊界

~~~text
MarkdownContextScanner → ParsePolicy → BindingSyntaxProfile
    → lexer / parser → syntax-independent Binding AST
    → identity resolution / dependency graph / ValueEngine
~~~

| 層 | 責任與限制 |
| --- | --- |
| Markdown context adapter | Fence／inline code 等宿主範圍、語言標籤、raw source mapping；不求值 |
| ParsePolicy | 按 workspace 設定產生 enabled spans；不是一大段可由使用者任意拼 regex 的 grammar |
| Syntax profile／codec | 集中保存版本、tokens、有限 escapes、lexer／parser／serializer；回傳診斷與 source ranges |
| Binding AST | 定義名稱、literal logical text、ordered concat parts、dependency name；不讓 {{ 或 <| 滲進 graph／SQL／DTO |
| Binder／ValueEngine | 名稱解析、identity、duplicate／missing／cycle／增量計算；不依賴某種 delimiter |
| Editor adapter | 配對、highlight、local diagnostics、局部修補；Host 為 authoritative parsing，不維護第二套自主產品語義 |

Grammar 小，先使用可讀的狀態掃描器／遞迴下降結構與小函式，避免一條巨大 regex；不為未来可能換符號建立 parser-generator 平台。Core 內的 Syntax 子模組即可，不先拆更多 projects。

Source ranges 以 .NET／JS 一致的 UTF-16 offset、raw source revision 定義；literal escape、EOL、宿主 prefix 都保留映射。Config revision 與 syntax version 是 parse／prepare fingerprint 的一部分。背景 parser 可取消，結果附基底版本；UI 不同步等待後端解析，沿用實作計畫的局部更新與 stale result 拒絕。

換 marker 主要變動 codec／editor affordance，資料 migration 仍不能假裝零成本。既有 raw source 按記錄版本讀取，需轉換時先預覽，保留 IDs、logical values、composition、cached values、來源與 fallback；不能把舊 pipe 文字直接用 brace grammar 重讀。首輪只實作批准的一份可寫 profile；歷史 import adapter 按實際需求另做。

## 8. 錯誤、即時更新與有界驗證

退出編輯立即 flush 最後有效文字並觸發更新，不等 idle debounce；IME composition 正常結束後送出最终 snapshot。錯誤或未閉合保留最新原文及可恢復 draft，不發布部分 definitions，不把 last committed 值標為最新成功。完整語法的 missing／cycle 保存帶診斷 state。S2 起原文保存、語意接受及跨檔回寫按現行架構分開追蹤：DB 內短交易與檔案 journal／guards 各自驗證，不宣稱 Note source 與所有引用檔案同時 ACID 提交。

使用者已授權 P0–S4 實作；語法沿用已接受 profile，實際完成與驗證結果以 EXECUTION-STATE 為準。使用一個小型 table-driven fixture 集：兩筆無分號定義／缺 operand、ASCII／dot whitespace、pipe、brace／backslash、empty／多行 padding、四種使用者指定 fence、disabled 外層、未閉合、政策切換與 round-trip。數量隨具體反例增加，不做無限 syntax 組合測試。S1 從 UI 操作同組核心例子並重啟，確認展示區沒有意外建立資料。

## 9. 接受狀態與維護

2026-10-03 使用者已整體接受 rc.3 profile，並明確授權實作 S0–S1；ASCII／大小寫、點號無空白、@ 左側、無分號、外層 @code、marker 疊層、空值、局部 escape／raw block、code fence allowlist 均不再重問。本文 rc.5 沿用該 profile 與 reference／宿主掃描明確化，同步 Markdown authority 及 Records 原文邊界，不新增另一套手寫語法。

實作、必要驗證與使用者接受分開記錄。若新反例會改變同一原文的產品含義，先提出精確 input／expected value 與最小調整；普通 codec 結構、錯誤復原與測試安排由工程自行處理。當前 Goal 接續至 S4；新增 Records 屬性投影不授權任意程式執行或另造一般求值語言。
## Records 的原文解析邊界

S4 自動屬性是來源為欄位正文的 definition，名稱為 `RecordKey.FieldKey`，不是另一套手寫 binding 語法。欄位原始 Markdown 依本文件的 context／policy 解析，reference 相依參與欄位結果；求值輸出、literal 或 cache 不重新掃描。屬性 serializer 回寫原欄位正文，不能套用 literal marker serializer；格式與型別規則由現行 Seed／Architecture 維護。
