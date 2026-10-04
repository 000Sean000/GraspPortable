---
title: GraspPortable — Product Architecture
version: 1.0.0-rc.6
updated: 2026-10-04
status: accepted-architecture-baseline
scope: markdown-workspace-records-runtime-and-recovery
supersedes: GraspPortable-Architecture-v1.0.0-rc.5.md
---

## 架構基準

本文件將 [Seed rc.13](../Project_Seed/GraspPortable-Core-Requirements-v1.0.0-rc.13.md) 放入已選的 [Explicit Architecture 模型](Decisions/Architecture-Model-v1.1.1.md)。2026-10-04 接受的 P0–S4 計畫取代 DB 原文權威：**Markdown 保存原文，SQLite 支援索引、計算、版本、草稿及恢復日誌**。設計接受與實作／GUI／效能證據分開，後者由 [EXECUTION-STATE](../EXECUTION-STATE.md) 記錄。

保留功能模組、內部分層與 Ports／Adapters。Windows App 管即時互動，獨立 Host 管規則、計算、來源協調與持久化；較慢工作使用有界排程。[圖解 v1.2.1](GraspPortable-Architecture-Diagrams-v1.2.1.md) 分別表達 source dependency、程序及可恢復提交。

## 1. 四個 Projects 與功能責任

| Project | 責任 | 允許的產品 project 依賴 |
| --- | --- | --- |
| GraspPortable.App | MAUI Blazor Hybrid executable；Razor、CodeMirror、ViewModel、backend client、Host 生命週期／平台 | Contracts |
| GraspPortable.Host | ASP.NET Core executable；API、DI、工作排程、SQLite／檔案 adapters、watcher | Core、Contracts |
| GraspPortable.Core | Class Library；功能 use cases、domain、ports、syntax、graph、evaluation、格式與變更計畫 | 無 |
| GraspPortable.Contracts | Class Library；wire commands、queries、results、receipts、notifications | 無 |

Host 映射 wire DTO 與 Core 型別。Core 不依賴 UI／HTTP／SQLite／filesystem 實作；App 不引用 Core／Host、不直接開 DB。Class Library 組織邏輯，Host 承擔 executable。

| Owner | 所持責任與狀態 | 公開接面方向 |
| --- | --- | --- |
| Workspace | ID、schema、解析政策、設定、單 writer 鎖、生命週期與恢復狀態 | Open／Close／Settings／RecoveryStatus；由 Host 組裝 |
| Authoring | transient editor state、版本化 durable draft、session、base revision、衝突呈現 | SaveDraft／ReadDraft／EditorSession／Navigate |
| Knowledge | canonical IDs、名稱、definitions、references、records／schema／relations、來源版本及語意接受規則 | PrepareChange／CommitChange／ChangeReceipt／ReadSnapshot |
| ValueEngine | context／policy、syntax codec、AST、相依、求值、診斷與可重建 graph | Parse／AnalyzeImpact／Evaluate，僅處理輸入快照 |
| Query／Views | 分頁搜尋、實際 workspace 檔案樹、導航、definition／references、表格投影與 view 設定 | QueryPage／ReadDirectory／Locate／ReadView，讀公開版本化文件／知識接面 |
| Exchange／Recovery | 文件對照、外部變更協調、實際檔案建立／改名／搬移、分組策略、跨檔操作、backup generations／restore | Reconcile／FileOperation／PreviewGrouping／ApplyGrouping／Checkpoint／Restore |

Knowledge 集中管理資料含義；Exchange 不建立競爭權威。Records 是 Knowledge 的功能分區，schema／欄位投影可依維護需要分檔，不新增一套獨立 value engine。Cross-device Continuity、Programming 只保留長期責任，本 Goal 不預建空模組。

目錄以功能／use case 為第一層，僅在需要時分 Public、Model、Ports。App 的 Razor、樣式、ViewModel、editor adapter 儘量相鄰。共同 transport／platform／組裝才集中；不要求每個 class 一個 interface。

Application 依 Domain／Ports，adapter 依其實作的核心 port。Knowledge → ValueEngine.Public，Query／Exchange → Knowledge.Public；ValueEngine 不反向讀 Knowledge。跨模組維持無循環，Query 只讀明示且可版本化的 read schema。同 assembly 的 namespace 不是隔離，以少量依賴檢查維持邊界；真正出現獨立重用、建置或測試需求再抽 project。

## 2. Windows 程序、部署與接面

App 啟動同批 Host binary；Host 鎖 workspace、檢查 schema、恢復未結束操作並 reconciliation，ready 後接受修改。每個 workspace 一個 Grasp Host writer；這不禁止 Obsidian 存檔，因此仍需文件 hash／版本核對。

本機 transport 為 loopback HTTP JSON commands／queries 及 SSE revision／受影響 ID 通知。受控啟動 pipe 交換 endpoint、credential、protocol、workspace、Host instance；credential 僅由 .NET client 管理，不放 URL、普通 log 或 editor JS。通知缺口補讀 snapshot，不以事件必達保證正確性。

Razor 在 App 的 .NET 執行，CodeMirror 本地管理文字、selection、IME、undo，不等待 HTTP。Blazor dispatcher 套用畫面狀態。dispose 可取消無用 query，已接受寫入仍由 session 追蹤 receipt。

關閉順序為 flush 草稿、追蹤 accepted operations、正常關閉補 checkpoint，再 drain Host；失敗／未完成狀態可見，不以 UI 取消冒充 rollback。Host 結束後的外部修改在下次開啟處理。

目前 PC 採 unpackaged 目錄及單一入口，binary 與資料分開；不要求正式安裝產品，不宣稱任意乾淨 Windows 已免依賴。保持 .NET 10、MAUI／Razor、CodeMirror 6／TypeScript、ASP.NET Core、SQLite。Windows App SDK／WebView2 移機與 iOS 宿主是後續驗證，不假設 iOS 可沿用 child Host。

## 3. 原文、語意與跨檔提交

### 資料角色

- Markdown／附件：已保存原文與實際工作檔案。必要 IDs、schema、分組成員、欄位定位在 YAML frontmatter；保留未知 metadata。
- SQLite：來源版本與共同基底、可重建 graph／query／結果、durable drafts、operation journal／receipts。草稿與日誌不能當可丟棄 cache。
- 身分：獨立於檔名、namespace 顯示名稱、view 及 source range；名稱仍採 case-sensitive workspace／namespace 唯一。
- Source ranges：raw UTF-16 `[from,to)` 且綁來源版本，保留 EOL／escape 映射；舊 range 不套用新文字。

### 編輯至可見結果

1. CodeMirror 立即更新本地文字，非同步合併保存草稿。退出編輯／切筆記／Ctrl+S 立即 flush 最新 snapshot，IME 組字結束後送最终文字。
2. 原文可以獨立保存；語法未完成仍保留新原文及診斷，語意接受維持最後成功版本並標過期，不發布部分 definitions。
3. 在寫交易外取得固定 source／policy／knowledge snapshot，解析、名稱解析、失效及計算，產生來源補丁、IDs、結果、引用快取與診斷的計畫。
4. 提交序列化。先核對 base、持久化 operation ID／payload hash／read-write guards／預期輸出及恢復材料，再逐檔核對與寫入，記錄進度。遇第三方新 hash 停止覆寫、保存衝突。
5. DB 短交易保存對應語意狀態、投影及 receipt。原文保存、語意接受、跨檔回寫完成使用不同狀態；只有所有承諾輸出核對完畢才稱整體完成。
6. 發 revision／受影響 IDs，UI 補讀必要 delta，clean editor 局部 patch；dirty draft／IME 保留。過期 query、preview 及相交補丁拒絕，不整篇重建 editor。
7. 重啟依來源、journal 與 receipt 判斷已完成／待完成／第三方修改；冪等續作，不把未完成檔案操作當 DB rollback 已消除。

同 operation／同 payload 可安全重試，異 payload 拒絕；回覆遺失可查 receipt。取消準備不撤銷已接受或已提交結果。SQLite transaction 可保證其內部資料一致，**不能讓多個 Markdown 檔案同時原子更新**。一般 local undo 不等於跨檔共享 undo。

### 外部變動

Watcher 是變動提示，啟動與事件遺漏後用 reconciliation 補查。來源保留編碼、換行、path／hash 對照；用實際輸出 hash 辨識自身回寫，不用時間窗忽略外部存檔。普通檔案沒有 Grasp metadata 仍可讀，不為掃描而重寫整庫。

外部 definition 修改自動進入同一管線；reference 顯示值修改依共同基底辨識為共享意圖。僅唯一 literal、有效版本且無矛盾時修改來源及其他引用。Composition 不 flatten，舊 cache 不當新意圖；重複 ID、無法配對身分、dirty source 或競爭變更保留所有資料並呈現衝突。移檔／改名／刪除均更新來源狀態，不能只處理 change events。

### Workspace explorer

App 的側邊欄／右鍵介面透過 Query／文件公開接面呈現實際資料夾／檔案樹，支援展開／收合及名稱／路徑搜尋；Host filesystem adapter 回報最新文件狀態，`.grasp`、`.git`、`artifacts` 等內部／生成內容不進日常筆記樹。實際樹不同於 Records views，也不由 S3 合併／拆分策略偽造目錄。

建立筆記／資料夾、rename／move 經同一來源操作管線：穩定 IDs、expected source versions、path collision checks、operation ID、journal 及恢復，保留可可靠辨識的引用／連結。第三方新版本及 dirty draft 保護不因來自右鍵而略過。複製路徑、開啟筆記、在系統 Explorer 顯示由 App 平台 adapter 執行；reveal 的實際 GUI 效果需要原生驗證，不以 spawn 成功代替。

樹查詢取消與回應版本核對、可見範圍載入／局部刷新沿用 Query 原則，選取與操作目標按 ID／版本，不依 row index。只提供本次指定常用快捷操作，不擴張完整 IDE。

## 4. Records、Markdown codec 與表格投影

### Definition 來源與寫回

Definition 除手寫 literal／composition，新增 record field 來源與可寫目標。Generated property 的 identity 隨 record／field ID，公開名称為 `RecordKey.FieldKey`。中文 display name 另存；collection／view 名稱不參與識別。可靠 key rename 保留 ID 並更新 token；名稱衝突沿用 Knowledge 診斷。

欄位原始 Markdown 唯一可編輯，YAML 只保存必要 schema／定位，SQLite 是投影。不另外產生可獨立修改的 `@定義`。欄位原始 source 按宿主 context／policy 掃描 Grasp；屬性值是引用求值後的 Markdown，參與同一 graph 的 missing／cycle／傳遞失效。結果、literal 及 reference cache 不再解析。回寫依來源類型定位欄位，不調用 literal serializer 包裹正文。

型別為 Markdown/text、number、boolean、date-only、single-select、multi-select、tag、single-relation、multi-relation。空值與空字串／零／false 分開；數字不靜默截斷。選項 ID 不因 rename 改變，多選選項歸欄位，tag 跨表搜尋；無效外部值保留原文與診斷。關聯存 record ID 並有可讀連結，移檔不斷線，missing target 可觀察。

### 可往返的縱向格式

預設 H2 資料集、H3 record、H4 field；複雜標題／清單或結構衝突時用階層式巢狀清單及明確縮排邊界。YAML 保存穩定身分、schema、順序及可靠定位；codec 不只依下一個 heading 切割長文，fence、圖片、wikilink、多段與空行皆保留。結構不明時停止自動改寫。

結構及轉換後實際 headings 不用 H1。首次轉換預覽 heading 層級映射，超限改 nested list，保留原文與 mapping 供恢復；後續新編輯不猜測舊階層意圖。Code fence 中的 `#` 非 heading。普通既有筆記不因 Records 功能被全庫自動轉換。

舊 Markdown table 轉換先預覽欄位映射、型別／關聯辨識及未處理內容；接受後產生縱向 source，保留轉換前原文，未知內容不得刪除。資料表可從 source 重建，不依賴某次 UI session。

### Table／card／views

一個 record 同時可用 cell 與完整角色卡編輯，同一批 records 的多個 views 只保存查詢／版面設定。支持搜尋、排序、篩選、欄位順序與顯示；QueryPage 回傳穩定 record／field IDs、版本及總数／游標，移除無提示的 500 筆截斷。

表格固定欄位標題列與 record 標題欄，可設定凍結前幾列／欄並隨 view 保存。長文摘要配完整 editor；分頁／虛擬化控制 DOM。焦點及 pending edits 依 ID，不依 row index；過期查詢不改寫新畫面，凍結區不遮擋 editor、選單與鍵盤焦點。

### 共用呈現與來源定位

App 的 Authoring／Records UI 共用 Markdown renderer 及 Wiki／Grasp navigation 接面。Live Preview 非編輯區與 Reading 隱去語法標記，以 link 樣式呈現可讀值；單擊／聚焦 Enter 導航。普通 Wiki 開 target；managed reference 由 Host 的 identity／definition 接面取得所屬 file 與 definition block，App 開檔並定位，不僅開 inspector。

Records cell、完整 field 與 card 保留同樣連結呈現和操作。Host／Contracts 投影原始 field source 及 local reference metadata（owner note、raw UTF-16 ranges、source revision），App 不依 resolved text 猜 source offset／definition identity。來源 metadata 與值呈現分開，cache／求值結果不再解析 Grasp，disabled fence 不被 renderer 升為 managed reference。Active source editing、IME／dirty 保護及過期結果拒絕沿用 Authoring。

這是既有 App／Host 的 UI／查詢責任調整，不新增求值引擎、公式、同步或新的資料權威。

## 5. 分組、備份與還原

分組策略明列成員、順序、路徑、定位及基底版本。Preview 驗證未知／重複／漏分配成員、路徑衝突、過期提案、metadata 及連結影響。Apply 實際合併／拆分檔案，同一 canonical ID 不換；合併檔 frontmatter 保存成員及原 metadata，可可靠辨識的連結更新，未知連結列限制。新檔與恢復材料驗證前不得移除舊檔。

Backup／checkpoint 以固定版本快照寫新 generation，manifest 保存格式版本、paths／hashes、來源版本、schema／policy／strategy、附件及草稿恢復狀態。完成檢查後才發布；中斷仍可找到前次完整 generation。Checkpoint 每五分鐘有變更才啟動，正常關閉補做，保留最近三份完整版本；配置可調。最後成功時間、版本、落後、失敗及缺件供 UI 查詢，與 SQLite WAL checkpoint 分開。

Restore 在新 staging workspace 檢查完整性與格式，成功後才開啟，不覆寫目前資料。DB-only 遷移採新資料夾並保留原 DB。Schema migration 先檢查相容、保留恢复副本；未知版本不猜測解析。備份及還原驗證包括 records、關聯與 conversion originals，不只 Notes。

## 6. 排程與品質邊界

每 workspace 最多兩個 CPU prepare workers、單一提交通道。新草稿可取代舊準備，已 durable 接受的 command 不靜默丟棄。Graph 批次更新受影響正反向邊，保留重複 operands 的順序，cycle／missing 重現及取消均有版本判斷。

查詢分頁／取消；通知與畫面更新合併、按可見範圍處理；分批 I/O 及低優先 checkpoint 不阻塞輸入。大工作超過 200 ms 呈現 pending；限制資源時回報明確狀態，不靜默截斷值。`async`、不同 lane 或分程序本身不是流暢證據。

量測包含 input-visible、input-to-result、跨檔回寫、查詢、佇列等待、frame interval、記憶體及 I/O；完整預算由 [實作計畫 rc.9](Implementation-Plan-v1.0.0-rc.9.md) 維護。歷史 P0／M4 只提供成本 insight，不充作本版驗證。

## 7. 入口與未納入範圍

| 責任 | Importance | Environment | Agent | 本次階段 |
| --- | --- | --- | --- | --- |
| Workspace／Authoring／Knowledge／ValueEngine／Query | Trunk | 核心 Cloud-capable；Windows GUI／IME Local-required | 預設沿用高能力模型／effort | S1 |
| 文件共同編輯／Exchange／Recovery | Trunk | 邏輯 Cloud-capable；指定檔案與故障恢復 Local-required | 同上 | S2–S3 |
| Records／表格／Views | Trunk，相對本次 Goal | codec Cloud-capable；角色資料與 UX Local-required | 同上 | S4 |
| Mobile／Continuity／Programming | 本次範圍外 | 平台另訂 | 未安排 | 後續 |

狀態集中於 EXECUTION-STATE。Source 入口為四個同名 `src/GraspPortable.*`；tests 按具體契約與回歸建立，不建無目的矩陣。最低硬體、iPhone／iPad、provider、跨裝置衝突及 Programming 權限另行確認，不阻擋接受的 S1–S4。

工程依據沿用 [Explicit Architecture](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/)、[Blazor Hybrid](https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/?view=aspnetcore-10.0)、[SQLite isolation](https://www.sqlite.org/isolation.html) 與 [WAL](https://www.sqlite.org/wal.html)。產品資料權威、排程及恢復方式是本專案已接受設計，不宣稱由框架自動保證。
