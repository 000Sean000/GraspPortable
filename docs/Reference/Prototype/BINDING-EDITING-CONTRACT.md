---
title: Binding and Reference Editing Contract
status: planning-baseline; implementation and M1 verification pending
updated: 2026-09-27
scope: parsing, serialization, source fidelity, multiline and editing
---

> 歷史參考副本｜來源：[`master@5ca1373` 的 docs/BINDING-EDITING-CONTRACT.md](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/BINDING-EDITING-CONTRACT.md)。
> 本文的狀態、授權、next step、方法與測試結果屬舊 Prototype；新版工作範圍見 [重寫狀態](../../EXECUTION-STATE.md)。以下保留來源內容，僅將相對 Markdown 連結轉成固定來源連結。

# Binding and Reference Editing Contract

本文件保存已接受決策與待 M1 驗證的候選 contract，不是 codec／產品完成證據。Authority 是 [Project Seed](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/Project_Seed/README.md) 指向的 rc.3 文件及使用者最新明確決策；目前有效授權及實作證據見 [Working State](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/EXECUTION-STATE.md)。整體範圍見 [Goal Plan](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/GOAL-PLAN.md)。共享修改的一致性細節另見 [Shared Value Contract](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/SHARED-VALUE-CONTRACT.md)。

## 1. 已接受與待驗證的界線

**Seed 與使用者已接受：**

- Assignment 是 binding，可自然分布在 Note 可解析的位置，不要求固定 section、comment、`@code` 或 outer container。
- Binding 採 raw literal、literal 外 identifier 取值與 `+` 串接；composition 保留 ordered fragments 及 dependencies。
- 正文只有 `[value](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/:ref:Identifier)` 與 `[[@Identifier|value]]`；不新增第三種 grouped／multiline reference。
- Statement 可由 EOL、EOF 或下一個完整 binding 結束；`=` 或前一行末尾 `+` 後容許 expression 跨行；同一行接普通 prose 使用 `;`。
- Link 是視覺考量，語意正確優先。形成 outer Link、隱藏 markers 或在外部 Markdown 原樣 render，不是硬性 gate。
- Export 可以轉為宿主可讀 blocks、實際 links／anchors，並保存重建 metadata。不能為視覺效果犧牲完整 value、identity 或 binding structure。
- Raw source、logical value、composition、occurrence、cached value 及版本分開；DB 是 Grasp runtime authority。

**本文件提出、尚待 M1 驗證及必要的語法接受：** empty 優先、精確 marker level、block EOL 邊界、reference 局部 escaping、candidate scanner／error recovery、source mapping 及 editor marker 行為。

Multiline 必須做到 unambiguous parse、完整 value、不誤吞其他正文、Obsidian 可讀輸出及完整 rebuild。現有 host AST 反例仍是有效證據，但只否定「外部 renderer 能透明容納任意 multiline link」的假設，不能再以沒有 outer Link 為由單獨停止整個語意方案。測試範圍見 [Reference Host Gate](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/REFERENCE-HOST-GATE.md)。

## 2. Binding statement 與 expression

```text
說明：@Fruit = <|apple|>; 接著說明。
@Fruit = <|apple|> @Person.Job = <|doctor|>
@Slogan =
<|An |> + Fruit +
<| a day, keeps |> + Person.Job + <| away.|>
```

`=` 與第一個 atom 之間的排版空白／換行不是 value。Opening delimiter 與 `=` 同行或跨行不改語意。

完整 atom 後的同行 `+` 要求下一個 atom，`+` 後可換行。完整 expression 遇 EOL 即結束；下一行 `+ item` 不回頭續接，而保持一般 Markdown 內容。

下一個完整 `@Identifier =` 只在 literal 外辨識。Literal 內的相同字樣、分號、引號、Markdown、反斜線、`+`、`=` 都保持內容。沒有 implicit concatenation，相鄰 literals 仍需 `+`。

`@Name = First Last` 診斷缺少 `+` 或 `;`，不能發布 `First` dependency 再把 `Last` 當 prose。`@A =`、`@A = <|x|> +` 是 incomplete，不等於空字串，不發布部分 expression。

工程建議是以 token boundary 和完整 identifier／`=` 候選辨識起點，避免 email／普通文字中段誤啟用。Qualified identifier 應按明示 syntax version 驗證；舊實作較寬的 regex 不能無聲成為新 contract。Markdown context discovery 與 binding expression codec 分開。

M1 以 [Definition rc.2 D04](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/Design-References/Legacy-Grasp-Syntax/Markdown_Extension_Definition-v1.0.0-rc.2.md) 的候選名稱規則作明示基底：`QualifiedIdentifier = IdentifierSegment ("." IdentifierSegment)*`，`IdentifierSegment = [A-Za-z_][A-Za-z0-9_]*`，大小寫嚴格，`@` 不是名稱本身。這是候選 grammar 的選定實驗輸入，不是把舊資料中的連字號名稱默默判為無效／改名；v0.2 較寬的名稱只能經 legacy adapter／review 保留與轉換。若要改 accepted character set，記錄版本和同 input 的差異，不能透過隱藏設定決定。

## 3. Raw literal lexical 候選方案

### 3.1 Marker level 與 empty

一般 opener 是 `<` 加完整連續 pipe run，level 是該 maximal run 的長度。Closer 前整段連續 pipes 必須恰等於 level，較長 run 的 suffix 不能當 closer。

Empty 特例先於一般 opener：`<` 後偶數 pipe run 若立即接 `>`，整段為空 literal。`<||>` 是 level-1 empty，`<||||>` 是 level-2 empty。因此 `<||x||>` 唯一解讀為 level 2、value `x`，不能同時解讀為 level 1、value `|x|`。

這個 empty 優先規則是公共語法選擇，尚非已實作的既定事實。它也表示某些高層 inline opener 加上以 `>` 起頭的內容會碰到 empty token；serializer 必須避免產生該 representation。

推薦 canonical serializer：空值用 `<||>`；安全的 level-1 單行值用 compact form；其餘採 block form，選沒有內容 closer 碰撞的最小 level。首尾是 pipe 的 value 也採 block form，避免與 marker 合併。不以全域 backslash escape／unescape 修改 raw literal。

### 3.2 Block、縮排及 EOL

推薦 compact form 保持同一實體行。Block 的 opener 後立即接 EOL；closer 在後續行開頭，可有 closing-line 排版縮排。該縮排屬結構，其餘內容行空白全部保留，不做 general dedent。

Opener 後一個 EOL 與 closing line 前一個 EOL 是結構 token；empty block 若兩者指向同一 EOL，只移除一次。額外首尾 EOL 是真正 value。內容中的 LF、CRLF、lone CR 原樣保留，不默默轉成 LF。

以下使用 JSON string 記法顯示 source 字元及 expected value；不是 raw literal escape syntax：

```text
source "<|\n|>"                  → value ""
source "<|\n\nx\n\n|>"           → value "\nx\n"
source "<|\r\n\r\nx\r\n\r\n|>"   → value "\r\nx\r\n"
source "<|\nx\r\r\n|>"           → value "x\r"
```

**Lone-CR 邊界必測：** value 若以 lone CR 結尾，直接附加 LF 結構 suffix 會合併成 CRLF，解析時可能誤刪原 CR。Serializer 應改用不合併的結構 EOL，例如 CRLF。結構 prefix 為 lone CR、value 以 LF 起頭時也有同類問題。排版偏好不能高於 logical round-trip。

Literal 一旦完整辨識，其內容 opaque；不能把其中 fence、reference 或 `@B =` 再解析為其他語意。未閉合時保存 raw／diagnostic，不靠新 binding 字樣猜測 literal 結束，也不發布部分成功結果。

## 4. 兩種正文 reference 的候選 codec

### 4.1 Logical model 與局部 escaping

Occurrence 保存 kind、canonical identifier、完整 logical cached value、raw representation、source range／revision；cached value 不代替 binding composition，也不取得來源定案權。Reference 的值內出現另一種 reference 外觀，仍只是該 cached value 的文字，不自動增加 dependency。

候選 canonical serializer 只在 value 欄位 escape 四種 delimiter 字元：

```text
logical backslash  → source \\
logical [          → source \[
logical ]          → source \]
logical |          → source \|
```

其他字元、空白及真實 LF／CRLF／CR 原樣保存，不使用 HTML `<br>` surrogate，不 flatten。這組 escape 不套用到 raw literal、identifier 或一般正文。

Canonical wiki separator 使用 `|`；既有 `\|` separator 可由明示的 compatible representation adapter 辨识。它與 value 內 escaped pipe 必須按欄位位置區分，不能全域 unescape。未知 escape／未辨識版本保留 raw 和 diagnostic，不猜測刪除 backslash。是否接受特定歷史 noncanonical representation，由版本化 import adapter 決定。

### 4.2 Candidate scanning 與 termination

候選 scanner 必須以單調前進的游標處理 source，不能使用跨整篇的寬鬆 regex 尋找某個更晚的 closing token。

- Pure form 從 `[` 開始，按上述 escape 規則讀 value。第一個 unescaped `]` 必須立即接完整 `(:ref:QualifiedIdentifier)`，才構成有效 occurrence；不能跳過第一個不合法 closer 去找後面的合法 suffix。
- Wiki form 從 `[[@` 開始，讀合法 identifier 和明示 separator，再讀 value。第一個 unescaped `]` 必須立即接第二個 `]` 才可結束。
- Value 的 literal brackets／pipes／backslashes 必須用已定義 escape。Value 中未逃逸的新 `[` 或其他非法 delimiter 使候選失敗，不能吞入下一個獨立 reference 再借用其 closer。
- 成功後 `to` 精確停在 pure form 的 `)` 或 wiki form 的第二個 `]` 後；後續 prose、下一個 occurrence 或換行不屬於該 occurrence。
- 未閉合／未知 escape／invalid identifier 不產生可維護 occurrence；保留 source、錯誤位置與原因。Recovery 應從明確的失敗 token 向前進，不反覆重掃，也不把錯誤區域的 cached text 自動用來更新共享值。

有完整 opener／closer 的 multiline 字串可能包含一般 prose 字樣，parser 不能猜作者是否打錯。安全契約是按確定 grammar 取得 exact range、呈現診斷及 span，且不作猜測式 write-back；「不誤吞正文」的具體驗收包括後續獨立 reference、literal bracket、缺 closer、普通 link、下一段正文及 malformed input 的 recovery。

### 4.3 Markdown contexts

Semantic candidate spans 與 Markdown host rendering 分層。有效 occurrence 先作完整 opaque span，不能先讓一般 parser 按 blank line 或 table pipe 切碎，再宣稱已保存 value。

Paragraph、heading、list、blockquote、table 都列入 M1 context matrix；不以新增 outer container 規避。在 code／link destination／HTML attribute／metadata 區是否啟用，須由明確 context 規則約束；真正 code／展示內容不因字樣相似而變 binding。List／blockquote prefix 如何映射到 raw content，也須以 exact offsets 驗證，不能直接 strip 全文。

Table 或 multiline canonical source 不承諾在外部 Markdown 原樣 render。Grasp editor adapter 負責自己的呈現；export adapter 可輸出可讀 blocks、正常 links／anchors 並保存重建 metadata。Obsidian 可讀與 fresh rebuild 必須分別實測。

## 5. 少量 source → value → dependencies → export 案例

### A. Literal 與 composition

```text
@Fruit = <|apple|>
@Person.Job = <|doctor|>
@Slogan = <|An |> + Fruit + <| a day, keeps |> + Person.Job + <| away.|>
```

`Slogan` value 是 `An apple a day, keeps doctor away.`；ordered dependencies 是 `Fruit`、`Person.Job`。重複 identifier fragments 保留原次序，graph edges 可以另去重。Export 可以顯示結果，但 rebuild 必須保留完整 composition。

```text
@Collision = <||a |> b||>
@LongRun = <|a ||> b|>
@Raw = <|"Q" + Fruit = \path|>
```

依第 3 節候選方案，values 分別是 `a |> b`、`a ||> b`、`"Q" + Fruit = \path`；dependencies 都為空。Export 不把 raw 文字中的 Fruit 變成引用。

### B. 首尾 EOL

```text
@Paragraph = <|

  line

|>
```

LF source 的 value 是 `"\n  line\n"`，dependencies 為空。Export 可顯示 readable block；exact value 留在重建資料，不能為 inline 呈現而 trim。

### C. 兩式完整 multiline cached value

以下 cached value 都是 `a]`、一個真實 LF、`b|c` 加一個 backslash：

```text
[a\]
b\|c\\](:ref:X)

[[@X|a\]
b\|c\\]]
```

依第 4 節候選 codec，兩者 logical value 相同，且都只 reference `X`；不產生新的 binding dependency。Export 可顯示 multiline block 並導航至 X 的實際輸出位置，rebuild 恢復 kind、X、exact value 及原 occurrence metadata。此例尚未有 codec round-trip 實作證據。

### D. 空值及 source 邊界

```text
[](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/:ref:X) 後文。
[[@X|]] [next](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/:ref:Y)
```

前兩個 occurrence 的 cached value 是有效空字串，不等於 unresolved；後文及 Y 保持獨立。Cached observations 不自行授權改變 X 的 shared binding。

## 6. UTF-16 mapping 與 marker UX

所有公開 ranges 使用 raw Markdown 的 UTF-16 offsets、`[from,to)`，並綁定 source revision。Emoji、CRLF、lone CR 不可用 code-point index 或 normalized editor offset 冒充。

Binding 保留 node／name／ordered fragment ranges，以及 literal raw、level、style、logical value、content mapping。Reference escape 會改變 raw 與 logical 長度，必須保存 field-local offset mapping，不能以字數差估算。結構 EOL／closing indent 不得混入 logical range。

Editor normalized line model 經 adapter 映回 raw source；未編輯的 raw 直接保留，語意修改只改 exact spans。`parse(serialize(value)) === value` 不表示應無故 canonicalize 整篇原文。既有 raw-source adapter 可重用，但不是新 grammar 已通過驗證的證據。

Marker UX 目標：完整 opener 可補 matching closer；level 變化只同步仍受 editor 維護的配對。IME composition 期間不移動／插入 marker；paste 以完整 transaction 處理，不逐字觸發 pairing。Undo／redo 同時恢復配對、raw EOL metadata 與選取。手動失配保留文字及診斷，不 aggressive autocorrect。Undo grouping、paired-delete、paste 補對等具體行為須實際操作驗證。

## 7. 共享修改責任

完整交易與外部 review 契約見 [Shared Value Contract](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/SHARED-VALUE-CONTRACT.md)。本 codec 必須提供它所需的 exact ownership／ranges／diagnostics，而不能自行授權來源。

- Draft 與 committed semantic state 分開；incomplete syntax 不發布部分 shared binding。若保存無效 Markdown，舊 cache 只能明示 stale，不能冒充新版本結果。
- 從 reference 修改共享值仍走 semantic command；無法唯一反推 composition 時引導修改 literal／dependency。
- 有效命令完成後，definition、dependencies、受影響結果及持久 caches 屬同一可追溯版本；stale／失敗不提交半套結果。
- Source ranges 隨 workspace／revision 驗證。Rename 依實際 owner 與 exact spans，不全域 replace，也不任意拆 dotted identifier 猜 owner。
- External review 分辨 binding、cache、identifier、普通正文變更；unknown syntax 保留。DB commit 與 filesystem export 分開，cache-only 差異不自行覆寫 shared definition。

## 8. 待 M1 執行的驗證矩陣

| 類別 | 必要 invariant／案例 |
| --- | --- |
| Literal codec | `parse(serialize(value)) === value`；empty、whitespace、quotes、backslashes、marker collisions、Unicode、LF／CRLF／CR、首尾 EOL／pipes |
| Reference codec | 兩式 exact kind／identifier／value；四種 escape、真實 blank lines、empty、ordinary links、未知 escape、embedded reference-like text |
| Exhaustive | 含 `<`、`>`、pipe、brackets、backslash、space、CR、LF 的短 alphabet 全枚舉；記錄實際 alphabet 與上限 |
| Generative | 固定 seed 的較長 Unicode／fragment 組合；literal 與 reference 分層生成；失敗保留 seed、縮減後 counterexample |
| Adversarial | 長 pipe runs、多 levels、未閉合 marker、malformed candidates、長字串；游標保持進展，避免二次方重掃及遞迴溢位 |
| Boundaries | EOL／EOF／下一 binding／semicolon、continuation、缺 atom、missing operator、下一 occurrence／正文不被吞入；失敗無 partial success |
| Mapping／editor | Raw UTF-16 回切、escape mapping、CRLF／emoji、marker pairing、IME、paste、undo／redo、失配不破壞內容 |
| Host contexts | Paragraph、heading、list、blockquote、table、code；canonical opaque ranges 與宿主 AST 不混為一談 |
| Export／rebuild | Obsidian 可讀 blocks／links、分組 anchors、完整 value／identity／composition metadata、fresh reconstruction |

目前 32 個 host 診斷測試只說明現有 AST 行為；它們不是 codec conformance、Obsidian 完整操作或 rebuild 驗證。此文件沒有新增／執行任何 runner。

下一次獲授權的實作應從上述 bounded M1 開始。單純缺少 outer Link 不是拒絕條件；若 exact value、unambiguous boundaries、正文保護或 reconstructability 出現未解反例，保存證據並先解決語義，再接 runtime／DB migration。
