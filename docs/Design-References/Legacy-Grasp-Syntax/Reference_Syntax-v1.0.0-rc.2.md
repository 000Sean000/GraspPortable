# Reference Syntax

Version: 1.0.0-rc.2  
Updated: 2026-09-13  
Status: Review candidate；與 Definition rc.2、Config rc.1 配套閱讀。

## R01. 用途與文件分工

本文件定義三種 managed reference 的形式、rendered value 與 identifier mapping、comment representation、nested structure，以及 Markdown boundary／escaping。

Reference 的資料模型是 string formatting 與 variable reference operation：原文保存可讀的 rendered value 及 identifier。某個 occurrence 是否具有提出共用新值或覆寫其他來源的權限，不由其形式決定；見 Config C03。

| 文件角色 | 閱讀目的 |
| --- | --- |
| [Markdown Extension Definition](Markdown_Extension_Definition-v1.0.0-rc.2.md) | Identifier grammar、syntax tag、statements、code context、string 邊界 |
| 本文件 | Reference 的形式、結構、mapping 與語法驗證 |
| [Markdown Extension Config](Markdown_Extension_Config-v1.0.0-rc.1.md) | 權限、值處理、更新與 migration 政策，及三份文件的版本索引 |

本文件中的語法例子用來展示 parsing 與結構，不暗示其中任何來源自動具有最高權限。

## R02. 共通術語與辨識

Rendered Value 是 reference 中可閱讀的值；Reference Identifier 是其 canonical identifier；Occurrence 是該 reference 的一次出現。Parser 同時保存 raw source、logical value、identifier、kind、context 與來源位置。

Reference Identifier 遵守 Definition D04 的 Qualified Identifier grammar，大小寫嚴格；可包含 namespace／class／instance／property 前綴。解析不依名稱的自然語意猜測，也不因 alias 好讀就自行改換 identifier。

Reference family 共三種。Comment 內外的 representation 不另形成第四種。

辨識候選形式、判定語法有效，以及允許修改是不同步驟。Identifier 不合法、mapping 不完整或 context 錯誤時保存診斷，不把解析失敗的片段當成可改寫 occurrence。

## R03. Pure Variable Inline Reference

用於不需要實體 note target 的 variable reference。

```md
[value](:ref:Identifier)

[apple](:ref:Fruit)
```

`apple` 是 rendered value；`Fruit` 是 canonical identifier。此形式借用 Markdown inline link 的 label／destination：label 承載 value，destination 承載工具識別資訊。

只有 destination 以 `:ref:` 開頭且結構完整的 inline link，才屬此 managed reference family。`:ref:` 與 identifier 之間及 destination 內部不含空白；canonical form 直接使用 `(:ref:Identifier)`。

以下例子不符合這個 managed form：

```md
[apple](https://example.com)
[apple](ref:Fruit)
[apple](ref: Fruit)
[apple]( xx ref: Fruit)
```

第一行是普通 Markdown link；其餘缺少所需的完整 destination 結構。不能因 destination 中某處含有 `ref` 字樣就將它改寫。

Label／destination 的宿主顯示及點擊觀察保留在 Config C07；那些觀察不是 reference 權限規則，也不是所有 editor 版本的保證。

## R04. Managed Wikilink Reference

用於 variable 同時需要實體 note target 與其 navigation／backlink／graph 關係。

```md
[[@Identifier|value]]

[[@Fruit|apple]]
```

```text
Rendered Value       = apple
Reference Identifier = Fruit
Obsidian target      = @Fruit
Target filename      = @Fruit.md
```

Target 使用前導 `@`，alias 承載 rendered value。`@` 是此實體 target／filename 的一部分，parser 取得 canonical identifier 時只移除該 marker。

本形式有 alias separator，value 可為空。普通 `[[Fruit|apple]]` 是 legacy migration 的候選來源，不是現行 managed form。沒有 alias 的 `[[@Fruit]]` 仍可作 file link，但不因此自動產生本規格的 value observation；是否因 file rename 而產生該連結，屬 Config C06 的工具操作。

Table context 使用 escaped separator，見 R10。實際檔案存在與否屬 target resolution diagnostic，與 reference 字面形式分開檢查。

## R05. Grouped Positional Reference

將同一 formatted string 的一個或多個 identifiers 集中放在 signature：

```md
{normal string [value] normal string [value]...}%%(ref: Identifier, Identifier, ...)%%

{An [apple] a day, keeps [doctor] away.}%%(ref: Fruit, Person.Job)%%
```

`{...}` 是 formatting group；`[value]` 是 slot；正文的 `%%(ref: ...)%%` 是 signature。以上 slots 依序對應 `Fruit`、`Person.Job`。

Slots 與 identifiers 數量必須相等；只按出現順序配對。數量不符或 signature 不完整時，整組 mapping 無效，不能只配對前面幾項後寫回。空 slot 仍占一個位置。

Slot boundary 規則見 R09；comment code representation 見 R06。

## R06. Comment Code Context 中的 Reference

RHS 可以使用三種完整 reference forms；plain string 的邊界由 Definition D07 決定。裸 `@`、identifier、dot path 或引號不自行建立依賴，這是本閱讀稿沿用 rc.1 的語法。

正文的 grouped form：

```md
{An [apple] a day.}%%(ref: Fruit)%%
```

Extension comment code 已有外層 `%% ... %%`，其 grouped signature 省略內層 `%%`：

```md
%% @code
@Slogan = {An [apple] a day, keeps [doctor] away.}(ref: Fruit, Person.Job)
%%
```

單行形式：

```md
%% @Slogan = {An [apple] a day, keeps [doctor] away.}(ref: Fruit, Person.Job) %%
```

兩種 context 的 positional mapping 相同。Comment code 內再放 `%%(ref: ...)%%` 會與外層 boundary 衝突，不是有效 representation。

Pure Variable Inline Reference 與 Managed Wikilink Reference 沒有這層 signature comment，因此 RHS 沿用各自形式：

```md
%% @Sean.job = [doctor](:ref:Person.Job) %%
%% @Sean.job = [[@Person.Job|doctor]] %%
```

Value 裡的 `@` 仍按其所在 value 位置解析，不改變 identifier 配對。一般 comment 的文字、展示用途的 inline code／code fences，不能只憑看起來像 reference 就當作可維護的正文 occurrence。

## R07. Value Observations 與未填 Slots

每個有效 occurrence 保存其 identifier、logical value 與來源角色；grouped form 的每個 slot 各自保存一筆 observation。將它納入 assignment candidates 的資格與權限由 Config C03 決定。

```md
[apple](:ref:Fruit)
[pear](:ref:Fruit)
```

Parser 可確定這裡是同一 identifier 的兩個不同 value observations。哪一處是權威值、哪一處為過期顯示或待裁定候選，要在 policy 明確後才可判定；不能把「不同文字」直接等同於所有來源權限相同。

以下具有空的 value，仍可形成完整語法與 mapping：

```md
[](:ref:Fruit)
[[@Fruit|]]
{An [] a day.}%%(ref: Fruit)%%
```

是否把空白當作未填、是否補值、從哪個來源補值，分別依 Config C04 與 C03。未填值與語法錯誤不同；不因空值而刪除 grouped slot 或改變 identifier 順序。

## R08. Nested Reference 與結構保存

### 組成與展開

Nested reference 表示某個 identifier 的 value 由固定文字與其他 identifier 的 values 組成。結構來自 binding，不來自引用位置的額外 marker。

```md
%% @code
@Slogan = {An [apple] a day, keeps [doctor] away.}(ref: Fruit, Person.Job)
%%

There is a slogan [An apple a day, keeps doctor away.](:ref:Slogan)

{[doctor] said [An apple a day, keeps doctor away.]}%%(ref: Person.Job, Slogan)%%
```

`Slogan` 的結構可描述為：

```text
literal "An "
reference Fruit
literal " a day, keeps "
reference Person.Job
literal " away."
```

上面是模型說明，不是另一套可寫入筆記的 statement syntax。Binding 裡的兩個 slots 分別保存 Fruit／Person.Job observations；外層引用保存已展開的單行文字。

三種 references 仍保持各自形式；例如有實體 target 時：

```md
[[@Slogan|An apple a day, keeps doctor away.]]
```

每個引用位置不必重複整份 nested 定義。

### 結構不變條件

工具先登錄 identifiers、bindings 與 occurrences，再解析依賴。Resolved formatted value 由有效的依賴值與 literal fragments 組合；cached 展開文字不能取代其 composition definition。

缺少 dependency、value dependency cycle 或尚未解決的裁定使結果無法確定時，保留結構及診斷，不用空值冒充已解析結果。普通筆記的 link cycle 與 value dependency cycle 是不同關係。

展開文字與既有 composition 不相容時，工具應能呈現文字、binding、literal fragments 與 dependencies 的差異。是否允許從該 occurrence 提出修改，由 Config C03 決定；獲准後若無法唯一映射回結構，依 C05 交由使用者裁定，不猜測哪個 slot 應被改動。

### Migration 必須保存的資料

Legacy target 含 nested wikilinks 時，僅留下展開文字會失去 literal fragments、dependency identifiers 及 mapping。以下例子預先具有明確 identifier 對應：

```text
Slogan → Slogan
Fruit → Fruit
Person.Job → Person.Job
```

Source note：

```md
[[Slogan]]
```

Target note：

```md
# An [[Fruit|apple]] a day, keeps [[Person.Job|doctor]] away.
```

需要保存的 binding 與 reference：

```md
%% @Slogan = {An [apple] a day, keeps [doctor] away.}(ref: Fruit, Person.Job) %%

[An apple a day, keeps doctor away.](:ref:Slogan)
```

此例的 heading 作為原始容器，實際 extraction 須保留可解釋的前後對應；未知 Markdown 結構不靠全面 strip／trim 猜測。原 target 的名稱不合法或 mapping 未定時，呈現問題，不能從顯示詞 `apple` 擅自推導另一個 identifier `Fruit`。

Binding 必須保存在後續可解析的正式筆記中。只存在 report、cache 或記憶體不算結構保存；保存目的地、review、FileDelete 的相依及失敗復原，集中在 Config C06。

## R09. Slot Boundary Safety

### 相鄰中括號與 Markdown reference-style link

以下文字在文件含 reference definition 時，可能被宿主當作 reference-style link：

```md
[apple][fruit]

[fruit]: https://example.com
```

第一組是 link label，第二組是 reference label，不再是兩個獨立 rendered slots。因此 grouped slots 不直接相鄰：

```md
{[apple][doctor]}%%(ref: Fruit, Person.Job)%%
```

上面不是有效 canonical slot boundary。需加入 separator，且連同 surrounding text／reference definitions 檢查，避免只看局部字串。

### Canonical separators

使用空白、一般文字、`-` 或所在 context 不會建立其他 Markdown 結構的標點：

```md
{[apple] [doctor]}%%(ref: Fruit, Person.Job)%%
{[apple]-[doctor]}%%(ref: Fruit, Person.Job)%%
{[doctor] said [An apple a day, keeps doctor away.]}%%(ref: Person.Job, Slogan)%%
{[city], [country]}%%(ref: Address.City, Address.Country)%%
```

`_`、`*`、`**`、`__`、`~`、backtick 不作為直接連接兩個 slots 的 canonical separator；以下形式都不作 canonical 輸出：

```md
{[value]_[value]}%%(ref: A, B)%%
{[value]*[value]}%%(ref: A, B)%%
{[value]**[value]}%%(ref: A, B)%%
{[value]__[value]}%%(ref: A, B)%%
{[value]~[value]}%%(ref: A, B)%%
{[value]`[value]}%%(ref: A, B)%%
```

這是 slot 結構限制，不是刪除 value 中合法標點的理由。一般 renderer 不支援標記隱藏，也不等同 identifier 或已保存資料失效；診斷與相容政策見 C07。

## R10. 表格與 Escaping

### Wikilink alias separator

Parser 辨識以下兩種 representation，取得相同 logical identifier／value：

```md
[[@Fruit|apple]]
[[@Fruit\|apple]]
```

`\|` 可承載 escaped alias separator；這個反斜線不是額外的 canonical identifier 或 value 字元。保留 raw source 與 logical fields，不能全域移除反斜線。

Table cell 輸出 managed wikilink separator 時使用 `\|`，非 table context 使用 `|`。Scanner 辨識既有 escaped separator 不以 occurrence 必然位於 table 為前提；同時記錄 context 與原 separator 是否 escaped。

Pure Variable Inline Reference 沒有 alias separator；若 value 本身含 pipe，仍須按 table cell context 處理。不能把「沒有 alias separator」解讀為所有 pure references 都不需 escaping。

### Value 的其他邊界

Value、slot、group 與 identifier 的 delimiter 角色須保持可區分。遇到無法可靠判定的 bracket、comment delimiter 或未定 escape 組合時，保留 raw text 與診斷，不憑替換所有特殊字元產生看似合法的結果。本規格未聲稱已定義全部 Markdown token grammar／error recovery。

### 輸出層次

實際筆記依 occurrence context escaping；Markdown report 顯示語法時另外遵守所在 report context；JSON string 使用 JSON escaping。Report 的額外 escape 不能寫回 note replacement 或污染 logical value。Report 預設呈現方式由 Config C07 決定。

## R11. Validation 與非 Managed 內容

Validation 至少分開報告：

- Identifier grammar 與 source position。
- Reference family、完整 boundary 及 code／prose representation。
- Slot 數量、順序及 canonical separator。
- Logical value、binding structure、dependency 與可解析狀態。
- Config 版本、authority／value policy 是否足以定案與產生修改。

以下片段本身不構成本文件的 managed reference：

```text
[value]
[label](url)
[[Identifier|value]]
[foo][bar]
@Identifier
[[@Identifier]]
```

Extension statements 由 Definition 的 code-context parser 識別；legacy wikilink 是否需要 migration，由 Config C06 與應用程式 planner 判斷。兩者不改寫現行三種 reference grammar。

## R12. 本輪修訂範圍

Reference 的 assignment 資格／優先權從核心移到 Config C03；未填值／值比較移到 C04；結構衝突裁定與更新移到 C05；遷移操作移到 C06；宿主行為觀察與 report 偏好移到 C07。

三種 forms、mapping、nested 資料結構、comment representation、canonical separators 及 escaping 仍完整保留。舊文件替代與差異清單見 Config C09。
