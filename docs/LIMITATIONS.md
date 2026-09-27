# 已知限制與資料邊界

以下描述驗收準備版 desktop 實作與已知邊界。本次 build、測試、人工操作及 package smoke 的實際結果見驗證文件；先前 M4／M5 的測試與 migration 結果仍是歷史證據，不代表本次單一投影配置已由那些舊測試驗證。這些證據也不等於全 vault 或所有 Obsidian 功能相容性證明。

- **平台**：交付為 Windows 本機瀏覽器 host，需已安裝 Node.js 24+。Package 不內含 Node runtime，不需安裝 production npm dependencies。尚無 native 獨立視窗、iOS/iPadOS 安裝包或 App Store 發布；mobile 需要 storage/files host adapter 與實機測試。
- **中文輸入**：中文文字、composition events、selection、真實 clipboard、undo/redo 已有瀏覽器測試；未逐鍵驗證實體 Windows 中文 IME 選字，合成事件不能代替此項。
- **值語言**：目前是字串與 interpolation，名稱使用英數、底線、點、連字號，首字元為英文字母或底線。沒有 arithmetic、class、loops、任意程式／網路／檔案 side effects 或一般 dynamic reference。語法仍可依下一輪需求演進。
- **Markdown 呈現**：一般 table 提供等寬對齊樣式，不是 rich table editor；grasp-query 才是 structured table widget。保留未支援 Markdown 的原文；不宣稱相容全部 Obsidian plugins、Excalidraw、.base、Mermaid 或 math rendering。
- **筆記連結**：支援 wiki/Markdown links、aliases、heading/block anchors、相對路徑與已管理附件。`![[note]]` 可解析及導覽至筆記，目前不將被引用筆記內容嵌入顯示；Live Preview 的附件嵌入僅支援下列 raster images。Link resolver 成功不代表對應格式已有 renderer。缺失／歧義不猜測；nested heading fragments、asset fragments、local query parameters 仍報告未支援。移動／改標題後 literal path link 可能失效，會顯示診斷，目前不自動重寫其他筆記。
- **搜尋／列表**：側欄及管理頁可搜尋、分頁瀏覽全部結果。Quick switch 顯示前 80 筆並提示縮小範圍；inline query 最多 200 列，可開啟完整 records browser；identifier autocomplete 最多 1,000 個候選。這些是單一視圖的呈現限制，不會刪除資料。
- **Query / rename**：Query 僅 collection 與單欄位 exact equals。Semantic rename 不改普通 prose/code；可能破壞既有 grasp-query 的 collection／filtered-field rename 會阻止套用並指出位置，需先調整 query。無法明確判斷的跨 dotted record ownership 也拒絕。
- **保存與多分頁**：一個 host 同時開啟一個 workspace，沒有即時協同。Workspace ID、revision 與 review token 防止 stale writes；未提交草稿只留在本頁，關閉前應確認已儲存。Undo/selection cache 最多保留本次頁面最近 20 份文件，不跨 host/page restart 保存。
- **容量與 latency**：單筆 Markdown 上限為 10,485,760 個 UTF-16 code units，record 單欄位為 100,000 個；附件單檔 64 MiB。Rendered value 最多 65,536 characters，graph cache 最多 16,777,216 characters；超限顯示診斷。Content change 的 knowledge parsing、HTTP snapshot、部分 indexes 仍全量處理；大型 workspace 不是已完成全面 incremental transport/parser。
- **附件**：PNG/JPEG/GIF/WebP 可在 Live Preview 顯示；HTML/SVG 等其他格式僅下載。Markdown 投影保留原始 grasp-asset:ID 文字，不自動改成外部 viewer 可用的相對連結；外部 viewer 可能無法顯示這些引用，即使附件實體檔案已在同一棵 Markdown 樹中。投影 path map／manifest 保留 entity 對照。刪除附件不會順便刪除筆記中的引用；缺失可診斷／回復。
- **Exchange／外部編輯**：目前單檔 exchange 為 grasp-markdown v2，import 兼容 v1；回到原 workspace 時保留既有附件。無 metadata 的普通 Markdown 放入 inbox 仍匯入為新筆記，不憑檔名覆蓋原筆記。直接修改既有 Markdown 投影筆記，可從外部修改清單預覽差異，依 entity、baseline、revision 與檔案 hash 檢查後明確套用。任意新增檔案或外部附件修改不會自動成為 DB 內容；請用受控匯入／附件上傳。完整跨 workspace 重建使用 manifest 加完整 payload bytes。
- **Filesystem 支援**：本輪在 Windows 本機 NTFS 驗證，原子發布需要 filesystem 支援 hard links；不宣稱可直接在 FAT/exFAT 或任意網路磁碟發布。無法發布時 DB 保留 authority，UI 顯示錯誤。
- **Markdown 投影**：Workspace/Markdown 是唯一持續更新的可讀樹，沒有另一份持續存在的 AI 匯出樹；對外路徑不再是每次修訂的新 immutable 檔名。更新仍非同步，不保證每個 DB revision 已立即投影。Files panel 顯示最後完整發布 revision、pending/dirty/error；未處理的外部內容會保留並阻擋新的完整 manifest 發布，重試不等於接受外部修改。復原用 immutable payloads、舊 manifests 與 DB recovery/blob history 留在 .grasp 內，沒有已驗證的自動 retention/cleanup 功能，長期高頻寫入仍會增加磁碟使用量。
- **備份／回復**：DB recovery 是整個 workspace 回復，會先保存目前狀態；UI 列出最近 100 個 recovery entries，DB 不自動刪除更舊歷史。同磁碟 projection 與同 DB history 都不等於離機備份。關閉 host 後，Workspace/.grasp/workspace.grasp.db 可獨立保留已提交筆記、records 與附件 bytes；要保留尚未匯入的外部修改、交換檔及檔案復原材料，請複製整個 Workspace，包括 Markdown 與 .grasp。重建只接受完整且 hash 相符的 manifest/payload，寫入不存在的新 DB 並產生新 workspace ID。
- **Migration 範圍**：先前 M5 已驗證 160 notes／44 folders／11 assets 的獨立 rehearsal，保留 raw Markdown、相對路徑及 hash；不自動把舊語法、frontmatter、重複段落或卡片推導成 identifiers／records。Subset 的 419 個 missing links 中，404 個目標未納入此次 copy，15 個在完整 catalog 下仍無法解析。詳細結果與未支援項目見 [MIGRATION.md](MIGRATION.md)。CLI 的 10 MiB 原始 Markdown bytes／512 MiB aggregate 限制與一般 DB 字元限制不同，超限應拆成可審閱的 subsets。

私密 migration 工作副本與報告位於 repository 外的 Scratch；原始 snapshot 不作為 App 的寫入目標。先前文件中的 .db.files、獨立 AI folder 與公開 immutable 修訂路徑僅描述歷史 M4／M5 配置。

下一輪可先用日常筆記評估 Editor 的選字、游標、長文與 reference 呈現，再依 [PERFORMANCE.md](PERFORMANCE.md) 分辨 input、index、calculation、projection 的實際成本。若要縮減 .grasp/history，先設計可驗證的 retention 規則，保留外部編輯與有效重建鏈，不宜直接刪除仍被 manifest 引用的 payload。
