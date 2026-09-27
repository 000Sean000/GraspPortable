# Shared Value Contract — M2 continuity plan

Updated: 2026-09-27

Status: planning contract; not an implementation or conformance report

Source baseline inspected: `187be53`, app version `0.2.0`

本文件保存下一輪共享值工作的語義與工程接面。Authority 由 [Project Seed README](Project_Seed/README.md) 路由；使用者最新明確決策優先。**App 內的共享語義優先，reference 不強求原生 link 的視覺效果。** Markdown host 的 Link AST、段落拆分或外部宿主顯示差異屬呈現／相容性證據，不再獨自構成停止共享語義實作的 gate。

本文的「已接受」描述產品方向；「建議」描述可實作的工程方案；「待裁定」涉及資料含義或來源權限，不能當成默認授權。文件落盤不表示 v0.2 已有 stable Binding／Occurrence identity、持久 resolved cache 或新版 grammar。

## 1. 已接受的共享修改

- DB 是 App runtime authority；identifier 的穩定身分與名稱、Note 位置、輸出檔名分開。
- App UI 可從 reference occurrence 進入共享值修改、identifier rename、定義與引用位置。一個已完成的共享操作影響同一身分的全部相關結果，不是只修改眼前的顯示文字。
- Binding 保存原始表示、literal fragments、dependency references 及順序。正文保留 `[value](:ref:Identifier)` 與 `[[@Identifier|value]]` 兩種 managed reference；cached value 的存在不授予 occurrence 定案共享值的權限。
- Binding 可放在 Note 中符合 grammar 的適當 context，沒有 mandatory section／container。Assignment 使用 raw literal、identifier 取值與 concatenation；完整詞法仍依配套 grammar 校準。
- 一次有效共享修改完成後，binding、受影響的 nested resolved values、持久 occurrence caches 與必要原文一致。Filesystem export／checkpoint 不必和每次 DB 修改同步發布。
- Composition 展開結果不一定能唯一反推其 binding。UI 應讓使用者修改指定 literal 或 dependency；不能從一次展開字串修改自行刪除依賴、扁平化 binding 或替換其他 identifier 的定義。

例：`Slogan = literal("An ") + Fruit + literal(" a day")`。從 Slogan 的 reference 開啟編輯，應顯示組成及受影響範圍。修改 Fruit 是共享 Fruit 操作；修改 Slogan 的 literal 是 Slogan binding 操作。直接輸入另一句話不能自動推導哪一部分有定案權。此例的 `literal(...)` 是 DTO 說明，不新增可撰寫語法。

## 2. Grasp-owned DTO boundary（建議）

下列是責任與必要資訊，不凍結 TypeScript 型別名稱、SQL table 數量或第三方套件。EditorState、Lezer AST、SQLite handle 不穿過這個邊界。

| 角色 | 必須能表達 | 不可混同 |
| --- | --- | --- |
| Identifier | stable ID、目前 qualified name、revision；名稱索引與碰撞診斷 | 顯示詞、Note title、輸出 path |
| Binding | stable ID、所屬 Identifier ID、明確 owner、ordered literal/dependency parts、source representation、syntax version、revision | 展開後 cached string |
| Binding owner | Note ID + source anchor，或 Record ID + field identity | 依 dotted name 猜測 record 欄位 |
| Reference occurrence | stable ID、target Identifier ID／未解析 token、兩種形式之一、owner、context、source span／hash、cache provenance | Identifier 自身或第二個 assignment owner |
| Dependency reference | 來源 Binding ID、目標 Identifier ID／未解析 token、片段順序及原始範圍 | 一般 Note link／backlink |
| Value observation | 讀入來源、occurrence、所見值、來源版本、raw source/hash | 已獲准的共享修改命令 |
| Resolved result | Identifier ID、status、logical string（可無）、binding/dependency fingerprint、resolved version | 用空字串冒充 missing／cycle／error |
| Occurrence cache | occurrence ID、logical/display payload、status、對應 resolved version、serializer/context version | 永遠有效或可回寫共享定義的來源 |
| Semantic change | operation ID、workspace ID、base version、明確 intent/target、expected owner revisions/source hashes、預期影響 | 直接提交整份未審查 snapshot |

Source spans 採原始 Markdown 的 UTF-16 offsets，必須附 owner revision／source hash；它們是某一版本的位置，不是 durable identity。Note 移動或 Identifier rename 保留 ID；明確複製為新物件則建立新 ID。Reparse 若無法唯一對應舊 binding／occurrence，保留原文與歧義，不能只憑相同名稱把兩個 owner 合併。

Serializer 負責 marker level 避碰、宿主 escaping 及 cache source patch。Parser 保存 raw representation 與 logical fields，不能全域 trim、strip 或移除反斜線。多行 logical value 不因 renderer 只顯示摘要而截斷持久 cache。Markdown 原生 link 是否成立，與 Grasp 能否辨識及還原 managed occurrence 分開驗收；不得為通過 AST 檢查自動引入第三種 reference 語法。

## 3. 一個共享命令的交易邊界（建議）

1. UI 建立明確 intent，例如改某個 literal、重新綁定某 dependency 或 rename 某 Identifier；附帶 workspace、owner/base version 與 source hash。來源 occurrence 只提供操作入口及導航脈絡。
2. Host 用目前已提交資料檢查權限、版本與 target，建構候選語義狀態。先 parse／validate，再計算 affected graph，得到 resolved results、status changes、cache patches 及 source patches。
3. 同一 Grasp domain computation contract 供 Host 與 Worker 使用。Worker 可做 draft preview／取消過期工作，但不是另一個提交 authority。高成本計算可在 DB write transaction 外準備，提交前須再次核對同一 base，不能把舊結果套上新 revision。
4. 一個 DB transaction 更新 binding／identifier、依賴、受影響的持久 results/caches、必要 owner 原文及 operation receipt；失敗全部 rollback。回覆成功只在 commit 完成後發出。
5. UI 接受同一 operation/version 的 receipt 與 source patches，再更新畫面及保存狀態。較舊 Worker／HTTP 回覆不覆蓋已提交的新結果。網路結果不明時依 operation ID 查核，不以盲目重送造成第二次修改。
6. Export／checkpoint 另讀一個一致的 committed snapshot。其延遲／失敗不改變 DB commit 結果，也不能讓 UI 把 stale filesystem 宣稱為最新資料。

一致性以受影響資料的版本／依賴 fingerprint 核對；不要求每改一個值就無效化所有未受影響 caches。可另區分 semantic version 與 UI settings revision，避免 recents 更新使值計算過期；這是內部 HOW，不能降低 owner/version guards。

**狀態規則：** current `ok` result 才能提供當前有效 logical value。Missing、cycle、error、stale 必須可觀察；若保留 last-known-good display，它有自己的成功版本，不能標成此次操作的 current value。Assigned empty string 與 unassigned／missing 要分開；其 source 字面表示須由 grammar 契約定案。能否提交引入特定 error 的有效 binding 由已接受政策決定，不能默認清空資料或自行改寫 composition。

## 4. Draft、Editor、undo 與 IME

**建議的最小整合：**沿用 App 的 ordered command queue、owner revision guards 與無損 raw-source adapter。共享操作開始時先處理本分頁的 dirty owner；有效 source 可先經相同語義 pipeline 提交。無法解析或與外部版本衝突時保留 draft，說明不能套用的原因；不以 reset editor 消除衝突。

| 場景 | 建議行為 |
| --- | --- |
| 修改其他文字但 reference 位置移動 | 驗證 base/hash，透過可追溯 changes 映射位置；不能套用舊 offsets |
| 相同 owner 同時收到共享 cache patch | non-overlap 且 base 可證明時映射；overlap／未知 base 保留 draft，進入比較／重算，不猜測 merge |
| 外部或另一分頁更新，而目前 editor clean | 接受新 committed version；patch 保留合理 selection/context |
| 目前 editor dirty | 不用完整 snapshot 靜默覆寫；版本不符保留原稿與衝突資訊 |
| 中文 IME composition 尚未完成 | 暫緩改動其 source 範圍；composition 結束後重新驗證版本，再套 semantic patches |
| Source typing、paste、delimiter pair edit | 正常 editor transaction；保留 raw 換行與 selection，成對編輯為可理解的 undo 單位 |
| 背景 runtime 只更新顯示 | 不改 local text history、不移動 caret；renderer 不自行回寫 DB |
| 共享命令已提交 | 顯示操作 receipt 與「撤銷共享修改」；撤銷形成有版本保護的反向語義命令，重新計算 impacted caches |

Editor adapter 需要窄的 semantic patch 接面：expected document version/hash、raw-range edits、operation ID、origin 與 selection/history mapping。不能把目前 `setDocument(newMarkdown)` 當成共享 cache 更新接面，因為原文改變時它會重建 editor state。

**尚待裁定的使用者行為：**

- 建議把未完成／無效 source 存為可恢復的 DB draft，與 committed semantic state 分開；其他引用暫用明確標示的 last committed value。這不是無聲保留一個仍標 `ok` 的舊值，也不是將未完成 draft 宣告為新的共享 definition。需要確認 source autosave／恢復顯示的語義，才能定案資料遷移與完成提示。
- 建議普通 Ctrl+Z 處理本地 source edits，共享操作使用明示的整體撤銷；若要 Ctrl+Z 直接撤銷跨 Note 操作，須先定義命令排序、其他分頁更新與 redo 衝突的使用者行為。不能只撤銷一處 cache 而留下 definition 已更新。

上述推薦不授權任何第三方來源、外部 occurrence 或舊 Config 更新政策成為最高 authority。

## 5. 外部 Review：基底、來源及 payload 都要核對

外部讀入將普通正文、identifier rename、binding／dependency 改動、cache-only 文字改動及未知 source 分別列出。Cache-only change 是 observation；不自動升格為 global value edit，即使 DB 目前 unassigned 也不默認具有補值權限。

建議 ReviewPlan 保存 workspace/base revision、syntax/serializer version、輸入來源 lineage、原始 source hash、host-held canonical proposed payload 及 payload hash、分類 diff、影響與 diagnostics。Hash 覆蓋實際 raw bytes／明確編碼，不先 normalize CRLF 或 trim；若屬檔案審查，還記錄實際檔案與附件 hashes。

Apply 只接受 reviewed token／operation ID 與核對資訊。Host 重新驗證目前 workspace/owner versions、expected source hashes、token 有效期及原先審查的 payload 身分；不能相信客戶端在 apply 夾帶的替換內容。檔案若在 review 後又改動，或 payload／base 不符，返回 stale review 並保留來源，要求重新產生差異。Host-held frozen payload 與使用者實際確認的 diff 必須是同一提案。

來源優先權、衝突自動解決、是否允許由某類 observation 建立／覆寫 binding，以及 unmatched occurrence 的定案權是政策問題；未裁定時只提供 review/diagnostics，不套用歷史 Config 的默認規則。

## 6. Persistence 升級與兼容（建議）

- 升級前保存可驗證 DB backup；schema、syntax、cache serializer 分別版本化。新增持久實體／cache 的 migration 是實際資料工作，不因新增 interface 就宣稱無成本。
- 舊 v0.2 `@name = JSON-string`、`{dependency}` template、`{{name}}` occurrence 由 legacy adapter 辨識；不能直接按新 grammar 重新解讀。保留 raw source、LF/CRLF、literal、dependency 順序與原 owner mapping。
- 遷移 proposal 分開列出可確定轉換、重複定義、缺失依賴、未知語法、無法唯一對應的 identities。未知與歧義保留原文／診斷，不能靠名稱猜測覆寫。Syntax serialization 與 identity assignment 有可重跑的 mapping，避免第二次 import 複製或合併錯物件。
- 新持久 caches 從獲准的 bindings 計算，記錄 provenance；不能將舊 runtime display 或 imported readable cache 直接當新 binding 的權威。
- 對 records 的 collection/name/field rename 使用明確 owner/identity mapping，保留既有 Note、Record、Attachment IDs。只需要 semantic cache 更新時不整篇重新排版 Markdown。
- 舊 snapshot/history/export 的讀取相容與新版可撰寫 source 分開。Restore／fresh-DB rebuild 先驗證或轉換為完整一致狀態，再用一個 transaction 提交；不因 history 不含新欄位而默認 cache 正確。

## 7. M2 驗收矩陣（待實作／待驗證）

本矩陣是完成標準，不是現有 tests 通過清單。每列須留下 input、預期 logical/identity 結果、實際保存與 restart 證據；不得以 Link AST 是否成立代替 Grasp semantics。

| 流程／反例 | 必要結果 | 驗證層 |
| --- | --- | --- |
| 從兩種 reference 修改單一 literal value | 同一 Identifier 的 definition、全部受影響 caches 與必要 source 同版；普通正文不被替換 | domain + DB + UI + restart |
| Nested／diamond composition | literal 順序、依賴 identity 不變；只算 affected graph，結果與完整重算一致 | differential/invariant + benchmark |
| 修改 composition 展開文字 | 不唯一時引導指定 literal/dependency；不默認 flatten 或改別人的 binding | UI + semantic command |
| Rename／namespace move、Note/Record 移動 | stable identities 保留；改真正 name tokens，不修改 code/普通文字；references 可追蹤 | migration + source diff + UI |
| 空值、missing、cycle、syntax error | 明確區分；last-good cache 有來源版本，不能冒充 current success；App 可繼續操作 | domain + persistence + UI |
| Dirty draft + 共享更新 + 兩分頁 stale | 不覆蓋 draft、不跨 owner 寫入；拒絕 stale base，選取位置不漂到無關文字 | production concurrency |
| CRLF/LF/mixed EOL、首尾空白、delimiter collision | 原文與 logical string 各自符合契約；metadata rename 不 normalize 全文 | parser/serializer + raw-source + restart |
| Paired marker level、delete、paste、undo/redo | 結構性編輯可預期；既有內容不 aggressive 改寫；撤銷不留下半套共享資料 | editor + browser + native IME |
| 多行、多段落、list、code fence、內嵌 link、escaped brackets/pipes/backslash | Grasp occurrence/binding/cache 語義與完整 logical value 可還原；畫面摘要不截斷保存值；外部宿主差異另列 | domain round-trip + Grasp UI + compatibility report |
| 交易故障／取消／timeout／回覆亂序 | 不提交半套 results/caches；old job 不覆蓋 current；結果不明可查 operation receipt | fault injection + transaction |
| External cache-only edit；review 後改檔／改 payload／改 DB | observation 無默認全域權限；source hash/base/payload 不符拒絕套用，保留輸入 | review/apply adversarial cases |
| v0.2 升級、重複 migration、舊 history restore | 保留 IDs、raw source、附件與可還原備份；歧義明示，不無聲更換語意 | persistence migration |
| Restart／export／fresh-DB rebuild | committed binding/result/cache 的一致性可查；export 使用 committed snapshot，重建恢復 identity/provenance | DB integration；完整 exporter 後續里程碑 |

原生 IME、可見桌面及外部 Obsidian 行為需明確記錄實測環境；synthetic composition events、parser probes 或 spawn/API 成功不代替這些驗證。Multiline compatibility evidence 可以指出 host limitations，但不得重新引入「必須是原生 Link AST 才能繼續」的 gate。

## 8. 現有 source facts 與接續位置

下列位置以 `187be53` 為基準；文件不更動它們。

| 位置 | 已存在 | 尚未完成的契約部分 |
| --- | --- | --- |
| `src/domain/model.ts:5–16` | Note/Record IDs、owner、name-based definitions/references、runtime result | 無 stable Identifier/Binding/Occurrence IDs；無持久 cache provenance DTO |
| `src/domain/knowledge.ts:44–84`、`src/domain/template.ts:5` | 逐行 JSON-string declaration、`{{name}}`、template dependency parser | 新 raw literal／concat／兩種 readable-cache references 未實作 |
| `src/app/main.ts:53,130–187` | in-memory draft、350ms autosave、baseRevision、save failure 保留及串行命令 | 沒有 durable draft entity；普通保存未形成整體共享語意 transaction |
| `src/app/main.ts:142–165`、`src/runtime/client.ts:17–65` | committed snapshot 驅動 Worker、過期工作取消、content reuse | Worker 結果為 runtime display；沒有與 binding 同交易的持久 results/caches |
| `src/app/main.ts:329–354`、`server/rename.ts:12–57` | rename preview、host-held payload/token、base version／期限檢查 | 可沿用 command 骨架；不是新版 stable identity/source-hash/payload contract 的完成證據 |
| `server/exchange.ts:104–145` | import preview、host-held payload、workspace/version guard | 新 observation/binding/cache 分類與細化 source provenance 尚缺 |
| `server/store.ts:257–281,287–324,423–430` | verified schema backup、notes/records tables、transaction、entity revision | 尚無本文件的新 schema／semantic commit path |
| `src/editor/editor.ts:391–410` | per-note editor state cache、insertText、runtime effects、raw focusRange | source 不同時 `setDocument` 重建 state；需版本化 semantic patch 接面 |
| `src/editor/raw-source.ts:53,105–112` | raw separator undo metadata、raw/editor UTF-16 mapping | 可沿用，仍需新 grammar/semantic patch/IME 情境驗證 |

接續實作應先核對最新使用者裁定與 M1 grammar examples，再實作一個「reference → 明確值修改 → 原子保存 → 全部相關位置更新 → restart 保留」slice。本文不授權變更 source/tests，也不記錄任何未執行的新產品通過結果。
