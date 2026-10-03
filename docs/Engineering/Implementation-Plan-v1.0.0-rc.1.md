---
title: GraspPortable — Windows Implementation Plan
version: 1.0.0-rc.1
updated: 2026-10-03
status: proposed-awaiting-human-review
scope: windows-first-vertical-slice-and-subsequent-implementation
---

## 本輪交付與閱讀順序

本計畫將[產品架構 rc.2](GraspPortable-Architecture-v1.0.0-rc.2.md)落實為可開始實作的工作順序。**本輪只交付環境與文件，尚未建立 solution、產品程式、測試或安裝套件；必須等待使用者確認規劃及授權實作。** 本文中的路徑、介面及操作均是預定成果。

先審閱第 8 節的第一個 UI 與第 10 節的四組決策。其餘一般工程細節依本計畫執行，不逐項要求使用者選擇。現行需求仍由 [Project Seed](../Project_Seed/README.md)維護；候選產品語義不因寫入本計畫而自動生效。

| 責任 | 單一現行來源 |
| --- | --- |
| WHAT／WHY、三項效能要求 | [Core Requirements rc.6](../Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.6.md) |
| 整體開發方法、驗證成本與 Git 授權 | [Development Method rc.6](GraspPortable-Core-Development-Method-v1.0.0-rc.6.md) |
| 模組、依賴與四維管理方法 | [Architecture Planning Guide rc.7](graspportable-architecture-planning-guide-v1.0.0-rc.7.md) |
| 已採用模型／stack | [Architecture Model](Decisions/Architecture-Model-v1.0.1.md)／[Technology Selection](Decisions/Technology-Selection-v1.1.1.md) |
| 整體產品架構／三種圖 | [Architecture](GraspPortable-Architecture-v1.0.0-rc.2.md)／[Diagrams](GraspPortable-Architecture-Diagrams-v1.0.0.md) |
| 首輪範圍、具體接面、階段及待決選項 | 本文 |
| 實際環境、授權與下一步 | [Development Environment](Development-Environment.md)／[EXECUTION-STATE](../EXECUTION-STATE.md) |

未發現需要更换 Explicit Architecture 或既定程序配置的矛盾。需補足的是語法 expected-value、draft／commit 操作與封裝的未定細節。本文沿用單一原子共享提交；如果 wide fan-out 成本超標，先改善受影響集合、批次與表示成本，不以非同步逐筆更新降級一致性。

## 1. Solution、Projects 與依賴方向

預定於 repository 下建立 `GraspPortable.slnx`、`src/`、`tests/` 及必要的 `scripts/`。以下均尚不存在。第一階段只建立用到的模組，不為後期功能建立空框架。

| 預定路徑 | 類型／責任 | 允許的 project 依賴 |
| --- | --- | --- |
| `src/GraspPortable.App/` | MAUI Blazor Hybrid executable；Windows 啟動、視窗、Host 生命週期、資料夾選擇及平台組裝 | UI、Client、Contracts |
| `src/GraspPortable.UI/` | Razor Class Library；Workspace、Authoring、Views、Exchange 畫面 | Client、Contracts |
| `src/GraspPortable.UI/Editor/` | TypeScript／CodeMirror 6 package；輸入、選取、IME、local history、source mapping、decorations；bundle 至 UI assets | 自有 editor DTO 與 CodeMirror；不引用後端 Domain |
| `src/GraspPortable.Client/` | Class Library；`IWorkspaceClient`、HTTP adapter、通知重連與狀態映射 | Contracts |
| `src/GraspPortable.Contracts/` | Class Library；按 Workspace／Knowledge／Query 分區的 wire DTO、ID、revision、receipt | .NET 基礎型別 |
| `src/GraspPortable.Core/` | Class Library；按功能模組分區，內含 Contracts／Application／Domain／Ports | Contracts 的純資料共用型別 |
| `src/GraspPortable.Infrastructure/` | Class Library；SQLite、檔案、snapshot、clock 等 adapters，按模組對應 | Core、Contracts |
| `src/GraspPortable.Host/` | ASP.NET Core executable；HTTP 驅動 adapter、DI、authentication、scheduler 與後端啟停 | Core、Infrastructure、Contracts |
| `tests/GraspPortable.Core.Tests/` | 語法、graph、identity 與共享變更規則 | Core |
| `tests/GraspPortable.Integration.Tests/` | 真 SQLite、Host、跨程序契約、失敗／重啟整合 | Host／Client 及測試所需 projects |
| `src/GraspPortable.UI/Editor/tests/` | 有實際風險的 range mapping、IME patch 邊界及 delimiter regression | Editor package |

Class Library 組織可重用邏輯；**Host 才是可執行的後端**。UI 不載入 Infrastructure／Core，不直接開 DB。Core 不引用 UI、HTTP、SQLite、CodeMirror 或 OS 型別。Transport DTO 在 Host 映射到 owner 的 use case；Core 不依 DTO 的序列化屬性工作。

Core 內允許的跨模組方向：`Knowledge → ValueEngine.Contracts`；`Query → Knowledge.Contracts`；`Exchange → Knowledge.Contracts`；未來 `Continuity → Exchange／Knowledge.Contracts`、`Programming → Knowledge.Contracts`。Value Engine 以傳入快照計算，不反向引用 Knowledge。Workspace 不引用 Exchange；跨模組生命週期由 Application 協調及 Host 組裝，防止形成循環。Ports 由核心 owner 定義，Infrastructure 實作它們。

將使用 .NET 10；首輪 App 預定 Windows TFM `net10.0-windows10.0.19041.0`，其他可攜 projects 為 `net10.0`。Windows 最低支援版本不由這個 target 推定，初期只宣稱本機實測平台。批准實作後，以已安裝 SDK 10.0.401 建立 `global.json`、NuGet／npm lock 與一致建置命令；確認實際 restore 相容性後鎖定 MAUI、CodeMirror、TypeScript、SQLite provider 精確版本。不得把目前 workload manifest 10.0.20 當作所有 NuGet 套件版本。本轮不提前 restore 或生成程式。

## 2. 程序、平台與部署邊界

### Windows 啟動與關閉

1. 使用者開啟 App，選擇獨立的 Grasp workspace。App 以明確的安裝相對路徑啟動同批次 Host binary，不依賴 shell 搜尋路徑。
2. Host 鎖定該 workspace 的單一寫入擁有權，開 DB、檢查 schema、恢復 receipt／draft 與衍生索引；ready 前不可接受編輯提交。
3. 綁定 OS 分配的 loopback port。啟動握手以受控的子程序 pipe 傳递一次性 credential、endpoint、protocol version、workspace ID、Host instance ID；credential 不放 URL、一般 log 或長期 workspace 設定。
4. App Client 的 .NET HTTP adapter 帶 credential 呼叫 Host；WebView 不直接拿憑證或 DB 路徑。後端檢查憑證與 workspace／protocol，拒絕任意 origin；loopback 本身不算授權。
5. 首輪以 SSE 做已提交 revision／job 通知，經 `IRevisionFeed` 隔離；commands／queries 用 HTTP JSON。SSE 不保存每个 graph node 的事件，重連按 revision 補讀失效集合／snapshot；通知缺口可直接重取當前版本。
6. 關閉時先 flush draft，再等待已接受的 commit 得到 receipt；長 prepare 可取消，已提交結果不得報成「已取消」。Host drain 後關閉 DB。逾時保留「結果未明」與 operation ID，下次啟動查證，不靜默丟失。Host 意外退出時保留 editor draft、顯示斷線；重新握手後先核對 receipt 再重送。

首輪一個 App session／一個 workspace／一個後端寫入 owner，可在 App 內開多 Note tabs。另一個 App 開同一 workspace 時給出明確占用訊息。這是驗證版本 scope，不是多視窗功能已完成。所有關鍵寫入仍有 revision guard，不能用 UI 限制取代並行正確性。

### 部署候選（D3 待確認）

推薦首輪採 **Windows x64 unpackaged 本機驗證目錄**：App、獨立 Host 及 UI assets 一起交付，單一使用者入口，workspace 存在 binary 目錄之外；先使用本機既有 .NET／WebView2 等 prerequisites，交付時提供檢查結果與啟動入口。另可選 MSIX 安裝包：較接近安裝體驗，但增加簽章、註冊與套件驗證成本。其他電腦是否改為 self-contained 發布於後續交付再確認，不能稱首輪資料夾可直接在任意電腦執行。

Microsoft 支援 unpackaged 發布，但 .NET、Windows App SDK 與 WebView2 各有 runtime 條件，須隨實際產物檢查，不能只看 `WindowsPackageType=None` 就宣稱免安裝。[官方發布文件](https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/publish-unpackaged-cli?view=net-maui-10.0)

平台 ports 包含 workspace folder picker、檔案定位／分享、Host 啟動、生命週期與裝置設定。Windows 實作放 App 平台 adapter；可攜核心不要求子程序。iOS／iPadOS 的同程序核心宿主、離線與同步另期驗證，本計畫不複製 Windows 子程序方案到 mobile。

## 3. 功能模組、接面與資料所有權

接面名稱可在實作時作等義調整；下列責任、版本與交易條件必須保留。資料放在同一 workspace DB，表名是設計提案。

| Owner／預定 source 入口 | 持有資料 | 主要接面及依賴 | 驗證入口 |
| --- | --- | --- | --- |
| Core/Workspace | Workspace ID、schema／settings、開啟狀態；設定 revision 與知識 revision 分離 | Open／Close／RecoveryStatus、workspace storage port | Integration：open、lock、restart |
| UI/Authoring + Core/Authoring | UI 持有即時 editor state；核心管理 durable draft 與其 session／owner／base revision | DraftChange／SaveDraft／ReadDraft、EditorPatch；透過 Client 呼叫 Knowledge／Query | Editor tests + Windows GUI |
| Core/Knowledge | Notes、canonical IDs／名稱索引、Bindings／parts、Occurrences、來源、resolved values、cache provenance、knowledge revision、operation receipts | ReadSnapshot／PrepareChange／CommitChange／RenameIdentifier／ChangeLiteral／UndoSharedChange；Value Engine + persistence port | Core：identity／plan；Integration：atomic commit |
| Core/ValueEngine | 可重建的語法樹、反向 dependency index、計算 cache；不擁有第二份 authoritative knowledge | Parse／AnalyzeImpact／Evaluate(snapshot, cancellation) → versioned result／diagnostics | Core：codec／graph |
| Core/Query | 階層、definition／references、搜尋的可重建投影及 indexed revision | QueryPage／Locate／FindReferences；Knowledge 公開讀取 schema／query port | Integration：分頁與失效補讀 |
| Core/Exchange | import lineage、projection strategy、manifest／generation、持久 job state | PreviewImport／ApplyImport／Export／Checkpoint／Restore；Knowledge 公開命令／快照 | Integration：匯入／generation／還原，後期補上 |
| Core/Continuity、Core/Programming | 裝置進度／衝突、外部執行工作 | 版本化交換與知識 API；不直接改 Knowledge 私有資料 | 後期計畫指定 |

持久草稿與 authoritative Note source 分開存放。Knowledge 擁有原文的語義提交；Authoring 不直接更新 binding tables。Query adapter 僅可依公開版本化 read schema 查詢，不以 SQL 偷繞 owner。Editor source range 綁定 raw UTF-16 `[from,to)`、document revision 與 hash；range 不是 durable identity。

首輪識別契約包含 `WorkspaceId`、`NoteId`、`IdentifierId`、`BindingId`、`OccurrenceId`、`OperationId`。ID 不從顯示名稱或實體路徑推導。重新命名保留 ID；重複名字／多 owner 產生明確衝突，不以最後讀到者覆寫。增量 reparse 優先依可靠 source edit mapping 延續 ID；無法唯一對照時保留原稿並要求明確操作，不猜測合併。

### 最小 command／query 形狀

- `SaveDraft(noteId, sessionId, draftRevision, baseNoteRevision, rawSource/delta)`：回覆 durable draft revision；只說明草稿已存。
- `CommitNote(operationId, noteId, expectedKnowledgeRevision, expectedNoteRevision, draftRevision, sourceHash)`：使用 Host 保存的同版 draft 準備、計算、原子提交。
- `ChangeLiteral`／`RenameIdentifier`：帶 target ID、預期 owner revision、操作內容與影響摘要；composition 編輯指定 part，不能從展開文字猜回定義。
- `ReadNote`／`ReadDefinition`／`FindReferences`：回覆 snapshot revision、source revision、cache status；分頁 token 綁定 query／snapshot。首輪名稱查詢直接走權威索引，避免 Query lag 造成剛提交的定義找不到。
- `ReadReceipt(operationId)`：回覆 pending／committed／rejected／unknown 及 committed revision。同 ID 同 payload 重試回同 receipt；同 ID 不同 payload 拒絕。
- `UndoSharedChange(operationId, expectedRevision)`：檢查受影響 owner／definition 未被後續變更覆蓋，再以新 operation 反向準備及提交；stale 時提供比較，不強制覆寫。

### 交易邊界

Knowledge 的一次 transaction 同時保存 Note 原文變更、identity／binding parts、dependency 關係、所有受影響 resolved results、持久 occurrence caches／必要原文 patches、diagnostics、revision、receipt 與可恢复後續工作標記。Reference cache 保留 resolved revision／fingerprint；未受影響 cache 不因全域 revision 增加被無條件判 stale。

Draft autosave 是獨立短交易，不提升 knowledge revision、不成為共享值。Prepare 在寫交易外計算；進入單一 commit channel 時重新核對 base revision。版本失效後先拒絕旧 plan，再對仍有效的明確意圖重準備；不能把過期 source snapshot 當新意圖覆蓋他人修改。

若 Host 在 commit 前回覆「已接受／pending」，須先以短交易保存 operation intent、payload hash 與 base guards，重啟後可以恢復或明確拒絕；只放記憶體佇列不得宣稱 durable accepted。Commit 的最終 receipt 與知識修改同交易保存，pending 記錄不提升知識 revision，也不構成已套用。

Syntax incomplete 保存 draft；missing／cycle 等合法結構可保存為帶診斷的 committed state，保留 last-good value 的來源版本，不把錯誤轉為空字串成功。DB／I/O failure 則 rollback；不得混同為可接受 domain error。SQLite 初期採本機 NTFS、WAL 與 `synchronous=FULL` 的保守耐久設定，實測後才能調整。SQLite 單 writer 與 WAL sidecars 需納入移動／備份；不直接複製運作中的單一 DB 檔。[SQLite WAL](https://www.sqlite.org/wal.html)

Exchange 與 Knowledge 需要共同改變時由 Application 協調同一 Unit of Work，保留 owner 提案；filesystem 發布不加入 DB transaction。大型還原在 staging workspace 驗證後切換，完整 exporter／fallback 屬後期。

## 4. 編輯 → 計算 → 儲存 → 畫面流程

1. **輸入**：CodeMirror 本地套用 transaction，立即顯示，更新 draft revision。IME composition 中不套入改動 composing range 的外來 patch。UTF-16／EOL mapping 由 editor adapter 管理；未編輯內容不因 LF 內部表示被全篇 normalize。
2. **草稿**：將連續 delta 合併，約 250 ms debounce 保存 draft（內部起始值，可調）；切 Note／關閉前立即 flush。UI 分開顯示「未存草稿／草稿已存／計算中／已提交 revision／衝突」。網路故障不能顯示已存。
3. **提交觸發（D1）**：推薦 source 編輯在語法完整且停止輸入約 400 ms 後進入自動共享提交；Ctrl+S 立即要求提交當前版。IME 未結束、未閉合 literal 或語義歧義時只存 draft。高影響 rename／從 reference 修改共享值使用明確確認及影響摘要。
4. **Prepare**：Host 讀 committed snapshot＋同版 draft；增量解析修改範圍，擴張至完整 statement／Markdown context；更新正反向 graph，收集傳遞依賴。移除依賴、missing 重新出現與 SCC cycle 的狀態變化都納入失效集合。literal 片段保留順序；graph edge 可去重，但計算不可去除重複引用片段。
5. **計算**：在受限背景 worker 執行純轉換；對受影響 DAG 拓撲求值，cycle 明確標示，取消／版本檢查分段進行。結果含 changed values、status、occurrence patches 及 base revision。過大的結果不截斷成成功，回報 resource limit／可取消狀態並保留 draft。
6. **提交**：單 writer 在短 transaction 核對版本，批量更新所有一致性資料及 receipt。Commit 完成後才能回覆成功。回覆丟失依 operation ID 查核；相同 revision 的資料不能一半來自 preview、一半來自 committed。
7. **呈現**：通知只攜帶新 revision 與受影響 IDs／摘要；UI 合併通知並按可見 Note 補讀小批 patches。clean editor 以局部 changes 套用，保留 selection／history；dirty editor 只有可證明 non-overlap 且 base 正確才映射，否則保留 draft＋比較提示。過期 query／preview 直接丟棄；已 durable 的 command receipt 即使畫面換頁也必須記錄。
8. **重新載入**：開啟 DB committed snapshot，補建衍生索引，另載未提交 draft；畫面標示恢復狀態。關閉 App 並重啟後，定義、依賴、cached value、IDs 與 receipt 一致，不能僅靠同程序記憶體達成重載。

初期用 workspace knowledge revision 作保守 guard。若獨立 Note 編輯頻繁使 prepare 失效，先量出衝突，再細化 read-set；不在第一版引入複雜分散式協調。

## 5. UI 流暢與資源使用

| 路徑 | 起始工程安排 | 取消、過期及更新粒度 |
| --- | --- | --- |
| Typing／游標／IME | JS 本地處理；不等 Razor render 或 HTTP | 每次 editor transaction，受影響 viewport decorations；不重建 EditorState |
| JS ↔ Razor | 合併 source delta／狀態更新；selection 留本地 | 只送必要 edit ranges、revision、少量狀態；不逐字傳全文 |
| Preview／解析／重算 | 每 workspace 最多 2 個 CPU prepare workers；依量測調整，commit 仍單通道 | 每 owner 只保留最新未接受 preview；有界隊列滿時顯示 pending，durable command 不靜默丟棄 |
| Query／導航 | 有界 reads、分頁與取消 token；長列表 virtualization | query ID＋revision，舊搜尋不能覆蓋新搜尋；不讀整庫 object graph |
| Commit | 單 writer、prepared batch、索引定點更新 | 核對 version；不可分批提交半套共享狀態，慢操作呈現進度 |
| 背景 export／checkpoint | 低優先、分批 I/O、最多一個大型工作 | 讓出 CPU／I/O；記錄 job state 與已完成 generation；不持長時寫鎖 |
| Render／cache | 僅更新可見 Note 和實際受影響 occurrences | 合併每 frame／短時間窗通知；未開 Note 只失效 cache，不立即載入全文 |

CodeMirror 本身以 transactions 與 viewport 管理 state／顯示；整合需保留這些優勢，避免 .NET 往返或 decoration 全文掃描抵銷它們。[CodeMirror Guide](https://codemirror.net/docs/guide/)／[Reference](https://codemirror.net/docs/ref/)

所有大字串展開採延遲 materialization、片段共用及可觀察的資源預算；設定上限時不能默默改變 logical value。真正需要發布的 cache 仍在同次提交完整寫入。若受到單 transaction 規模限制，提出具體失敗 workload 與產品取捨，不能自行改成 eventual consistency。

最少觀測欄位為 edit／operation ID、input-visible、queue、prepare、commit、receipt-visible、query、process memory；只有瓶頸仍不明時增加 profiler。rAF 間隔是呈現 proxy，不能稱鍵盤到畫面精確延遲。UI 程序與 Host 分開觀測，兩者仍共享 CPU／磁碟。

## 6. 語法與操作候選（D1／D2）

Seed 已定 raw literal＋identifier＋串接、兩種 reference、binding 可自然放置與 fenced code 不當 binding。以下補齊真正影響含義的邊界，**候選尚未批准**。參考新版內保存的 [Binding contract](../Reference/Prototype/BINDING-EDITING-CONTRACT.md)、[Shared contract](../Reference/Prototype/SHARED-VALUE-CONTRACT.md)、[Host gate](../Reference/Prototype/REFERENCE-HOST-GATE.md)；只取語義反例和明示決策，不採用舊執行步驟。Legacy1 完全未讀。

### D1-A 推薦的首輪語義組合

- 名稱先採大小寫敏感的 `segment(.segment)*`，segment 為 `[A-Za-z_][A-Za-z0-9_]*`；全 workspace 名稱唯一，`@` 不屬 ID。重複 definition 報衝突並保留 draft，不自動 last-wins。若使用者需要中文 identifier，選 D1-B，在 parser 實作前定 Unicode／正規化規則。一般中文正文、literal 不受此限制。
- Binding 起點為可解析 prose context 中的 token boundary（行首、空白或明確分隔標點）後 `@Name`、可選水平空白及 `=`；email／escaped `@` 不啟用。Paragraph、heading、list、quote、table 中依 source mapping 處理；inline code、code fence、link destination、HTML attributes、frontmatter 與已定界 literal／reference value 不再解析 nested binding。這些 context 規則作為候選一併審閱，無 mandatory section／container。
- `=` 後可有排版空白／換行；atom 後同行 `+` 要求下一 atom，`+` 後可換行。完整 expression 遇 EOL、`;` 或下一完整 `@Name =` 結束；分號之後可接 prose。同一行裸 `First Last` 不把 Last 當無關正文，而診斷缺 `+`／`;`。下一行 `+` 不回頭續接。
- Opener 使用 maximal pipe run；closer 必須精確匹配 level。Empty 優先：`<||>` 為空、`<||||>` 為 level-2 空；`<||x||>` 是 `x`，不是 `|x|`。pipe 邊界或 delimiter 碰撞內容由 serializer 選安全 block form。這是公開語法選擇，不是 parser 私下優化。
- Block opener 後一個 EOL、closer 行前一個 EOL 為結構；重合只移除一次。Closing-line 縮排屬結構，其餘空白不 dedent；LF／CRLF／lone CR 原樣保存。Compact form 同行；首尾真換行在 block 內多保留一個 EOL，serializer 避免 lone CR 與外加 LF 合併。
- 語法完整但 missing／cycle 可提交，顯示診斷；incomplete source 自動存 draft。此安排與 Seed 相容，也保留歷史明示接受的資料保護行為。Shared Undo 作為独立版本化操作；Ctrl+Z 僅處理本地文字，再經一般提交流程計算，不能只回退一處 cache。
- 推薦 idle 自動提交＋Ctrl+S 立即提交。替代 D1-C 為 source 必須按 Ctrl+S 才更新共享值，成本較低但 typing 時相依值不即時跟隨；兩者都自動存 draft，且共享值操作均有明確入口。

下表以 JSON string 記法顯示精確字元；它不是新增 authored escape syntax。

```text
source "@Fruit = <|apple|>"               → value "apple"；dependencies []
source "@Slogan = <|An |> + Fruit + <| a day|>"
  → Fruit=apple 時 value "An apple a day"；ordered dependencies [Fruit]
source "@A =\n<|x|>"                     → value "x"；dependencies []
source "@A = <|\nx\n|>"                  → value "x"；dependencies []
source "@A = <|\n\nx\n\n|>"              → value "\nx\n"；dependencies []
source "@A = <|\r\n x \r\n|>"            → value " x "；dependencies []
source "@A = <||>"                       → value ""；dependencies []，不是 missing
source "@A = <||x||>"                    → value "x"；dependencies []
source "@A = <||a |> b||>"               → value "a |> b"；dependencies []
source "@A = <|x|> + Missing"            → status missing；dependencies [Missing]
source "@A = B\n@B = A"                  → status cycle；A→B、B→A
source "@A = <|x|> +"                    → incomplete，只存 draft
source "@A = First Last"                → syntax error，只存 draft
```

Missing／cycle 沒有 current ok value；incomplete／syntax error 不發布部分 expression。Literal 中的反斜線保持真正內容，不作一般 unescape。

### D2：多行 reference 與首輪成本

推薦 A：首輪包含 multiline binding，正文兩種 reference 在 Grasp 內保存完整 value，以自有定界與局部 escaping 處理 `\`、`[`、`]`、`|`；value 欄位只對這四種字元可逆 escape，未知 escape 保留 source／diagnostic。不把 inline Markdown AST 當資料權威。段落中的多段落 value 顯示為完整閱讀區塊，保留前後 prose、form、target、occurrence；Source 可看到原文，沒有第三種 authored reference syntax。

例：Text=`"first\n\nsecond"`，pure source 為 `"[first\n\nsecond](:ref:Text)"`，wiki source 為 `"[[@Text|first\n\nsecond]]"`；兩者解析結果都是一個 occurrence、相同完整 cached value、target Text，不產生 binding dependency。Literal 內 `@Fake =` 或 value 裡形似 link 的文字不得被重解析成定義。

Pure scanner 只接受第一個 unescaped `]` 隨即接合法 `(:ref:Name)`；wiki 同樣要求完整 `]]`。未閉合／非法 delimiter 不跨下一個獨立 reference 借 closer；失敗時保留原文、不做猜測 write-back。Grasp 的渲染與 source ranges 分開驗證。

首輪要求一般段落中的多段 value、單行 table reference、內含 brackets／pipes／反斜線／link 的 round-trip；多段 value 在 table／heading 等複雜 context 先保留原文與明確診斷，不假裝已有最佳閱讀 UX。第二階段補足這些 context、Obsidian 輸出與重建驗證。

替代 B：首輪只讓單行 reference 進入 UX 驗收，多行 binding 仍無損保存，多行 reference 顯示完整 source 與未支援診斷；較快取得主流程回饋，但不足以判斷多段值的閱讀體驗。兩方案都不能 trim、摘要取代持久 value，或悄悄改用第三種語法。

## 7. 分階段實作與完成判準

所有階段目前均 `WAITING_FOR_IMPLEMENTATION`；本輪完成的是計畫，尚未授權下表程式工作。每階段結束更新實作／必要驗證／使用者接受三種狀態。

| 階段 | 順序與可體驗成果 | 完成判準 |
| --- | --- | --- |
| S0：批准後的啟動基礎 | 固定工具鏈與語法決策 → 建立 projects → App 啟 Host → 開測試 workspace；這只是 S1 內部里程碑 | Windows build／啟動成功、握手／版本／占用錯誤可見；真 SQLite 可建立及重開；非假資料 API |
| **S1：第一個完整可操作 UI** | Editor＋draft → codec／identity → graph → atomic commit → query／局部 UI patches → restart；見第 8 節 | 使用者從 UI 完成真實編輯、定義與兩式引用、共享修改、相依更新、保存及重啟；必要 correctness／Windows 操作與候選效能檢查完成，失敗明列 |
| S2：真實資料與日常寫作 | 受控副本確定性 import、來源／metadata、階層搜尋、較完整 Live／Reading、複雜 context、incremental scaling | 副本往返及未知原文保留；指定真實資料＋成長 workload 下 UI 流暢，縮放／長文／table／fence 可用；不接管日用 Vault |
| S3：可攜輸出與故障退路 | Strategy 編輯／review → export → 同格式 fallback → staging restore；平台定位入口 | 外部可讀、可導航及 fresh-DB rebuild 分別通過；中斷仍保留最後成功 generation；fallback 窗口政策先確認 |
| S4：Records 與完整 PC 流程 | Structured records／views、外部變更審查與完整 scope；視前期回饋局部調整 | Record identity／view／引用／分組輸出一致；外部 observation 無越權更新；Windows 發布與資料移動驗證 |
| S5：跨裝置／程式接面 | Mobile 本機 runtime、同步／衝突、外部 compiler runtime 分別立項 | 另訂平台、權限、同步及接受條件，不由本計畫默認授權 |

不必等所有後期能力完成才讓使用者操作 S1。各階段實作授權範圍由當次確認決定，不把接受本計畫解讀為自動開發全部產品。

### 模組四維與落地順序

| 模組／責任 | Importance | Status | Environment | Agent | 最早階段 |
| --- | --- | --- | --- | --- | --- |
| Workspace／Knowledge／Value Engine | Trunk | WAITING_FOR_IMPLEMENTATION | Cloud-capable；本機 persistence 整合另驗 | High-capability | S0–S1 |
| Authoring／UI／Editor | Trunk | WAITING_FOR_IMPLEMENTATION | 邏輯 Cloud-capable；Windows GUI／IME Local-required | High-capability | S1 |
| Query／Views | Trunk | WAITING_FOR_IMPLEMENTATION | Cloud-capable；真實資料 Local-required | High-capability | S1 最小查詢，S2 擴充 |
| Host／Client／Infrastructure／平台 adapters | Trunk | WAITING_FOR_IMPLEMENTATION | 契約 Cloud-capable；封裝／程序／FS Local-required | High-capability | S0–S1 |
| Exchange／Recovery | Trunk，分期 | WAITING_FOR_IMPLEMENTATION | 邏輯 Cloud-capable；副本／Obsidian／復原 Local-required | High-capability | S2 import，S3 完整 |
| Knowledge Records／進階 Views | Non-trunk，相對 S1 | WAITING_FOR_IMPLEMENTATION | Cloud-capable；UX Local-required | High-capability | S4 |
| Continuity／Programming | Non-trunk，相對 S1 | WAITING_FOR_IMPLEMENTATION | 契約 Cloud-capable；平台 Local-required | High-capability | S5 |

已定契約的純機械文件／fixture 工作可另標 Lower-capability suitable；未定語義、跨模組一致性及整合判斷由 High-capability 負責。這些欄位不代表本輪已建立 agent 工作或另開 chat。

## 8. 第一個可操作 UI：操作腳本與交付範圍

S1 是可存資料的 Windows 試用版，使用獨立測試 workspace，尚不替代日用 Obsidian Vault。主要畫面：左側 Note 清單／簡單搜尋，中間 Source／Live Preview／Reading，右側可收合的 definition／references／diagnostics；底部顯示 draft／commit／Host 狀態。開啟 Note 不強迫使用者理解 project 或 transaction。

預定提供單一啟動入口，以及 repository `workspaces/FirstUI/` 下的測試資料（被現有 .gitignore 排除）；交付 S1 時明列**實際絕對路徑、可點啟動方式與 build 結果**，不讓使用者自行找 build output。本輪不建立這些產物。

操作驗收：

1. 啟動 App →「建立測試 workspace」→ 新增「定義」及「使用」兩篇 Note。可自己輸入資料，不以不可編輯展示 mock 代替。
2. 在「定義」的一般段落附近輸入 `@Fruit = <|apple|>`、`@Person.Job = <|doctor|>` 與 Seed 的 Slogan composition。輸入 opener 時自動補 closer；中文 IME、paste、undo／redo 不破壞內容。
3. 在「使用」插入 `[apple](:ref:Fruit)`、`[[@Fruit|apple]]` 及 Slogan reference。Live／Reading 顯示值；點選 reference 找 definition，能返回引用。純變數無須另建檔案；managed wiki 的 Grasp Note 導航可體驗，外部 target 發布屬 S3。
4. 從 Fruit reference 開「修改共享值」，把 literal apple 改為 pear，檢視影響並確認；兩種 Fruit 引用和 Slogan 更新。由 Slogan 開編輯可見 ordered parts，不把整句 flatten 為 literal。Rename Fruit 為 Produce 時保留 canonical ID、修改真 token，不改普通 prose 或 code。
5. 連續快速修改，重算期間繼續輸入中文、捲動與切 Note；舊 prepare／HTTP 回覆不覆蓋新 draft。從 references 清單定位另一篇 Note；被影響但未開啟的 Note 也已持久更新。
6. 插入 missing／cycle，看到明確狀態與 last-good provenance；輸入未閉合 literal，看到「草稿已存、尚未提交」並可離開再回來。測試 shared undo 與普通 Ctrl+Z 的差別。
7. 按儲存，確認 committed revision；關閉整個 App／Host，再重新啟動並開同一 workspace。Note source、IDs、定義、dependencies、兩式 cache 及未完成 draft 均依各自狀態恢復。實測一次 Host 中斷／回覆遺失後 receipt 查核，不重複套用。
8. 按選定 D2 操作 multiline case；在 125%／150% zoom、縮窄視窗及長文下確認字級、側欄捲動、table／code fence 的基本閱讀與 navigation。

S1 不交付完整 MainVault import、外部 Markdown apply、projection strategy、完整 fallback／restore、Records、同步或 Programming runtime；這些仍是有效產品需求，已排在後續階段，不以未實作模組的測試替身冒充完成。S1 資料安全包含 DB transaction、draft recovery、receipt 與重啟，不能以「原型」省略。

## 9. 效能尺度與低成本驗證（D4 待確認）

三項要求原樣保留：**Excel 類型高互動依賴、真實資料 UI 流暢、未來成長餘裕**。小圖計算很快或「仍可操作」都不是通過。P0 僅取 [Reference 摘要](../Reference/README.md)中的決策 insight：整體 prepare 成本可遠高於 graph、邏輯 lanes 不代表執行緒隔離、500 ms regression gate 不代表 UX 達標。本輪不重跑 P0、不讀私人 evidence。

### 資料組與裝置候選

| 組別 | 規模／形狀候選 | 用途 |
| --- | --- | --- |
| F：首輪人工流程 | 3–10 Notes、20 bindings、100 occurrences；含兩層串接、Unicode、錯誤、multiline | S1 快速操作與資料語義 |
| R：真實資料 | 使用者指定的獨立副本；匯入後記錄 Note／bytes／bindings／edges／occurrences 與最長 Note | S2 真實 UX；未取得副本前明記尚未驗證，不掃 Legacy1 找資料 |
| M：日常候選尺度 | 10,000 Notes／100 MiB source、50,000 bindings、200,000 edges、200,000 occurrences；選取 200 KiB 長文 | 作為 R 未定前的工程參照，不能代替真實驗收 |
| G：成長尺度 | R 與 M 各維度較大者的 3 倍；另獨立測 deep chain=1,000、fan-out=10,000、diamond shared dependencies、每秒 5 次小改持續 30 秒 | 看延遲曲線、資源餘裕與取消；分開組合，不硬塞所有極端為一個不合理 workload |

Graph 壓力資料用固定短 literal 控制 expanded bytes；另加少數內容膨脹反例，驗證可觀察 resource limit，不用指数爆炸輸出取代一般成長測试。

首輪實測裝置為本機 i9-13980HX（24 cores／32 logical processors）、約 32 GB RAM、Windows x64／NTFS。候選最低參照為 4-core／16 GB／SSD Windows PC，但本輪沒有該裝置結果。先記錄本機數據，之後需在接受的目標裝置驗證，不由高階本機推論一般 PC 性能。

| 指標 | 候選門檻 | 理由及判定 |
| --- | --- | --- |
| 輸入至可見、游標／選取 | p95 ≤ 50 ms；操作期間不出現可歸因 App 的 ≥ 200 ms UI 停頓 | 50 ms 約 3 個 60 Hz frames；200 ms 會明顯破壞寫作。手動 IME 體驗另外判定 |
| 滾動／視圖更新 | rAF frame interval p95 ≤ 33 ms，無持續 freeze | 作為渲染 proxy，不能取代 input-visible |
| 已開 Note 切換／indexed query | warm p95 ≤ 200 ms；cold Note open ≤ 1 s | 避免舊版本數秒 locate 體驗；cold 與 warm 分開 |
| 普通小改 ≤100 affected nodes／1,000 occurrences | 從完整編輯至 committed visible p95 ≤ 800 ms，包含約 400 ms idle debounce | 保留互動連動感，另記 prepare／commit 與排隊成本 |
| fan-out 10,000／deep 1,000 | 收到明確提交後 ≤ 2 s 得到 committed 結果；超過 200 ms 顯示 pending | 計算允許較慢，typing／navigation 門檻保持不變 |
| 成長資源 | M 本機 App＋WebView＋Host steady working set 候選 ≤ 2 GB、G ≤ 4 GB；反覆開關 Note／修改後無持續線性增長 | 作為 16 GB 級裝置餘裕起點，非已測數據；另記峰值與 CPU／I/O 飽和 |

推薦接受為第一輪**暫定驗收尺度**，實測失敗需記錄與討論，不能為通過而自行放寬。可選「先測本機基線，再確認上述數值」；此選項仍保留流暢要求，量化接受狀態必須待定。

驗證成本：S1 用 F＋一組可參數化 dependency stress，30 次代表性小改和約 5 分鐘 Windows 操作；S2 才加 R／M／G。每組先跑一次代表性測試，明列樣本、電源／debug／Release 狀態及冷暖差別；失敗或結果不穩才作一次針對性重測／profiling。不建立多輪 benchmark 認證或私人 evidence pipeline。合成 throughput 不能覆蓋 Chinese IME、使用者主觀摩擦與真實資料缺口。

必要 correctness 僅覆蓋高風險：codec round-trip／range、ID rename／duplicate、transitive invalidation／cycle／missing、transaction rollback、同 ID 重試、stale plan 拒絕、dirty／IME patch 保護、重啟／draft recovery。GUI 親自走第 8 節，API 或 headless 結果不能冒充 Windows 操作成功。

## 10. 需要使用者決策的清單

| 決策 | 推薦 | 具體替代與影響 | 需要時點 |
| --- | --- | --- | --- |
| D1 語法與提交操作 | 採第 6 節 A 的明確 grammar／名稱唯一規則，idle 自動提交；保留 draft 與獨立 shared undo | B：首輪即支援中文 identifiers，先定 Unicode／正規化；C：改用 Ctrl+S 才提交，共享值更新較不即時。B、C 可分別選，不綁在一起 | 實作 parser／shared UI 前 |
| D2 首輪多行引用 | A：完整保存並驗證一般段落中的多段 value；複雜 context 次期完善 | B：首輪僅驗收單行 reference，多行完整 source＋診斷；較早取得基本流程回饋，較晚確認閱讀 UX | S1 scope 確認 |
| D3 首輪部署 | 本機 x64 unpackaged 目錄，App 管理獨立 Host，先用既有 runtimes | MSIX 安裝包增加簽章／安裝驗證；面向其他 PC 的 self-contained 另確認大小與依賴成本 | S0 開始前 |
| D4 效能尺度 | 第 9 節數值作暫定門檻；先本機，S2 加真實副本與 3 倍成長 | 先量 baseline 再確認數值；仍不把「可操作」當流暢。需指定真實副本與目標 PC，尚非 S1 起步阻擋 | S1 接受候選；S2 取得資料 |

可一次確認「依推薦方案開始 S1」，也可指定任一項改動；未收到明確實作授權前維持文件階段。確認後將新產品語義升版寫回 Seed、部署結果寫回 Technology Selection、本文標記接受版本並同步入口，避免以本計畫長期取代需求來源。

後期需決事項不阻擋 S1：fallback 可接受落後窗口／保留政策（S3 前提出具體週期選項）、外部來源更新權限、同步衝突、Programming 權限與跨裝置部署。第一輪不默認替使用者作這些選擇。

## 11. 規劃驗證與停點

本計畫已對照現行 Seed／方法／技術／架構與圖解；完成條件包括入口唯一、相對連結可解析、文件 version 與路由一致、七項規劃要求覆蓋、候選和已接受決策分清，以及沒有產品程式變更。環境觀測另存 Development Environment。

這是規劃文件檢查，並非 build、GUI、SQLite crash recovery 或效能通過。下一步是使用者審閱 D1–D4 並明確授權 S1；接手者從 EXECUTION-STATE 恢復，不從 Reference 的歷史 next step 開始工作。
