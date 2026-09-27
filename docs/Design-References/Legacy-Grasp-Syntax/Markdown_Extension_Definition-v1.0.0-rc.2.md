# Markdown Extension Definition

Version: 1.0.0-rc.2  
Updated: 2026-09-13  
Status: Review candidate；與 Reference Syntax rc.2、Config rc.1 配套閱讀。權限政策與來源差異的審閱狀態見 Config C03／C09。

## D01. 定位與閱讀順序

此 Markdown extension 在 Markdown 筆記中加入 identifier、reference、value binding 與基本 object data structure，讓同一份本機內容供人閱讀編輯、與 AI 交換，以及由工具解析和維護。檔案仍為 `.md`；「此 Markdown extension」是描述，不另取語言名稱。

筆記原文保存 value、identifier、binding 與引用結構。索引與呈現結果由原文產生；閱讀本規格不需要先讀 GraspAssembly 或 GraspPortable 的實作任務。

三份文件分工如下：

| 文件角色 | 定義內容 |
| --- | --- |
| 本文件 | 共同資料角色、identifier grammar、code context、statements、string 邊界 |
| [Reference Syntax](Reference_Syntax-v1.0.0-rc.2.md) | 三種 reference 的字面形式、mapping、nested structure、context 與 escaping |
| [Markdown Extension Config](Markdown_Extension_Config-v1.0.0-rc.1.md) | 權限、候選值處理、更新觸發、migration 與工具政策；版本索引、修訂及舊文件替代對照 |

閱讀順序為本文件 → Reference Syntax → Config。檔案名稱與版本的集中索引在 Config C01；本節連結只提供導覽，不另定義一套版本設定。

本輪將易變政策從核心移出，不把每項 grammar 都改成 runtime 開關。兩份核心可獨立用來理解及解析資料形狀；要決定哪些來源能定案值或修改其他來源，須再讀取配套政策。

## D02. Markdown 基底與語法邊界

此 extension 使用 CommonMark-compatible Markdown 作正文基底，並借用 Obsidian 的 wikilink 與 `%% ... %%` comment。CommonMark 本身並未因此定義這些 Obsidian 擴充。

設計原則是 source 可讀、明確且可確定解析、少量 syntax tags，以及自然語言與 pseudo code 能一致理解。普通 Markdown 與 extension 結構的角色分開，不因文字相似或 parser 實作方便而賦予未定義含義。

此文件描述資料與 string composition。`@code` 是辨識 statements 的入口；讀到它不代表執行程式。基本 object model 涵蓋 class、instance、property、property path 與 property value binding。Function、loop、condition、method、inheritance 等完整程式語言／OOP 行為屬本規格以外的內容。

Renderer 是否隱藏標記、Live Preview 與跳轉的產品期待，在 Config C07；資料能被正確解析與畫面呈現方式是不同的檢查結果。

## D03. 資料角色與權限分離

| 角色 | 核心含義 | Parser 保存的資訊 |
| --- | --- | --- |
| Identifier | 用來解析與維護對應關係的 canonical name | 原始名稱、canonical name、位置 |
| Declaration | 宣告 class 或 instance-of 關係 | 宣告種類、名稱、class 關係、位置 |
| Explicit binding | 明示某 identifier 與 RHS value／composition 的關係 | LHS、RHS、literal fragments、dependencies、位置 |
| Reference occurrence | 某一處 identifier 與 rendered value 的對應 | reference kind、identifier、value、context、位置 |
| Value observation | 從 binding 或 occurrence 讀取的 value 與來源角色 | 原始／logical value、來源、結構、版本 |
| Resolved value | 工具依資料結構與有效政策得出的結果 | 採用來源、依賴及裁定依據 |

「能解析出 value」不直接表示「該來源可以重定義共用值」；「可以在 editor 修改某段原文」也不直接表示「能覆寫其他來源」。

Parser 收集 observations 及來源角色。哪些 observations 可成為 assignment candidates、是否具有優先順序、能更新哪些目的地，統一由 Config C03 決定。本文件不再固定宣告 definition 與 reference 權限相同。

此處的權限指資料語意上的定案與更新資格；不等同作業系統檔案權限或帳號存取控制。

## D04. Identifier 與 Syntax Tag

`@` 是主要 syntax tag，用於 binding target、instance target、property path target 與 `@code` marker；它不是 canonical identifier 的一部分。

```text
@Fruit       → Fruit
@Sean.job    → Sean.job
```

Qualified Identifier grammar：

```text
QualifiedIdentifier = IdentifierSegment ("." IdentifierSegment)*
IdentifierSegment   = [A-Za-z_][A-Za-z0-9_]*
```

```text
Fruit
Food.Apple
Person.Job
Project.GraspPortable
```

Identifier 大小寫嚴格。點分隔可表達 namespace、class、instance 或 property 前綴；實際角色由 declaration／binding／reference 對應決定，不猜名稱的自然語意。名稱需要在工具處理的 vault 內可解析；找不到或無法唯一解析時保留診斷。

命名風格由使用者維護。可接受字元、點分隔及大小寫的識別規則屬核心 grammar；若改變它們，須修訂核心版本與相容性規則，不能只換一個個人偏好設定。

Canonical identifier 與檔名為不同角色。Managed Wikilink 的 target／filename 保留前導 `@`；解析 canonical identifier 時才移除它，見 Reference Syntax R04。

## D05. String 與 Composition

Value 的資料型別為 string，value 本身保持單行。Formatted value 是 literal fragments 與 references 的 string composition；各 reference 的結構與解析由 Reference Syntax 定義。

原始文字與 logical value 分開保存。語法標記及宿主必要 escaping 不作為新增 value 字元；內容中的大小寫、標點、引號及非分隔用空白依以下字串邊界保留。

空值是否視為未填、不同來源如何比較及裁定，是 Config C04 的政策。Parser 不因 policy 尚未定案而丟棄空的 occurrence 或來源資訊。

## D06. Extension Code Context

### 多行 comment code block

```md
%% @code
class Person
@Fruit = apple
@Sean is a Person
@Sean.name = Sean
%%
```

`@code` 標示 comment block 內含 extension statements。Comment delimiter 與 marker／statements 之間可有排版空白或換行；RHS 的內容空白依 D07 保留。

一般 comment 不因含有相似文字就成為多行 extension code。Grouped reference signature 的 comment 由 reference parser 按其上下文識別；不是另一種 `@code` block。

### 單行 comment code

Value binding 與 instance declaration 可寫成單行，不需 `@code`：

```md
%% @Fruit = apple %%
%% @Sean is a Person %%
```

Comment 內容以 `@` 加 identifier 開始且符合上述已定義 statement form 時，才識別為單行 extension code。Class declaration 使用多行 code context。

外層 comment 先決定邊界。Comment code 中的 Grouped Positional Reference 省略 signature 的內層 `%%`，見 Reference Syntax R06。

本節沿用 rc.1 的 code context，與舊編輯稿一般多行 `%%` 的差異集中記在 Config C09，供這次審閱裁定。

## D07. 基本 Statements 與字串邊界

### Value binding

```text
@Identifier = RHS
```

`=` 表示 RHS value 綁定到 LHS identifier，不是數學等式。第一個 binding operator `=` 分開 LHS／RHS；RHS 後續的 `=` 是內容。

RHS 中完整的 managed reference forms 依 Reference Syntax 解析，其餘按 literal 保存。這個 binding 宣告了資料關係；是否優先於其他來源、能否更新它們仍由政策決定。

### Plain string

RHS 沒有 reference 時為 plain string，取值邊界為：

1. `=` 後至多一個緊接的 ASCII space 是 statement 分隔，不納入 value；更多空白保留。
2. 多行 block 中，value 到該 statement 行尾，換行符不納入 value。
3. 單行 comment 中，value 到外層結尾 `%%` 前；緊貼此 delimiter 前至多一個 ASCII space 是 comment 分隔，不納入 value；更多空白保留。
4. 除上述分隔空白外，不對內容任意 trim。

```md
%% @code
@Fruit = apple
@Sean.job = Person.Job
@Quoted = "Person.Job"
@Handle = @Person.Job
@Message = contact me at sean@example.com
@EquationText = x = y
%%
```

Logical values 依序為：

```text
apple
Person.Job
"Person.Job"
@Person.Job
contact me at sean@example.com
x = y
```

在本閱讀稿沿用的 rc.1 語法中，雙引號是 value 字元；裸 identifier、dot path 及裸 `@Identifier` 不自行形成 reference。要建立依賴，使用 Reference Syntax 的完整形式。

引號與裸 RHS 的歷史差異見 Config C09。它們會改變同一原文的值／依賴，屬核心版本裁定，不是一般 config toggle。

### Class declaration

```text
class Person
```

`class` 使用小寫 keyword，表示 Person 是 class。大小寫不符或語法錯誤應保留位置並提出診斷。

### Instance declaration

```text
@Sean is a Person
```

表示 canonical identifier `Sean` 是 `Person` class 的 instance；class name 與 instance identifier 為不同角色。

### Property binding

```text
@Sean.name = Sean
@Sean.job = [doctor](:ref:Person.Job)
```

Property 使用 dot path。第二行的依賴來自完整 inline reference；RHS 遵守同一套 string 邊界與 reference 規則。

## D08. Parsing、Resolution 與修改的邊界

1. 識別 code contexts 與 managed reference occurrences，保存 raw source、來源位置與 context。
2. 登錄 declarations、bindings、identifier 對應及全部 observations；先保存 composition structure，再處理展開值。
3. 驗證 grammar、mapping、dependencies；依配套 policy 判斷候選資格、結果及診斷。
4. 產生可 review 的操作；修改資格、觸發與執行依 Config C03／C05／C06。

語法有效、value 已確定、操作可套用為不同狀態。未完成 policy 或 unresolved dependency 不改變 raw source 的存在；工具可以回報尚未能定案，不能用猜測填補資料。

String composition 的結構須能由筆記原文重建。Formatted value 的展開文字不代替其 binding；遷移前需保存的結構見 Reference Syntax R08，實際保存位置及 FileDelete 相依見 Config C06。

## D09. 本輪修訂範圍

- 權限與 assignment sources 從本體移到 Config C03；舊「所有來源平等」不再作為核心規則。
- 未填值、比較／裁定及更新時機移到 Config C04／C05。
- 宿主相容政策、工具操作與報告策略移到 Config C06／C07。
- Identifier grammar、syntax tag、code context、statement、單行 string 及精確邊界留在本體。

舊三份文件的逐主題替代關係與待裁定差異，完整放在 Config C09；閱讀本套三份即可取得其需要保留的內容。
