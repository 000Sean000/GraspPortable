# Markdown Extension Config

Version: 1.0.0-rc.1  
Updated: 2026-09-13  
Status: Review candidate；易變設定與政策的集中定義。C03 新權限內容待補；C09 保留來源差異供本輪閱讀裁定。

## C01. 文件索引與角色

本文件集中管理 assignment 權限、值處理、更新觸發、migration 與宿主／輸出政策。這些政策不再散落於兩份核心規格。

### File_Name_Config

| Config identifier | Actual filename／連結 | 文件責任 |
| --- | --- | --- |
| DefinitionFile | [Markdown_Extension_Definition-v1.0.0-rc.2.md](Markdown_Extension_Definition-v1.0.0-rc.2.md) | 共同資料角色與基本 grammar |
| ReferenceSyntaxFile | [Reference_Syntax-v1.0.0-rc.2.md](Reference_Syntax-v1.0.0-rc.2.md) | Reference forms、mapping、nested、context、escaping |
| PolicyFile | [Markdown_Extension_Config-v1.0.0-rc.1.md](Markdown_Extension_Config-v1.0.0-rc.1.md) | 本文件：政策、版本及替代對照 |

本文使用 Definition／Reference Syntax 指上述版本，Dxx／Rxx／Cxx 指各文件的章節代號。其他文件只引用角色與政策代號，不複製整份設定。版本對應在此登錄；導覽連結隨配套版本更新。

本文件是可審閱的 Markdown 政策規格。下方 snake_case keys 用來穩定識別設定，並不表示已有可執行 config loader、JSON schema 或筆記內 `@config` 語法。

同一份 `.md` 原文可被不同工具讀取；對值或檔案進行共同維護時，工具需記錄使用的核心／政策版本。GraspPortable 是這套規格的使用者之一，repo 名稱不改變 grammar。

## C02. 設定邊界與狀態

### 哪些內容放在這裡

| 類別 | 本文件管理 | 留在核心 |
| --- | --- | --- |
| Identifier | 來源可否定案值、優先級、更新資格；命名風格由使用者維護 | 合法字元、點分隔、大小寫識別、marker |
| Value | 候選如何比較、空值政策、衝突裁定與補值 | 字串的語法邊界、literal／reference 的辨識 |
| 工具行為 | 更新觸發、definition 放置、migration 分類、review／apply／rollback | Reference forms 與資料結構 |
| 宿主／輸出 | 支援目標、顯示期待、report 呈現偏好 | 避免結構歧義所需的 context 與 escaping |
| 文件管理 | 版本配套與替代關係 | 每份核心本身的 grammar 定義 |

效能門檻、框架、thread／process、database、UI panel layout、安裝包及 MainVault benchmark 屬 GraspPortable 實作規格；不塞進這套 Markdown 核心政策。

### 狀態的含義

- `confirmed`：本輪可見使用者決議已有明確內容。
- `carried_forward_for_review`：從指定 rc.1 或已提供文件移入，供本輪審閱；不聲稱使用者已逐條核准。
- `pending`：已知需要新決議，但具體內容不足；沒有隱含預設值。

本文件所列狀態是規格編輯狀態。它與 app 的「某次更新已確認」是不同概念。

### 版本與缺值

工具使用明確的 `definition_version`、`reference_syntax_version`、`policy_version` 組合，並在索引／計畫中保存。政策改變後，涉及該政策的解析結果評估與寫入計畫須重新驗證；不能沿用先前 review 的不同修改。

權限等必要政策為 pending 時，仍可解析、盤點、保留 observations 與顯示差異；需要該權限才能決定的共用值與更新計畫，標為 policy unresolved。不能自行採用舊值或把 pending 當成「所有來源平等」。

## C03. Identifier 的定案與更新權限

### 本次修訂狀態

`assignment_authority.status = pending`

使用者已指出 identifier 權限描述與新決議不同。現有兩份 rc.1 都寫成「明示 binding 與每一處 managed reference 地位相同」，但目前可查證資料沒有新規則的完整內容。本版將舊權限描述從核心撤出，不將它列為現行有效政策。

此處需要補入最新決議，而不是重新假設 definition 優先或 reference 優先。

### 權限要回答的內容

| 欄位 | 要定義的行為 | 目前值 |
| --- | --- | --- |
| `eligible_assignment_roles` | 哪些來源可提出共用值：明示 binding、正文 reference、binding RHS 內的 reference 等 | pending |
| `source_priority` | 多來源不一致時是否有角色／指定來源優先級 | pending |
| `reference_edit_effect` | 修改引用處文字，是提案、顯示值變更、還是定案來源的修改 | pending |
| `binding_update_permission` | 哪些操作可以修改明示 binding，包含 formatted binding | pending |
| `update_targets` | 定案值可傳播到哪些 definitions／references，哪些只能報差異 | pending |

Definition 的資料角色、筆記歸屬位置與 source priority 必須分開。C06「放入主題筆記」本身不授予或取消該來源權限；C05 的「更新所有引用」按鈕本身也不回答誰有資格定案。

### 用一個例子補齊規則

```md
%% @Fruit = apple %%

I like [pear](:ref:Fruit).
```

需說清楚：`apple` 與 `pear` 不同時，誰能定案；使用者在引用處把 `pear` 改成 `banana` 後，能否更新 binding 及其他引用。新規則若區分一般 value 與 formatted value，也在這裡明示。

以上例子展示的是需要裁定的關係，不是兩個同權候選的現行宣告。語法角色可以先解析，權限結果仍為 pending。

## C04. 值比較、未填值與候選裁定

狀態：`carried_forward_for_review`，來源為兩份 rc.1。C03 先決定來源資格及優先級；本節在其適用集合內處理 values。

| Key | 移入的政策 |
| --- | --- |
| `empty_value_policy` | 空字串或全空白為未填；不把未填當非空候選值競爭 |
| `value_comparison` | 比較依語法取得的實際字串；保留大小寫、標點、引號及內容空白 |
| `escape_comparison` | Table／宿主必要 escaping 不視為額外 value 字元 |
| `conflict_resolution` | 在適用的權限層級內有未能定案的不同非空值時，呈現來源與差異，由使用者裁定 |
| `fill_unset` | 存在有效定案值且目標允許更新時，可形成補值操作 |

不符合 assignment 資格的 occurrence 仍保存它的 value；差異可能是過期顯示或不一致，而不一定是有權與 definition 競爭的候選。等 C03 補齊後，才能為這些情境固定 diagnostic 與更新行為。

比較政策不更改 parser 的 value 邊界；例如 Definition D07 保留的第二個內容空白不因 normalization 被無聲移除。

## C05. 更新觸發與結構衝突

| Key | 目前政策 | 狀態／來源 |
| --- | --- | --- |
| `maintenance_trigger` | 使用者按「更新所有引用」後，才觸發跨來源值更新；一般存檔保存目前文件並更新索引 | confirmed：前輪產品決議 |
| `update_scope` | 命令明示 identifier 與受影響的直接／傳遞 references；按 C03 檢查實際更新資格 | carried_forward_for_review：新版實作規格的具體化 |
| `structural_conflict` | 已獲准的變更若無法唯一對應回 formatted binding，呈現文字、binding、literals、dependencies，讓使用者裁定 | carried_forward_for_review：Reference Syntax rc.1 |
| `unresolved_dependency` | 無法解析的 dependency／value cycle 保留原始結構及診斷，不以空值假裝成功 | carried_forward_for_review：Reference Syntax rc.1 |

對 formatted value 進行修改時，不把展開文字直接當成新的 composition definition，也不自行猜測應改哪個 slot。修改來源與目的地的權限由 C03 定義；結構能否保留由 Reference Syntax R08 定義。

使用者的明確更新命令是一次操作入口；它不授予尚未定案的來源權限。C03 尚未補齊前，這項產品決議可保留，但依賴權限的寫回規則尚不能宣稱完整。

## C06. Migration 與檔案操作政策

本節集中會隨資料與工作流程調整的遷移規則。Reference 的三種 grammar 與 nested 結構仍以核心為準。

### 分類與來源值

`migration_classification.status = confirmed`，依使用者最新編輯 Task 003 block 48273。

| Target 分類 | 條件 |
| --- | --- |
| Empty | 檔案存在，原文非空行數為 0 |
| LowInformation | 原文非空行數為 1 |
| Contentful | 原文非空行數至少 2 |
| Unknown | 讀取、encoding 或解析無法可靠完成 |
| Missing／Ambiguous | 找不到 target／找到多個可能 target |

分類前不以移除 headings／frontmatter 改變行數；UID 或 meaningful filename 使用相同規則。Normalized filename／content 僅供 evidence。LowInformation 是可 review 的 candidate，不等於自動刪除許可。

| Case | 適用條件 | 計畫方向 |
| --- | --- | --- |
| A | 有 alias，target 為 Empty／LowInformation | Pure inline reference；保存必要 binding；FileDelete candidate |
| B | 有 alias，target 為 Contentful | Managed wikilink；保留 target；必要 FileRename／related link updates |
| C | 無 alias，target 為 Empty／LowInformation | Pure inline reference；保存必要 binding；FileDelete candidate |
| 普通 note link | 無 alias且 target 為 Contentful | 保留用途；相關 rename 若影響它，再產生 link target update |

LowInformation 檔名提供 identifier、內容提供需保存的 value；Case C 有內容時使用內容，Empty 才以 filename stem fallback。Case A 仍記錄 alias 與 target 內容，兩者不一致時不能以資料遺失換取遷移完成。如何定案值依 C03／C04；本版不預設 alias 永遠勝過內容或相反。

Heading／block link、非法或未定 mapping、Missing／Ambiguous／Unknown、無法安全序列化的項目列 ManualReview。Nested content 依 R08 保存 literals、dependencies 及 mapping；不能只留下展開結果。

### 保存位置、審閱與執行

| Key | 目前政策 | 狀態／來源 |
| --- | --- | --- |
| `definition_placement` | 保存到既有主題筆記；依引用關係提出建議，由使用者確認或調整 | confirmed：前輪產品決議 |
| `migration_review` | Scan／分類／preview → 使用者 select／stage → review staged → Apply；全部預設不勾選、不 stage | confirmed：最新 Task 003 |
| `file_delete` | 使用者 stage，全部必要變更成功，備份至 quarantine 並核對成功後才刪除來源 | confirmed：最新 Task 003 |
| `file_rename` | 使用者 stage，更新必要 inbound links，檢查目的地未被占用後 rename；不覆蓋既有檔案 | confirmed：最新 Task 003 |
| `rollback_scope` | 失敗時復原整組相依操作，保留其他獨立成功組 | confirmed：使用者已選定此範圍 |
| `report_preview_min_chars` | Raw evidence 至少提供前 500 characters；較短則全部，截斷需標示 | confirmed：最新 Task 003 |

`file_delete` 只適用已確認的 Empty／LowInformation。仍有未處理引用、未成功保存 definition／nested structure 或相關 ManualReview 時阻擋；僅 stage 不代表保存成功。

備份保留原始相對路徑與唯一 run 對應。目的筆記、quarantine 實際目錄、group journal 與同檔操作合併等工程細節由實作規格承接；Config 只固定資料保存與復原成果。Report／cache／quarantine 本身不代替正式筆記內的 definition。

本節取代舊任務「不處理無 alias」及「只列 rename preview」的較早版本。舊三份 domain 文件不再需要承載這些會變動的操作政策。

## C07. 宿主相容與輸出政策

狀態：`carried_forward_for_review`，由 rc.1 的相容說明、歷史宿主觀察與 report 偏好移入。

| Key | 政策 |
| --- | --- |
| `compatibility_target` | 維持 CommonMark-compatible 正文及 Obsidian 擴充的結構可辨識；GraspPortable 依同一 source／grammar 實作 |
| `rendering_expectation` | 不同 editor 的隱藏標記、Live Preview 與跳轉效果採盡力相容；原文應完整保留資料 |
| `diagnostic_separation` | Grammar／mapping 無效、dependency 無法解析、policy unresolved 與 renderer 顯示差異分別報告 |
| `report_syntax_layout` | Syntax-heavy preview 優先用 section／list／code block，避免 Markdown table 破壞內容 |
| `output_escaping` | Note、Markdown report、JSON 分層處理；report 額外 escape 不回寫到 note 或 logical value |

Reference Syntax R09／R10 的 canonical separators、context boundaries 與 escaping 是具體語法限制，仍保留於核心；`rendering_expectation` 不用來放寬那些限制。

### Inline destination 的歷史宿主觀察

以下保留舊文件的設計理由，未在本次重新實測，不當作現行所有 Obsidian／editor 版本的保證：

- `(ref: Fruit)` 含空白，可能無法作單一有效 destination，Reading Mode 可能顯示圓括弧內容。
- `(ref:Fruit)` 可能被當外部 URI scheme，點擊時出現外部應用確認。
- `( xx ref: Fruit)` 可能把前段文字當內部 target，點擊後建立空檔案。
- `(:ref:Fruit)` 在原規格所述測試中可隱藏 identifier 並避開外部應用確認；是否還有其他提示屬宿主實測。

現行 canonical form 由 Reference Syntax R03 決定。未來發現宿主行為變化，先更新相容觀察及工具呈現政策；若確需修改字面語法，再走核心版本修訂。

## C08. 變更與版本契約

核心 grammar 與政策各自遵守 Semantic Versioning 2.0.0。既有兩份核心延續 `1.0.0-rc.1`，本輪為 `1.0.0-rc.2`；Config 是新文件序列，起於 `1.0.0-rc.1`。這些是閱讀／核准候選，不代表產品 release 或已核准正式規格。

| 變動 | 更新位置及相容性處理 |
| --- | --- |
| Report 版面偏好、顯示文案 | Config；不改 raw syntax |
| Assignment 資格、優先級、更新目的地 | Config；重驗 resolved values／plans，標明行為相容性 |
| 命名風格 | Config 或使用者慣例；不能繞過核心 identifier grammar |
| 引號、RHS reference 辨識、`@code` 入口、identifier identity | 核心版本；需有同一 input 的 expected parse／value／dependency 範例 |
| Reference forms、slot／escaping boundary | Reference Syntax；需記錄相容與 migration 影響 |
| 核心引用的政策介面新增或改名 | 同時更新相依核心引用及 C01 配套版本 |

「抽成 config」是變更責任集中，不代表所有政策修改都可視為無相容影響的 patch。正式 1.0.0 之後，若同一合法資料的既有解析或權限行為被不相容改變，依 SemVer 提升 major；若只是編輯澄清且行為未變，才按實際影響採 patch 等版本。

App 可以呈現設定或讀取設定，但同一 vault 的共同維護不能因兩台設備各自隱藏的權限預設產生不同寫回。配套 policy 的識別、傳遞與不一致處理應可追查；本輪未設計新的同步協定。

## C09. 審閱差異與舊文件替代對照

### 尚需處理的內容

| ID | 主題 | 原資料的差異 | 本閱讀稿狀態 |
| --- | --- | --- | --- |
| P01 | Identifier authority | rc.1 寫所有來源平等；使用者指出新決議已不同 | C03 pending；須補新規則，舊規則不作有效 fallback |
| S01 | String 引號 | 編輯 block 28491 把雙引號作 delimiter；rc.1 把引號作 value 字元 | D07 暫沿用指定 rc.1，保留為閱讀核定項；不是新核准決議 |
| S02 | 多行 code context | 編輯 block 28491 示範一般多行 `%%`；rc.1 使用 `@code` 入口 | D06 暫沿用 rc.1，保留為閱讀核定項 |
| S03 | Bare RHS | 編輯 block 28491 說 `Person.Job` 可引用 identifier；rc.1／Addendum 規定 literal，需完整 reference form | D07／R06 暫沿用 rc.1，保留為閱讀核定項 |

P01 補齊後須回查 C04／C05／C06 的適用行為；不需把新優先權文字再複製進 Definition／Reference Syntax。S01–S03 若閱讀後採不同解讀，則直接更新對應核心及例子，不能只加 policy switch 讓規格同時有兩個答案。

### 由兩份 rc.1 搬出的內容

| 原位置／內容 | 新位置 | 處理 |
| --- | --- | --- |
| Definition 定位中的 reference 改值權限 | C03；D03 留來源角色 | Relocated／Pending |
| Definition Assignment sources、所有來源地位相同 | C03 | 舊內容退為本表可追溯歷史，不繼續生效 |
| Definition 一致／空值／conflict | C04 | Relocated；先依 C03 選適用來源 |
| Definition 確認後更新其他來源 | C05 | Relocated；加入已定案的明確更新觸發 |
| Reference occurrence 有權提出新值 | C03；R07 留 observation 結構 | Relocated／Pending |
| Reference structural conflict 的權限／使用者裁定 | C03／C05；R08 留結構差異 | 分開權限與結構 |
| Reference migration 後 FileDelete 的操作順序 | C06；R08 留需保存的資料 | Relocated |
| 兩份 File_Name_Config | C01 | 集中版本索引，核心只保留導覽連結 |
| CommonMark／Obsidian 相容承諾、點擊觀察、report 偏好 | C07 | Relocated；保留實測證據邊界 |

### 舊三份文件的內容去向

舊文件名稱只在本節作來源標識；新版的規範性引用均指向本套三份。下表是主題涵蓋核對，不冒充尚未執行的 parser／renderer conformance 測試。

| 舊文件／主題 | 新位置 | 狀態與說明 |
| --- | --- | --- |
| Reference Syntax Spec：string formatting／variable reference model | R01／D03／D05 | Preserved；source role 與 authority 分開 |
| Reference Syntax Spec：術語、Qualified Identifier、全 vault 解析 | R02／D04 | Preserved |
| Reference Syntax Spec：pure inline format、辨識及反例 | R03 | Preserved |
| Reference Syntax Spec：inline destination 的宿主設計理由 | C07 | Relocated；歷史觀察未重新實測 |
| Reference Syntax Spec：managed wikilink、alias、target／filename `@` | R04 | Preserved；明確區分無 alias file link |
| Reference Syntax Spec：grouped format、順序與數量驗證 | R05 | Preserved；不部分配對 |
| Reference Syntax Spec：reference-style link collision | R09 | Preserved |
| Reference Syntax Spec：`_` 作 valid separator | R09 | Changed；承接 Addendum 覆寫，非 canonical separator |
| Reference Syntax Spec：syntax summary／scanner scope | R03–R05／R11 | Preserved；例子分散在各 form，無額外 summary 規則 |
| Addendum：parser／CommonMark／Obsidian conformance | D02／R09–R11／C07 | Relocated／Changed；結構限制與宿主效果分開 |
| Addendum：comment 內外 grouped signature | D06／R06 | Preserved |
| Addendum：formatted／nested 定義、展開與解析順序 | D05／D08／R08 | Preserved |
| Addendum：bare RHS／引號／`@` 的 literal boundary | D07／R06／本節 S01–S03 | Conflict retained；採 rc.1 作閱讀基底，保留編輯稿差異 |
| Addendum：nested migration preservation | R08／C06 | Preserved／Relocated；資料不只保存在 report |
| Addendum：從 apple／doctor 改為 Fruit／Person.Job 的例子 | R08 | Changed；改為已明示 mapping，避免推測名稱 |
| Addendum：separator 覆寫與 validation | R09／R11 | Preserved |
| Addendum：不新增第四種 form、ordinary syntax 邊界 | R02／R11 | Preserved |
| Markdown Extension Definition：定位／原則／Markdown 基底 | D01／D02 | Preserved |
| Markdown Extension Definition：syntax tag、identifier、case-sensitive | D04 | Preserved |
| Markdown Extension Definition：多／單行 code context | D06／本節 S02 | Conflict retained；舊編輯稿差異可讀 |
| Markdown Extension Definition：binding operator／plain RHS／單行 value | D05／D07／本節 S01／S03 | Preserved／Conflict retained |
| Markdown Extension Definition：class／instance／property／object model | D02／D03／D07 | Preserved；完整 OOP 未加入本 scope |
| Markdown Extension Definition：processing order／先解析後維護 | D08／R08／C03–C06 | Preserved／Relocated |
| Markdown Extension Definition：舊文件關係 | D01／R01／C01 | Changed；新版規範引用只需這三份 |
| 最新 Task 003：Case C、行數分類、value 來源、staging、備份刪除／rename | C06 | Added from newer decisions；替代較早 task 說法 |
| 最新決議：definition 歸屬／明確更新／失敗相依組復原 | C05／C06 | Added from confirmed decisions |

### 淘汰條件與本輪狀態

本輪已把舊三份需要保留的主題收納或明示其覆寫去向；沒有用刪掉難處理內容來宣稱合併完成。新版兩份核心不依賴舊三份才看得懂。

使用者完成三份閱讀、補齊 P01 並裁定 S01–S03 後，可將舊 Reference Syntax Spec、Reference Syntax Addendum、Markdown Extension Definition 退出現行規範入口。其後 Codex 以 C01 指定的三份為 domain 依據。

舊實作交接包若仍把 rc.1 的「來源平等」寫成 invariant，必須隨 P01 改成引用本 Config；不能拿舊 app 規格覆蓋新的 domain policy。這項依賴更新屬後續交接修訂，本輪未聲稱已改寫既有 Codex 任務包。

目前是可完整閱讀的三份候選稿，尚非已核准／已淘汰狀態。本輪保留舊檔，沒有執行刪除。
