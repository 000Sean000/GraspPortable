# GraspPortable 0.2.0

在本機寫 Markdown、管理有資料夾的筆記庫，讓 identifier、records 與查詢表使用同一份資料。SQLite 保存筆記與附件；旁邊的檔案目錄提供可讀 Markdown、AI 交換檔及經過驗證的重建來源。

## 啟動

**Windows：雙擊 `Start-GraspPortable.cmd`，瀏覽器會開啟 `http://127.0.0.1:43821`。** 需要 **Node.js 24+**。下載的 `GraspPortable-0.2.0` 套件已包含成品，無須安裝 npm dependencies。其他桌面平台可執行 `node scripts/launch.mjs`；目前正式驗證環境是 Windows／Edge。

從原始碼 checkout 建置：

```sh
npm ci
npm run build
npm start
```

Git clone 第一次使用 Windows launcher 時，也會自動安裝鎖定依賴並 build。開發模式：`npm run dev`。

左上角 workspace 按鈕可建立／開啟本機 `.grasp.db`。預設檔是 `workspaces/Welcome.grasp.db`；一般啟動會記住上次使用的資料庫。指定獨立檔案可用：

```sh
node scripts/launch.mjs --workspace "C:\Notes\My.grasp.db"
```

保留 host 主控台；結束前確認「已儲存至 SQLite」，再按 Ctrl+C 停止。筆記、值、records 和已保存附件可離線使用；外部網站圖片仍需要網路。Host 僅供本機 loopback 使用。

## 先試這五件事

1. **找到與整理筆記。** 建立資料夾和中文筆記，用側欄搜尋標題、路徑或內容。Ctrl/⌘+P 快速切換；試試最近開啟、前後導覽，以及筆記「⋯」中的移動。資料夾位置與筆記 ID 分開保存。
2. **寫作與連動。** 在範例修改 `@first_name`；離開該行後看 nested values 更新。點值前往定義，從 References 看來源、依賴與影響，再試「重新命名／移動 Namespace」的差異預覽。中文、Markdown、Source／Live Preview 與 Ctrl/⌘+Z／Shift+Z 使用同一編輯器。
3. **操作資料。** 在「資料」搜尋 record，修改欄位值，以 collection 或欄位計算值精確篩選。建立 table 筆記；點列名開啟 record，或按「開啟全部結果」分頁瀏覽。欄位詳細資料可以查看引用、插入 `{{collection.name.field}}`。
4. **走一次 AI 交換。** 在「檔案與 Mirror」加入圖片與 Markdown、插入附件、檢查實際路徑，並建立給 AI 的資料夾匯出。要更新既有筆記，使用「匯出 Markdown」產生的 `.grasp.md`，保留其 metadata；把修改後內容放進 inbox，審查差異後確認套用。一般 Markdown 匯入會新增筆記。
5. **驗證保存與復原。** 關閉 host 再啟動，檢查筆記、records、附件和最近筆記。從「復原紀錄」查看一次修改的影響範圍。需要測試 mirror 重建時，指定完整 manifest 路徑與一個尚不存在的新 `.db`，保留原資料庫。

## 筆記與知識管理

側欄一次呈現最多 80 個筆記／資料夾，所有頁面都可抵達；全庫搜尋附路徑與內容片段。最近開啟保留 20 筆。相同標題可在不同位置存在；`[[筆記]]`、Markdown 路徑連結、標題錨點和反向連結由「連結」面板檢查。缺失或同名歧義會顯示，不會任意猜測目標。移動筆記不會自動改寫其他筆記的文字路徑。

Identifier 面板可依名稱、namespace、來源與狀態篩選，definitions、references、diagnostics 和依賴清單都有分頁。重新命名前先看精確修改、碰撞、缺少定義與循環的變化；套用時檢查 workspace 修訂，並保存復原點。既有 record／欄位名稱使用同一條受控重新命名流程。

Records 可搜尋名稱、原始欄位值與計算值，並依名稱、collection 或欄位值排序。Query 的 `where` 使用成功計算後的字串做精確相等比對，區分大小寫。缺少或計算失敗的欄位不會誤匹配空字串。內嵌表格保留 200 列上限；「開啟全部結果」提供完整瀏覽與編輯入口。

## 暫定值語法

目前使用可替換的字串模板語法 `grasp-string-v1`，尚未凍結為長期語言規格：

```text
@first_name = "Sean"
@last_name = "Wu"
@full_name = "{first_name} {last_name}"
@greeting = "你好，{full_name}！"

正文裡寫 {{greeting}}。
```

宣告獨立一行，右側是 JSON 字串。名稱以英文字母／底線開頭，後續可用英數、底線、點、連字號。模板 `{name}` 建立依賴；模板中的 `{{`／`}}` 表示文字大括號。Code fence、inline code 與跳脫的 `\{{name}}` 不解析正文引用。循環、缺少定義或超限會顯示診斷；值的更新只改呈現，保留 reference 原文。

```markdown
正文也能引用 {{aura.flame.element}}。
```

````markdown
```grasp-query
{"collection":"aura","where":{"field":"element","equals":"fire"}}
```
````

`where` 可省略。Query 是資料查詢描述，不執行 JavaScript 或 SQL。重新命名若會讓既有 query 的 collection／field 失效，會提示先處理 query；不會默默改寫其語意。

## 檔案、附件與攜帶

**SQLite 是唯一 runtime authority，附件原始 bytes 也在 DB 裡。** `<workspace>.grasp.db.files/` 是旁邊的可讀檔案層：

| 位置 | 用途 |
| --- | --- |
| `exchange/inbox/` | AI 回傳或外部 Markdown，經預覽／確認才進入 DB |
| `exchange/outbox/` | 明確匯出的 `.grasp.md` 與給 AI 的完整資料夾 |
| `mirror/notes/` | 保留原文的不可覆寫修訂檔 |
| `mirror/index/`、`mirror/manifests/` | 每次完整發佈的閱讀索引與重建 metadata |
| `attachments/` | DB 附件的檔案副本 |

檔案面板會顯示絕對路徑、mirror 修訂、更新失敗或外部修改，並提供重新整理／重試。Mirror 在背景建立，檔案失敗不會撤銷已成功提交的 DB 保存；外部修改也不會自動同步回 DB 或被覆寫。修訂檔目前不自動清理。

附件可多選上傳；每個附件上限 64 MiB，inbox 文字上限 32 MiB。PNG／JPEG／GIF／WebP 可在 Live Preview 顯示；SVG、HTML、PDF 等提供下載。新增連結使用穩定的 `grasp-asset:<id>`，已能解析的原始相對圖片路徑／wiki embeds 保留原文。給 AI 的資料夾保留 Markdown 原始語法，因此自訂 identifier、query 和資產連結不保證在其他 Markdown 軟體呈現相同效果。

**攜帶完整工作資料：停止 host 後複製 `.grasp.db` 即可，包含附件。** 若也要攜帶離線閱讀副本、既有 inbox／outbox 和 DB 損壞時的 fallback，將同名 `.grasp.db.files/` 整個目錄一起複製。只有 DB 時，App 可重新產生 mirror；未匯入的 inbox 檔與舊匯出成果不在 DB 裡。運行中不要只複製 DB 主檔。

重建入口在 workspace 對話框，選擇已發佈的 mirror manifest 或完整 AI 匯出資料夾的 `grasp-manifest.json`，再指定新的 `.db`。重建會驗證 metadata 與每個檔案的 checksum，保留實體 ID、建立新的 workspace ID，拒絕覆蓋既有資料庫。被外部修改的檔案不能直接冒充原 manifest 的可信內容，應走 inbox 審查。原 DB 無法開啟時，launcher 仍會提供開啟另一個 DB／重建的畫面。

## 保存與復原邊界

只有已提交 snapshot 進入計算 worker。儲存失敗會保留瀏覽器草稿並阻止替換筆記；可從使用說明下載當前草稿。有 revision 衝突時，先保存草稿，再重新載入。尚未提交的草稿沒有瀏覽器崩潰後的自動復原。

刪除、受控匯入、semantic rename 與復原會保存 DB recovery snapshot。復原預覽列出筆記、資料夾、records、附件的變化，套用會替換整個 workspace 並再保存目前版本。Recovery 在同一 DB 內，離機備份仍應另外保存。普通文字編輯使用編輯器 undo；最近 20 份文件保留本次執行的編輯歷史。

一個 host 同時開啟一個 workspace，尚無即時多人協同。跨分頁過期寫入會遭拒絕。完整 `.grasp.md` exchange 用於原 workspace；跨 workspace 的完整轉移使用 DB 或經驗證的資料夾重建。

## 驗證與封裝

在原始碼 checkout 執行，先完成 build 再跑 production E2E：

```sh
npm test
npm run test:e2e
npm run benchmark
node --import tsx scripts/benchmark-files.ts
npm run package
node scripts/smoke-package.mjs
```

`npm run package` 產生 `artifacts/GraspPortable-0.2.0`；不包含 workspace、私人遷移內容、npm dependencies 或 Node runtime。既有版本目錄拒絕覆寫，`GraspPortable-0.1.0` 保持原樣。Package smoke 在 repository 外的隔離目錄驗證 launcher、靜態資產、保存／匯出／重啟，以及封裝後的附件與 mirror 路徑。

E2E 在 Windows 優先使用已安裝 Edge，其他環境須先 `npx playwright install chromium`。測試資料在 `.cache/`；效能驗證應避開同時執行其他瀏覽器／benchmark。平台、原生中文 IME、非標準 Markdown 與大型資料處理的限制列在下方文件。

- [架構與替換點](ARCHITECTURE.md)
- [Phase 2 驗證紀錄](docs/PHASE2-VERIFICATION.md)與[執行計畫](docs/PHASE2-PLAN.md)
- [計算與編輯器效能](docs/PERFORMANCE.md)、[檔案投影效能](docs/FILES-PERFORMANCE.md)
- [技術決策](docs/DECISIONS.md)與[已知限制](docs/LIMITATIONS.md)
- [完整驗證結果](docs/VERIFICATION.md)、[MainVault 遷移演練](docs/MIGRATION.md)與[額度紀錄](docs/USAGE-LOG.md)

`GraspPortable.slnx` 是起始 repository 的歷史 solution；實際 build 入口為 npm scripts。
