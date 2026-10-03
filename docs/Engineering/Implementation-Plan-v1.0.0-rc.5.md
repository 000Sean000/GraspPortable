---
title: GraspPortable — Windows Implementation Plan
version: 1.0.0-rc.5
updated: 2026-10-03
status: proposed-awaiting-human-review
scope: windows-first-vertical-slice-and-subsequent-implementation
supersedes: Implementation-Plan-v1.0.0-rc.4.md
---

## 本輪交付與閱讀順序

本計畫將[產品架構 rc.2](GraspPortable-Architecture-v1.0.0-rc.2.md)落實為可開始實作的工作順序。**本輪只交付環境與文件，尚未建立 solution、產品程式、測試或安裝套件；必須等待使用者確認規劃及授權實作。** 本文中的路徑、介面及操作均是預定成果。

2026-10-03 使用者已回覆名稱方向／namespace 唯一性、即時更新、首輪多段引用、先本機試用／Portable 優先及暫定效能門檻。第 10 節記錄已接受決策；剩餘語法審查集中在 [Binding Syntax Review](Binding-Syntax-Review-v1.0.0-rc.3.md)。現行產品語義由 [Project Seed](../Project_Seed/README.md)維護；接受部分決策不等於授權開始程式實作。

**已確認平台範圍（2026-10-03）**：目標裝置至少包含 Windows PC；未來再嘗試擴充至 iPhone／iPad。Windows 是必要交付平台；Apple 裝置是後續探索方向，不是本輪或首版的同步交付承諾。保留可攜核心與平台接面，不為尚未展開的 mobile 實作延後 Windows 主流程。Seed 的離線／跨裝置描述保留為後續方向；最低 PC 硬體規格尚未確認。

| 責任 | 單一現行來源 |
| --- | --- |
| WHAT／WHY、三項效能要求 | [Core Requirements rc.9](../Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.9.md) |
| 整體開發方法、驗證成本與 Git 授權 | [Development Method rc.9](GraspPortable-Core-Development-Method-v1.0.0-rc.9.md) |
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

### 部署決策與 Portable 可行性

已接受：先在目前 Windows PC 方便試用，正式安裝不預設為必要，優先朝 Portable 目錄發布；自由度與資料主權至少對標 Obsidian。App 與獨立 Host 維持同批次發布及單一 App 入口，workspace 與 binary 分離，可由使用者選擇資料位置，更新程式不覆蓋筆記。

初步文件核對：MAUI 官方支援 unpackaged 資料夾發布；Windows App SDK 與 .NET 可各自 self-contained，並非核心本機編輯／計算／SQLite 的功能本身要求 MSIX 註冊。本計畫因此優先採目錄部署。這是可行性判斷，尚無本產品 build／移機／性能證據，不能宣稱所有依賴都已免安裝。來源：[MAUI unpackaged](https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/publish-unpackaged-cli?view=net-maui-10.0)、[Windows App SDK self-contained](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/self-contained-deploy/deploy-self-contained-apps)。

| 邊界 | 首輪本機試用 | Portable 發布後續驗證 |
| --- | --- | --- |
| App／Host | unpackaged、使用已觀測 runtimes；單一入口自管 Host | .NET／Host runtime 與 Windows App SDK 是否隨包攜帶，分別核對；不把 Class Library 當 executable |
| WebView2 | 先用目前已有 runtime | Evergreen 共用 runtime 或隨包 Fixed Version 二選一；後者體積與更新責任較高，需確認 MAUI 初始化指定路徑 |
| 資料／設定 | 指定 workspace；機器暫存和必要可攜設定分開 | 移動關閉後完整 workspace，可恢復讀寫；不複製運作中單一 DB 檔 |
| Windows 整合 | 首版不依賴 package identity 的可選功能 | 若將來某項 OS API 真要求註冊，先提出具體能力／成本，不因「原生」二字就強制安裝 |

WebView2 官方提供 Evergreen／Fixed Version 分發方式；選 self-contained .NET 不自動代表 WebView2 也已隨包。首輪不為猜測性能差異先做安裝包比較；只有實際功能或效能證據要求時再擴充。[WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

可攜不等於必須 single-file EXE；先採整個目錄可攜，避免把解壓／打包技巧當產品主線。本機以外的 runtime 完整攜帶、乾淨機器啟動及 filesystem 支援，只在實測後承諾。使用自帶 runtime 時另記更新責任，保留使用者選擇，不自動新增雲端帳號依賴。

資料主權的比較依據是本機資料可由使用者控制。Obsidian 將筆記放在本機 vault 的 Markdown files；本產品仍採既定 DB authority，因此要靠既定 export／fallback／rebuild 兌現外部可讀與恢復，不能用 Portable binary 代替資料可攜。S1 仍是測試版，不提前宣稱已達完整資料退路。[Obsidian data storage](https://obsidian.md/help/data-storage)

平台 ports 包含 workspace folder picker、檔案定位／分享、Host 啟動、生命週期及機器設定。iPhone／iPad 未來再嘗試，不假設能沿用 Windows 子程序。

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

首輪識別契約包含 `WorkspaceId`、`NoteId`、`IdentifierId`、`BindingId`、`OccurrenceId`、`OperationId`。ID 不從顯示名稱或實體路徑推導。重新命名保留 ID；workspace＋namespace＋local name 唯一且大小寫敏感，不同 namespace 可有相同 local name。重複定義／多 owner 產生明確衝突，不以最後讀到者覆寫；語法區及 Note 不自動建立 local scope。增量 reparse 優先依可靠 source edit mapping 延續 ID；無法唯一對照時保留原稿並要求明確操作，不猜測合併。

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
3. **提交觸發（已接受）**：盡量即時，至少退出編輯時立即更新。Typing 使用短而可調的合併窗口，先前約 400 ms 只作暫定量測預算，不是必須等滿的行為。離開目前編輯區、切 Note／Reading、明確完成／Ctrl+S 時立即 flush 最新 draft 並提交該版，不再等 idle timer。IME 先完成正常 composition 事件再送最終文字；語法不完整只存 draft並顯示未套用。計算／I/O 有耗時時明示 pending，不把舊值標為新成功。高影響 rename／從 reference 修改共享值使用明確確認及影響摘要。
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

## 6. 已接受產品決策與待確認語法

已確認 identifier 為 ASCII segment [A-Za-z_][A-Za-z0-9_]*，區分大小寫，namespace 點號兩側不能有空白。同 workspace／namespace 同名 definition 唯一，不採 Note-local scope。只有 assignment 左側加 @，RHS 取值不加 @，不用分號。

外層沿用 @code{ ... } 草案；literal 已改按使用者指定：單層 {value} 起始、依內容括弧 run 疊層 marker，JSON 可自然分行，只有 inline 邊界黏合使用局部 escape。Block raw 內容不作反斜線解碼，精確 lexical 優先序保存在語法審查文件。舊分號、點號空白及用 block 解決 pipe 的提案已撤回。完整 grammar、反例及剩餘選項由 [Binding Syntax Review](Binding-Syntax-Review-v1.0.0-rc.3.md)單一維護，不同時實作兩套候選。

Workspace 可設定 enabledFenceLanguages，起始包含空語言與 grasp；json、grasp-demo 和未列語言停用全部 Grasp parsing／資料回寫。Enabled 表示可辨識 Grasp，不免除語法容器，也不授予任意程式執行。政策變更先預覽定義／引用影響，連同重解析以有版本保護的共享交易套用；policy revision 參與 prepare/cache 核對。

Core ValueEngine 內集中 syntax profile、lexer/parser/serializer，將 delimiter 與 escape 留在 codec，輸出 syntax-independent Binding AST，再交 binder／graph／計算。Markdown context scanner 與 parse policy 獨立；editor 是互動 adapter，Host 為語義權威。Raw source revision＋UTF-16 ranges 維持局部 patch 對應。SyntaxVersion 與 policyRevision 隨 workspace／交換保存；更換 syntax 要明示 migration，不能重新解讀舊 source。只建立首輪需要的模組與小型 fixture，不開發通用語言平台。

已接受 block marker 行 padding 不加入 value，內容行空白與換行無損。第一個 UI 必須驗證多段落引用。正文兩種 reference 保存完整 value，以 Grasp 自有定界及可逆局部 escaping 處理，不用一般 Markdown AST 代替資料權威；一般段落完整呈現並保留前後正文。表格／heading 中複雜 context 下一階段完善，首輪不能截斷或丟資料。

Shared 修改盡量即時，退出編輯立即 flush／提交最後有效版；不完整語法存 draft，完整 missing／cycle 保存帶診斷的 committed state。Shared undo 保持獨立版本保護；dirty／IME 範圍不被舊 cache patch 覆蓋。工程接面和交易仍依第 3–5 節。

## 7. 分階段實作與完成判準

所有階段目前均 `WAITING_FOR_IMPLEMENTATION`；本輪完成的是計畫，尚未授權下表程式工作。每階段結束更新實作／必要驗證／使用者接受三種狀態。

| 階段 | 順序與可體驗成果 | 完成判準 |
| --- | --- | --- |
| S0：批准後的啟動基礎 | 固定工具鏈與語法決策 → 建立 projects → App 啟 Host → 開測試 workspace；這只是 S1 內部里程碑 | Windows build／啟動成功、握手／版本／占用錯誤可見；真 SQLite 可建立及重開；非假資料 API |
| **S1：第一個完整可操作 UI** | Editor＋draft → codec／identity → graph → atomic commit → query／局部 UI patches → restart；見第 8 節 | 使用者從 UI 完成真實編輯、定義與兩式引用、共享修改、相依更新、保存及重啟；必要 correctness／Windows 操作與候選效能檢查完成，失敗明列 |
| S2：真實資料與日常寫作 | 受控副本確定性 import、來源／metadata、階層搜尋、較完整 Live／Reading、複雜 context、incremental scaling | 副本往返及未知原文保留；指定真實資料＋成長 workload 下 UI 流暢，縮放／長文／table／fence 可用；不接管日用 Vault |
| S3：可攜輸出與故障退路 | Strategy 編輯／review → export → 同格式 fallback → staging restore；平台定位入口 | 外部可讀、可導航及 fresh-DB rebuild 分別通過；中斷仍保留最後成功 generation；fallback 窗口政策先確認 |
| S4：Records 與完整 PC 流程 | Structured records／views、外部變更審查與完整 scope；視前期回饋局部調整 | Record identity／view／引用／分組輸出一致；外部 observation 無越權更新；Windows 發布與資料移動驗證 |
| S5：未來探索／程式接面 | 嘗試 iPhone／iPad 本機 runtime 與同步／衝突；外部 compiler runtime 分別立項 | 先確認可行性與範圍，再訂平台、權限及接受條件；不承諾 mobile 交付時程，不由本計畫默認授權 |

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
2. 在「定義」的一般段落附近按批准後語法建立 Fruit、Person.Job 與 Slogan composition；目前組合為 `@code{ @Fruit = {apple} @Person.Job = {doctor} }`，取值用裸名稱，無分號；整體規劃批准並授權後才實作。另以疊層 marker 保存 JSON 原文及 inline 邊界括弧，重開後值不變。輸入 opener 時自動補 closer；中文 IME、paste、undo／redo 不破壞內容。
3. 在「使用」插入 `[apple](:ref:Fruit)`、`[[@Fruit|apple]]` 及 Slogan reference。Live／Reading 顯示值；點選 reference 找 definition，能返回引用。純變數無須另建檔案；managed wiki 的 Grasp Note 導航可體驗，外部 target 發布屬 S3。
4. 從 Fruit reference 開「修改共享值」，把 literal apple 改為 pear，檢視影響並確認；兩種 Fruit 引用和 Slogan 更新。由 Slogan 開編輯可見 ordered parts，不把整句 flatten 為 literal。Rename Fruit 為 Produce 時保留 canonical ID、修改真 token，不改普通 prose 或停用 parsing 的 code；enabled code block 中的真 Grasp token 依政策一併更新。
5. 連續快速修改，重算期間繼續輸入中文、捲動與切 Note；退出編輯立即 flush 最後一版並觸發更新，不需再按儲存。舊 prepare／HTTP 回覆不覆蓋新 draft。從 references 清單定位另一篇 Note；被影響但未開啟的 Note 也已持久更新。
6. 插入 missing／cycle，看到明確狀態與 last-good provenance；輸入未閉合 literal，看到「草稿已存、尚未提交」並可離開再回來。測試 shared undo 與普通 Ctrl+Z 的差別。
7. 按儲存，確認 committed revision；關閉整個 App／Host，再重新啟動並開同一 workspace。Note source、IDs、定義、dependencies、兩式 cache 及未完成 draft 均依各自狀態恢復。實測一次 Host 中斷／回覆遺失後 receipt 查核，不重複套用。
8. 第一版必須實際操作多段落引用：完整 value 可讀、definition 修改後相依更新、前後正文保留，儲存重啟不丟段落。在 125%／150% zoom、縮窄視窗及長文下確認字級、側欄捲動、table／code fence 的基本閱讀與 navigation。
9. 在未標語言、grasp、json、grasp-demo 四種 fence 放示例，前兩種辨識、後兩種不建立任何 Grasp 資料；从 UI 修改語言清單並查看影響、套用、重啟後仍相同。測試 disabled 外層包含看似 enabled 內層時仍不解析。

S1 不交付完整 MainVault import、外部 Markdown apply、projection strategy、完整 fallback／restore、Records、同步或 Programming runtime；這些仍是有效產品需求，已排在後續階段，不以未實作模組的測試替身冒充完成。S1 資料安全包含 DB transaction、draft recovery、receipt 與重啟，不能以「原型」省略。

## 9. 效能尺度與低成本驗證（已接受為暫定門檻）

三項要求原樣保留：**Excel 類型高互動依賴、真實資料 UI 流暢、未來成長餘裕**。小圖計算很快或「仍可操作」都不是通過。P0 僅取 [Reference 摘要](../Reference/README.md)中的決策 insight：整體 prepare 成本可遠高於 graph、邏輯 lanes 不代表執行緒隔離、500 ms regression gate 不代表 UX 達標。本輪不重跑 P0、不讀私人 evidence。

### 資料組與裝置候選

| 組別 | 規模／形狀候選 | 用途 |
| --- | --- | --- |
| F：首輪人工流程 | 3–10 Notes、20 bindings、100 occurrences；含兩層串接、Unicode、錯誤、multiline | S1 快速操作與資料語義 |
| R：真實資料 | 使用者指定的獨立副本；匯入後記錄 Note／bytes／bindings／edges／occurrences 與最長 Note | S2 真實 UX；未取得副本前明記尚未驗證，不掃 Legacy1 找資料 |
| M：日常候選尺度 | 10,000 Notes／100 MiB source、50,000 bindings、200,000 edges、200,000 occurrences；選取 200 KiB 長文 | 作為 R 未定前的工程參照，不能代替真實驗收 |
| G：成長尺度 | R 與 M 各維度較大者的 3 倍；另獨立測 deep chain=1,000、fan-out=10,000、diamond shared dependencies、每秒 5 次小改持續 30 秒 | 看延遲曲線、資源餘裕與取消；分開組合，不硬塞所有極端為一個不合理 workload |

Graph 壓力資料用固定短 literal 控制 expanded bytes；另加少數內容膨脹反例，驗證可觀察 resource limit，不用指数爆炸輸出取代一般成長測试。

首輪實測裝置為本機 i9-13980HX（24 cores／32 logical processors）、約 32 GB RAM、Windows x64／NTFS。4-core／16 GB／SSD Windows PC 僅是候選測試參照，不是已接受的最低支援規格，本輪也沒有該裝置結果。已確認必要平台為 Windows PC，未來嘗試 iPhone／iPad。先記錄本機數據，之後需在接受的 PC 裝置驗證，不由高階本機推論一般 PC 性能。

| 指標 | 已接受的暫定門檻 | 理由及判定 |
| --- | --- | --- |
| 輸入至可見、游標／選取 | p95 ≤ 50 ms；操作期間不出現可歸因 App 的 ≥ 200 ms UI 停頓 | 50 ms 約 3 個 60 Hz frames；200 ms 會明顯破壞寫作。手動 IME 體驗另外判定 |
| 滾動／視圖更新 | rAF frame interval p95 ≤ 33 ms，無持續 freeze | 作為渲染 proxy，不能取代 input-visible |
| 已開 Note 切換／indexed query | warm p95 ≤ 200 ms；cold Note open ≤ 1 s | 避免舊版本數秒 locate 體驗；cold 與 warm 分開 |
| 普通小改 ≤100 affected nodes／1,000 occurrences | 從完整編輯至 committed visible p95 ≤ 800 ms；原預算含約 400 ms 合併窗口，退出編輯繞過該等待 | 800 ms 為暫定上限，不是刻意等候目標；另記 exit-to-commit 與 input-visible |
| fan-out 10,000／deep 1,000 | 收到明確提交後 ≤ 2 s 得到 committed 結果；超過 200 ms 顯示 pending | 計算允許較慢，typing／navigation 門檻保持不變 |
| 成長資源 | M 本機 App＋WebView＋Host steady working set 候選 ≤ 2 GB、G ≤ 4 GB；反覆開關 Note／修改後無持續線性增長 | 作為 16 GB 級裝置餘裕起點，非已測數據；另記峰值與 CPU／I/O 飽和 |

使用者已接受以上候選值作為第一輪**暫定驗收尺度**，實測失敗需記錄與討論，不能為通過而自行放寬。資料組是已接受計畫下的驗證提案，不冒充使用者真實資料；最低 PC 硬體規格仍未定。記憶體門檻需記錄 workload 與 process 範圍，不能因高階本機達標就推論所有 PC。

驗證成本：S1 用 F＋一組可參數化 dependency stress，30 次代表性小改和約 5 分鐘 Windows 操作；S2 才加 R／M／G。每組先跑一次代表性測試，明列樣本、電源／debug／Release 狀態及冷暖差別；失敗或結果不穩才作針對性修正與必要重測。使用者再次要求不得無限上綱：有足夠證據作當前判斷即停止擴大量測，不建立多輪 benchmark 認證或私人 evidence pipeline；修正後驗證受影響路徑即可，不反覆擴大矩陣。合成 throughput 不能覆蓋 Chinese IME、使用者主觀摩擦與真實資料缺口。

必要 correctness 僅覆蓋高風險：codec round-trip／range、ID rename／duplicate、transitive invalidation／cycle／missing、transaction rollback、同 ID 重試、stale plan 拒絕、dirty／IME patch 保護、重啟／draft recovery。GUI 親自走第 8 節，API 或 headless 結果不能冒充 Windows 操作成功。

## 10. 決策狀態與真正剩餘問題

| 項目 | 2026-10-03 使用者決策 | 落地／限制 |
| --- | --- | --- |
| 平台 | Windows PC 至少必要，未來嘗試 iPhone／iPad | 首輪本機 Windows；mobile 未承諾交付時程 |
| Identifier | 經典 ASCII 子集、大小寫敏感、點號兩側無空白 | segment 為 [A-Za-z_][A-Za-z0-9_]*；同一連續 qualified name |
| 定義歸屬 | 同 namespace 同名不能重複，跨 Note 不例外 | workspace＋namespace＋local name 唯一；canonical ID 不隨 rename 改變 |
| 更新時機 | 盡量像 Obsidian 即時，至少退出編輯立即更新 | 退出不等 debounce，最後有效 revision 提交；pending／invalid 明示 |
| Binding | 只有定義左側加 @，取值不加；不用分號 | 外層 @code 草案保留；literal 單層起始、marker 疊層與局部邊界 escape 已選 |
| 解析範圍 | Code block 語言清單可設定；未標語言／grasp 啟用，json／grasp-demo 停用 | Disabled 區不建立或回寫 Grasp 資料；設定與重解析一起提交 |
| Block padding | 分行 mark 與內容間的排版空白不屬 value | 只排除 mark 行空白和結構 EOL，不 trim 真正內容 |
| 首輪多段引用 | 必須體驗 | S1 納入一般段落的完整多段引用與更新／重啟 |
| 部署 | 先目前 PC 方便試用，Portable 優先，評估正式安裝必要性 | 文件可行性支持 unpackaged；實際 publish／WebView2／移機尚待驗證 |
| 效能 | 接受候選數值作暫定門檻；控制驗證成本 | 第 9 節成為暫定尺度，不重跑 P0、不无限擴大測試 |

[Binding Syntax Review](Binding-Syntax-Review-v1.0.0-rc.3.md)已依使用者指示改為單層起始、marker 疊層與邊界 escape；不再重問是否接受固定雙括弧。文件補充最長 opener、空值、raw block、inline 局部 escape 的優先序，連同外層 @code 與整體規劃待審閱。ASCII、@ 位置、點號空白、無分號和 code block allowlist 已明確，不再重問。

語法確認後更新 Seed 的草案狀態及本文接受狀態，再等待使用者明確指示開始實作。僅回答語法或接受規劃不等於授權 coding。

後期才需要的決策仍保留：fallback 落後窗口／保留政策、外部來源定案權限、同步衝突、Programming 權限與 mobile 宿主。它們不阻擋目前完成語法與 S1 規劃，不提前擴張實作或測試範圍。

## 11. 規劃驗證與停點

本計畫已對照現行 Seed／方法／技術／架構與圖解；完成條件包括入口唯一、相對連結可解析、文件 version 與路由一致、七項規劃要求覆蓋、候選和已接受決策分清，以及沒有產品程式變更。環境觀測另存 Development Environment。

這是規劃文件檢查，並非 build、GUI、SQLite crash recovery 或效能通過。下一步是確認剩餘語法修正版，再由使用者明確授權 S1；接手者從 EXECUTION-STATE 恢復，不從 Reference 的歷史 next step 開始工作。
