# Projection Strategy、Export 與 Reconstruction Contract

更新：2026-09-27。狀態：已接受方向的 supplemental planning contract；schema、checkpoint 與 filesystem 方案為工程推薦，**尚未實作／驗證**。Current Working State 唯一入口為 [EXECUTION-STATE.md](EXECUTION-STATE.md)；authority 由 [Seed](Project_Seed/README.md) 路由，完整範圍見 [Goal Plan](GOAL-PLAN.md)。本次只發布 docs，不修改產品或私人資料。

## 1. 已接受的產品責任

- DB 是 runtime authority；MainVault → DB 為確定性搬運，保留 identity、內容與來源對照，輸出分組不是匯入前置條件。
- 具有 identity 的 identifiers／bindings／records 可獨立安排輸出群組；目前所屬 Note 不永久限制輸出。普通正文以 Note identity 分組；不建立任意文字 slice system。
- 每個 binding 只有一份 canonical export assignment；移動群組不改 owner／lineage，不合併 canonical identities，完整 fallback 能恢復原 Note 的 binding placement。
- App 驗證、Review、保存結構化策略；AI 如何分析在 App 外。策略接受後，後續 export 是確定性處理。
- 按需匯出與完整 fallback 共用 exporter／資料語義；一棵主要 Human-readable projection 同時服務 Obsidian、AI、inspection、rebuild input，不另建第二套 persistent AI tree。
- Human 最新裁定：link 是視覺考量，語意結構正確優先，不強求隱藏標記。可轉換 blocks／links／anchors，不強制為原生 Link 外觀轉換；完整值／binding／dependency／重建資訊不可丟失。
- 外部修改標 dirty，經 Review／Import；不 silently overwrite，不做 DB ↔ Markdown silent bidirectional sync。

## 2. Semantic units 與 ownership

以下是推薦的 schema v1，不凍結 SQL table 或 TypeScript 名稱：

| Terminal unit | 身分 | Payload 與 source mapping |
| --- | --- | --- |
| `noteProse` | NoteID | 正文、Note metadata／hierarchy、binding slots；不把 slot 裏的 definition 重複當 prose 宣告 |
| `binding` | BindingID | IdentifierID、display name、ordered expression parts／dependencies、syntax version、canonical owner、source mapping |
| `recordInfo` | RecordID | Record 的 collection／name／metadata、field slots；各欄位有明確 stable field／binding identity |

Identifier selector 正規化為其 BindingID；record-field selector 若指向同一 binding，也正規化為同一 terminal unit。沒有 binding 的 identifier metadata 仍以其 IdentifierID 保存，可隨 owning unit 或明示 metadata unit 輸出，不能憑名稱創造 definition。

Whole-note／whole-record 是可明示展開的便利選取，不是永久粒度限制。展開後檢查同一 terminal unit 是否被重複 assignment；不能依「最後一次勝出」忽略重複。名稱、offset、輸出 path、group ID 都不能代替 canonical entity identity。

同一 readable value 可以出現在多處 reference；只有 manifest 指定的 canonical binding unit 是定義。Recovery metadata 中保留原 source，不因此產生第二個可維護 definition。

### 同篇 Note 的 bindings 獨立分組

原 Note `n1` 的 layout：

```text
正文 A
@Fruit = <|apple|>
正文 B
@Person.Job = <|doctor|>
正文 C
```

可將 `noteProse:n1` 放 `Notes/Daily.md`，`binding:bFruit` 放 `Data/Food.md`，`binding:bJob` 放 `People/Jobs.md`。Fruit／Job 的 identity 與原 owner n1 不變，不需要先搬 source。

完整 fallback 保存：原 raw source／encoding／EOL、source revision/hash、順序 layout（raw spans + binding slots）、每個 slot 的 BindingID／range，以及 logical composition。Layout 必須無重疊、完整覆蓋原 source；offset 僅定位指定版本，不能作 durable identity。

Daily 中 slot 可顯示非定義性的定位提示／link；canonical binding 各只在其 assigned group 輸出一次。Rebuild 恢復正文 A → Fruit slot → 正文 B → Job slot → 正文 C；未經修改的 fallback 必須得到原 source bytes/hash。若外部 binding 經明確 review 改動，source patch 回到原 slot，而非把 export group 當新 owner。Records 使用相同原則恢復原 field identity／placement。

## 3. 最小結構化 proposal

```json
{
  "format": "grasp-projection-proposal",
  "version": 1,
  "workspaceId": "w1",
  "base": { "workspaceRevision": 81, "strategyRevision": 3 },
  "planningPackageId": "p9",
  "coverage": {
    "mode": "partial",
    "units": ["noteProse:n1", "binding:bFruit", "binding:bJob"]
  },
  "groups": [
    { "id": "g1", "path": "Notes/Daily.md", "render": "sections-v1",
      "members": ["noteProse:n1"] },
    { "id": "g2", "path": "Data/Food.md", "render": "sections-v1",
      "members": ["binding:bFruit"] },
    { "id": "g3", "path": "People/Jobs.md", "render": "sections-v1",
      "members": ["binding:bJob"] }
  ],
  "unassigned": "deterministic-default-v1"
}
```

Members 的順序是群組內輸出順序；群組有穩定 ID，path 是 workspace projection root 下相對 `.md` 路徑。Render 是有限 profiles，不執行任意 code/template。自然語言 rationale 可附加但不影響執行。

Planning package 保存：package ID、workspace/base、提供範圍、unit revisions/hashes、必要 lineage/relationship metadata，以及每項實際提供的是全文、片段或 metadata。它記錄提供內容，不宣稱外部 AI 確實讀完。外部無需 DB handle／憑證，不能靠提案取得未提供的私人內容。

路徑必須檢查 unknown members、alias overlap、duplicate assignments、case-insensitive／Unicode 比較碰撞、reserved names、traversal、separator／root escape、symlink/reparse-point escape、同一路徑檔案與目錄衝突。不能藉由自動改 identity 修復 path collision；預覽明示可逆 path adjustment。

## 4. Strategy lifecycle

1. **Normalize／validate**：以 package catalog 解析 selector 至 stable units，核對 base、coverage、hashes、path/profile，列出錯誤及 unassigned。
2. **Preview**：呈現前後 group/path/member 差異、覆蓋範圍、漏項、重複、引用／附件位置影響；移 group 不代表移 canonical owner。
3. **Review／apply**：host-held frozen payload＋單次 token，綁 workspace／strategy revisions、catalog fingerprint 及實際輸入 hash。Apply 只套已審查 payload，再核對 base；不接受 client 偷換提案。
4. **Stale**：review 到 apply 期間有相關變更就失效／重新預覽，不猜測外部提案要覆寫新資料。Partial proposal 不隱性移動範圍外成員，漏項不推導刪除。
5. **Persist／edit**：接受策略後保存其 version、revision、assignments 與來源 package。正常內容更新不使整份策略無效；deleted/unknown members 診斷，新 units 顯示 unassigned，使用者可再調整。

推薦完整輸出用確定性 `_Unassigned` 配置承接新增／未分配資料，依穩定 kind/ID 排序，UI 顯示待整理数量。這不等於自動語意分類；策略必須保留可觀察的未分配狀態。Coverage 不完整不能偷偷當 full fallback 成功。

## 5. Deterministic exporter 與檔案取得

Export 讀取一個 committed DB snapshot、已接受策略及明示 exporter version。相同 snapshot／strategy／profile 產生相同 payload bytes、paths、anchors／identity map；不以當前 wall clock、random IDs 或 OS 列舉順序影響內容。Generation 建立時間等操作紀錄與可重現 payload 分開。

對外 `.md` 使用可理解 folder hierarchy／filenames，映射 asset IDs／原相對 links 到實際輸出路徑。附件保存 bytes、MIME／名稱／hash，filename collision 用明示穩定規則處理，不覆蓋。不能沿用 App-only `grasp-asset:` 後就宣稱外部圖片可讀；每個 exported link／embed 要核對新位置或標明 omitted／missing。

Managed wiki 的 canonical target 與分組後 file＋anchor 分开。輸出 link 可以指向 group anchor；Obsidian graph 粒度會跟輸出文件一致，不改 DB identity。必要定位包括 unit、occurrence、owner source slot 與 exported range／anchor；anchor collision／escaping 須用實際宿主驗證。

本次沿用 workspace 外觀 `Workspace/.grasp/workspace.grasp.db`＋`Workspace/Markdown/` 主要投影，manifests／recovery／internal 在 `.grasp`。不為計畫改名或搬私人資料。從 App 的 note、folder、binding／record 或 attachment 取得對應實際 absolute path，提供 Explorer open/reveal；選取不在同一 folder 可做臨時 staging，不能默默建第二套 persistent AI tree。

## 6. Selected export 與完整 fallback 的承諾

| 範圍 | Included／omitted 契約 | 重建承諾 |
| --- | --- | --- |
| 單篇／選取／部分 | 明示 selected semantic units、可選 dependency closure、實際包含附件、omitted targets；可讀 cached values 保留 | 可以閱讀及受控 exchange，不承諾全 workspace rebuild |
| 完整 fallback | 全部 authoritative units、source、metadata、關係、策略與必要附件；有完整 coverage manifest | 可在無原 DB 下核對後建立新 DB，恢復約定資料與結構 |

Partial privacy：只選 Fruit 時，不能為 provenance 把整篇 n1 raw source、Job 或其他未選正文夾入 metadata。只帶選取 unit 所需的 mapping／owner identity；標明無法恢復未含的原 Note。依賴 closure 及額外附件要可見並由選取範圍決定，不自行擴大。

完整 fallback 必備：workspace lineage、entity identities／hierarchy、原始匯入 provenance、目前 exact Note source／語法版本、binding composition／ordered dependencies、record/field data、reference occurrence／cache/status/version、原 owner placement、策略及 exporter/schema versions、檔案/asset hashes。Importer 原始來源和使用者後來編輯的 current source 分開，不能把 rebuild 改回最初 snapshot。

完整 metadata 是 portable package 的一部分，不能依賴原 DB、local absolute paths、上一代 blobs 或未發布 provider memory。讀取時只解析資料，不執行內容中的程式或外部自然語言指令。

## 7. Checkpoint timing／retention／publication（工程推薦）

推薦初次匯入後建立 fallback，提供手動 checkpoint；active 且有新 committed revision 時約每 **10 分鐘**合併一次需求，先保留最近 **2 份完整成功 generations**。最終頻率／保留量依 I/O 實測與可接受落後窗口確認，這是預設建議，不宣稱硬性最大資料損失窗口。

DB commit 不逐次發布整庫。UI 顯示目前 DB revision、最後成功 fallback revision/time、pending/dirty/error，失敗不能更新 last-success。App crash 前已存在成功的可讀副本，不依賴 crash 後才匯出；同磁碟 fallback 不等於離機備份。

推薦 publication 次序：

1. 固定 committed snapshot；在 `.grasp/internal` 建候選 generation，產生完整 payload／metadata／manifest；hash、coverage、refs 全部驗證。
2. Completion marker 最後寫入；候選未完成不可被當成可恢復最新版本，`latest` pointer 只是可重建提示。
3. 以平台 adapter 把完整 generation 發布到主要 `Markdown` tree，保留上一個完整可讀 generation 在 recovery；先寫 durable journal，記錄候選、previous 及發布階段。
4. 發布／狀態提交成功後才標 last-success。啟動或重試時依 journal＋manifest hashes 決定補完或回復，不以檔名最新／mtime 最大推斷完整性。

**Filesystem 邊界不得隱藏**：多檔寫入不是一個 DB transaction，不能以逐檔 overwrite＋最後一個 manifest 就保證外部讀者永遠看不到混代。優先評估完整目錄的 staged cutover；平台不能原子替换非空目錄時，兩次 rename 間可能短暫 unavailable，必須有可獨立閱讀的上一代與明確恢復路徑。若候選方案會暴露混代，不得將其標完整／通過此契約；M3 failure injection 先證明 safe cutover/recovery，必要時調整 platform adapter，明示實測保證。不得默認 NTFS hard links／junctions 在 exFAT 或其他平台可用。

每代 recovery 以一般檔案可獨立閱讀並重建，不要求上一代 blobs 或 hard links 才能成立；內部可在驗證後優化共用儲存，但 portable full package 的獨立性不變。未經驗證的 generation 不替換上一份成功 fallback。

Retention 只清理已確定沒有引用、未 pin、沒有 external dirty 的舊成功／失敗暫存項，且最後兩份有效可讀內容仍存在；不得刪除唯一 rebuild chain。Dirty／未匯入檔案受保護，不能被自動 retention 當垃圾。實作前評估完整附件兩代的 disk demand，不在缺空間時默默丟附件或縮減 coverage。

## 8. External edit、Review 與 recovery

發布前以 baseline file hashes 檢查 external dirty；未知新檔、修改、刪除、attachment bytes 變動分別呈現。Dirty main tree 不覆寫、不因 rerun export 視為已接受，不默默更新相應 baseline。若仍可建立新的內部完整 checkpoint，UI 必須分開顯示 main tree dirty 與 recovery generation revision；不可把內部成功冒充主要可讀樹已更新。

Review 綁來源、已發布 base、當前 DB revision、file hashes 與實際 reviewed payload；apply 再核對。Binding、cache-only、identity/name、正文、附件差異按 [Shared Value Contract](SHARED-VALUE-CONTRACT.md) 分類，source mapping 不等於授予該檔 global write authority。未知內容保留。要捨棄外部修改需 Human 明確操作並先保存可恢復副本，不自動 cleanup。

Rebuild 流程：驗證 format/version、complete coverage、path confinement、所有 payload hashes、identity唯一性、layout完整性及 dependency/occurrence mapping → 產生可審閱 diagnostics → 建立不存在的新 DB → 以一致 transaction 保存 → reopen 再比對。不能覆寫原 DB。保留 entity IDs／lineage，新的 workspace instance ID 避免舊 clients 誤寫；source identity 與新 instance 分開。

Hash 不符的外部修改走 review，不把它當 untouched fallback 直接重建，也不把缺檔默認成 canonical deletion。Missing/cycle 本身若已是明示資料狀態，可以保留相同診斷；不能在 rebuild 中以空字串假裝修好了。

## 9. MainVault 與 M3/M4 驗收

現有 `server/migration.ts` 有 512 MiB aggregate preview cap，歷史全量 assets 約 540.67 MB；既有 160-note rehearsal 不能證明完整副本可匯入。M4 先唯讀 inventory count/hash/bytes，再採串流／分批讀取及可恢復 checkpoint，保留一致 manifest 和 deterministic identity mapping；不是單純無界拉高 cap／把所有附件同時留記憶體。Apply 前重查來源 hashes，輸出新 DB，不能寫 MainVault／MainVault-Source，也不自動語意分類。

必驗 synthetic cases：同 Note 兩 bindings 分群；whole-note＋explicit binding overlap；record-field／identifier alias overlap；rename／move group 不改 IDs；同名／case/path collision；stale proposal；未分配／刪除成員；partial export 不洩漏未選 raw source；source layout 與原 bytes 還原；含／不含 dependency closure；附件 hash／relative links；dirty file／新檔／外部刪除；每個 publication 階段 crash、磁碟不足、retention 及 restart；兩代自足；損壞／缺 payload／不相容版本拒絕。

M3 完成需要兩條 independent evidence：人能在 App 外找到／閱讀資料，以及 fresh-DB 重建核對 identities、logical values、ordered dependencies、原 owner placement／source hashes、records、策略、附件 bytes。M4 再在完整 MainVault 副本驗證，量測 cold/warm export、incremental work、memory、bytes/files、rebuild／failure recovery，不用 filesystem 耗時冒充 typing latency。

Obsidian、Explorer reveal/open 必須實際操作；CLI/API/spawn 和 mock 只屬較低層證據。工具不可用明列 gap，不將 synthetic renderer 宣稱桌面已通過。每個 milestone 結束更新 Working State 的 evidence、stop point、next step 及 checkpoint locator，再 commit/push。
