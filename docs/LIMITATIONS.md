# 已知限制與資料邊界

以下描述 0.3 的實作邊界。實際完成進度由 [EXECUTION-STATE.md](EXECUTION-STATE.md) 路由到 M1–M4 的證據；舊 v0.2／PHASE2 報告只描述當時版本。MainVault 全量往返、效能目標與 desktop GUI 是否通過，須讀對應實際結果，不由這份限制文件預先宣稱完成。

- **平台**：交付為 Windows 本機瀏覽器 host，需已安裝 Node.js 24+。Package 不內含 Node runtime，不需安裝 production npm dependencies。尚無 native 獨立視窗、iOS/iPadOS 安裝包或 App Store 發布；mobile 需要 storage/files host adapter 與實機測試。
- **啟動入口**：production launcher 只沿用 build identity 相同、且符合明示 `GRASP_WORKSPACE`／`--workspace` 的 host。不同或無法識別的既有 host 會拒絕沿用，請自行關閉或選其他 `PORT`；不自動終止未知程序。開啟 App 或收到 API 回應不代表 Explorer／Obsidian 桌面畫面已驗證。
- **中文輸入**：中文文字、composition events、selection、真實 clipboard、undo/redo 已有瀏覽器測試；未逐鍵驗證實體 Windows 中文 IME 選字，合成事件不能代替此項。
- **值語言**：新筆記明示 `grasp-v1`，支援自由放置的 raw literal、identifier 取值、ordered concatenation 與兩種帶可讀 cache 的 reference；不要求固定 Binding 區。新版 identifier 每個點分段須以英文字母／底線開頭，之後為英數／底線，不接受連字號。未標記舊筆記按 `legacy-v0.2` 解讀，migration 不自動重解新語法。沒有 arithmetic、class、loops、任意程式／網路／檔案 side effects 或一般 dynamic reference。
- **Markdown 呈現**：Reading／Live Preview 支援常見 Markdown 閱讀，但不是 rich table editor。多段落 reference 的語意與可重建結構優先，canonical source 原樣交給其他 Markdown parser 不保證同樣排版；使用可讀 projection 做外部閱讀。保留未支援 Markdown 原文；不宣稱相容全部 Obsidian plugins、Excalidraw、.base、Mermaid 或 math rendering。
- **筆記連結**：支援 wiki/Markdown links、aliases、heading/block anchors、相對路徑與已管理附件。`![[note]]` 可解析及導覽至筆記，目前不將被引用筆記內容嵌入顯示；Live Preview 的附件嵌入僅支援下列 raster images。Link resolver 成功不代表對應格式已有 renderer。缺失／歧義不猜測；nested heading fragments、asset fragments、local query parameters 仍報告未支援。移動／改標題後 literal path link 可能失效，會顯示診斷，目前不自動重寫其他筆記。
- **搜尋／列表**：側欄及管理頁可搜尋、分頁瀏覽全部結果。Quick switch 顯示前 80 筆並提示縮小範圍；inline query 最多 200 列，可開啟完整 records browser；identifier autocomplete 最多 1,000 個候選。這些是單一視圖的呈現限制，不會刪除資料。
- **Query / rename**：Query 僅 collection 與單欄位 exact equals。Semantic rename 不改普通 prose/code；可能破壞既有 grasp-query 的 collection／filtered-field rename 會阻止套用並指出位置，需先調整 query。無法明確判斷的跨 dotted record ownership 也拒絕。
- **保存與多分頁**：一個 host 同時開啟一個 workspace，沒有即時協同。Workspace ID、revision、source proof 與 review token 防止 stale writes。DB 已確認保存的未提交草稿可跨 restart 恢復，不能據此保證尚未收到 durable acknowledgement 的最後按鍵已保存；以 UI draft／committed 狀態為準。未完成語法保留為草稿；完整 missing/cycle 可提交並顯示 current error／last-good，而不冒充有效新值。Editor 本地 undo／selection cache 不跨 restart；共享撤銷為獨立持久命令，不等於本地 Ctrl+Z。
- **容量與 latency**：單筆 Markdown 上限為 10,485,760 個 UTF-16 code units，record 單欄位為 100,000 個；附件單檔 64 MiB。Rendered value 最多 65,536 characters，graph cache 最多 16,777,216 characters；超限顯示診斷。Content change 的 knowledge parsing、HTTP snapshot、部分 indexes 仍全量處理；大型 workspace 不是已完成全面 incremental transport/parser。
- **附件**：PNG/JPEG/GIF/WebP 可在 Live Preview 顯示；HTML/SVG 等其他格式僅下載。新版 projection 將已解析且納入範圍的附件連結轉為正常相對路徑，保留完整 attachment bytes 與 hash；partial export 不附帶未選且不需要的附件。無法解析、未納入或不安全的目標會明示，不能保證外部 viewer 支援該檔案格式。刪除附件不會順便刪除筆記中的引用；缺失可診斷／回復。
- **Exchange／外部編輯**：單檔 exchange 輸出 grasp-markdown v3，匯入相容 v1–v3。無 metadata 的普通 Markdown 放入 inbox 會匯入為新筆記，不憑檔名覆蓋原筆記。新版分組 projection 的外部修改須依 DB 保存的可信 generation、canonical owner、來源範圍、revision 與實際 file hashes Review／Import；同一 generation 的多個已改 reading files 一起審查。改寫展開 cache 不等於取得共享 definition 的修改權；不能唯一反推 composition 時保留外部內容並要求明示編輯共享定義。任意新增檔案／外部附件修改不會自動成為 DB 內容，也沒有 silent bidirectional sync。
- **Filesystem 支援**：新版 publisher 使用一般檔案、完整 staged generation 與 journal，不依賴 hard links。替換非空 Markdown 目錄需要兩次 rename，其間主要路徑可能短暫不可用；上一代自足內容與 journal 供失敗恢復，不能宣稱多檔更新是單次原子操作。驗證平台以證據所列 Windows 本機 filesystem 為限；FAT/exFAT、網路磁碟及其他平台仍需實測。失敗時 DB 保留 authority，UI 顯示錯誤。
- **Markdown 投影**：Workspace/Markdown 是唯一主要可讀樹，按需 selected export 不構成第二套 persistent AI tree。初次／手動 checkpoint 與有新 revision 時約 10 分鐘的排程共用 exporter；不是每次打字即發布，也不是硬性資料損失窗口。UI 顯示 DB revision、最後成功 revision／time、pending／dirty／error。未知新增、刪除或修改會保留並阻擋覆寫；重試不等於接受。Retention 保留最近兩代可驗證完整 generations，遭外部修改／不完整／不相符的材料不當作垃圾刪除，因此磁碟仍可能增加。
- **備份／回復**：DB recovery 是整個 workspace 回復，會先保存目前狀態；UI 列出最近 100 個 recovery entries，DB 不自動刪除更舊歷史。同磁碟 projection 與同 DB history 都不等於離機備份。關閉 host 後複製整個 Workspace，包含 `.grasp`、`Markdown` 及隱藏的 `Markdown/.grasp-export`，才能一併保留 DB、durable drafts、策略、尚未匯入的外部修改與復原材料。完整 fallback 可不依賴原 DB 重建；partial export 不承諾全庫重建。重建必須通過 coverage／hash／identity／layout 檢查，寫入不存在的新 DB，保留 entity IDs／lineage 但產生新 workspace instance ID。
- **Migration 範圍**：歷史 160 notes／44 folders／11 assets rehearsal 與本輪完整 MainVault 驗收分開記錄，不自動把舊語法、frontmatter、重複段落或卡片推導成 identifiers／records。新版附件串流匯入已移除 512 MiB aggregate cap：最多 20,000 included entries、每篇 10 MiB 原始 Markdown bytes、aggregate Markdown 128 MiB、每附件 64 MiB；preview 不保留全部附件 body，SQLite 每次寫一個附件。新 DB、私人 checkpoint、disk preflight、來源 hash 重驗及 exact-plan resume 見 [MIGRATION.md](MIGRATION.md)；完整 MainVault 成功與否以本輪實際報告為準，不要求拆私人 corpus 來冒充全量完成。

完整 Markdown fallback 保留 current sources、semantic IDs／caches、策略、附件、lineage／provenance 與 durable drafts；不包含 DB recovery history、operation receipts 或共享撤銷歷史。要保有那些歷史，需在 host 關閉後保存整個 workspace 與 DB。

大型含附件 checkpoint 目前會複製及完整 hash 多遍，並同步處理 retention；本輪全量 MainVault 約需 93–190 秒。僅修改閱讀設定或草稿後的檔案定位不再強迫重建整代，但定位仍需 dirty 掃描，也可能等待進行中的 checkpoint；不保證即時。10k／50k reference workload 的正文末尾輸入通過 500 ms 自動回歸門檻，尚未全面達成 Plan 的 100 ms／無 200 ms 長任務理想預算；中段修改與所有 Markdown context 不具有相同延遲保證。實測見 [M4 verification](M4-VERIFICATION.md)。

私密 migration 工作副本與報告位於 repository 外的 Scratch；原始 snapshot 不作為 App 的寫入目標。先前文件中的 .db.files、獨立 AI folder 與公開 immutable 修訂路徑僅描述歷史 M4／M5 配置。

可用日常筆記評估 Editor 的選字、游標、長文與 reference 呈現；性能應分辨 input、parse、calculation、DB commit、projection 與 rebuild，舊報告不能代替本輪目標規模的數據。不要自行刪除 hidden metadata、未匯入外部內容或仍被 manifest 引用的 payload。
