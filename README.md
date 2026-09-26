# GraspPortable

可以實際操作的第一版：在同一編輯區寫 Markdown、宣告與引用字串值、使用 reactive records/table，並由本機 SQLite 保存 workspace。

## 啟動

**Windows：雙擊 `Start-GraspPortable.cmd`。** 它會開啟 `http://127.0.0.1:43821`，保留主控台供停止服務。此 checkout 已有 production build；第一次從 Git clone 時，launcher 會安裝鎖定依賴並 build。需要 **Node.js 24+**；本機已驗證 Node 24.18。

也可在 repository 目錄執行：

```sh
npm ci
npm run build
npm start
```

開啟瀏覽器後可以完全離線操作。結束前確認左下角「已儲存至 SQLite」，再關閉主控台或按 Ctrl+C。不要把 localhost host 暴露到公網。

開發：`npm run dev`。另開 workspace：左上角 workspace 按鈕，輸入 `.grasp.db` 本機路徑以建立／開啟。預設為 `workspaces/Welcome.grasp.db`；預設 host 會記住上次開啟路徑。指定獨立啟動檔：`npm start -- --workspace "C:\path\My.grasp.db"`。

## 先試這條操作路徑

1. 開啟「從這裡開始」，點進 `@first_name` 宣告，把 Sean 改成自己的名字。
2. 離開該行：`full_name`、`greeting` 與另一份筆記中的 `signature` 一起更新。點值前往定義；右側 References 列出引用位置。
3. 寫一些中文、粗體與清單。Live Preview 保留游標所在行原文；Source 顯示完整語法。Ctrl/⌘+Z 與 Ctrl/⌘+Shift+Z 可 undo/redo。
4. 打開「語法與資料表」，在「資料」側欄修改 Aura record；兩個 table 與 identifier 使用同一資料來源。
5. 匯出 Markdown，修改匯出內容，再「匯入與審查」。檢查原文／新文／records 差異後確認套用。可從「復原紀錄」撤回匯入。
6. 關閉服務再重新啟動，確認筆記、records、values 與模式一致。

## 最小語法

```text
@first_name = "Sean"
@last_name = "Wu"
@full_name = "{first_name} {last_name}"
@greeting = "你好，{full_name}！"

正文裡寫 {{greeting}}。
```

宣告須獨立一行，值是 JSON 字串。名稱使用英文字母／底線開頭，後續可用英數、底線、點、連字號。模板 `{name}` 形成依賴，`{{`／`}}` 表示文字大括號；code fence、inline code 與跳脫 `\{{name}}` 不解析正文 reference。值只更新呈現，不會改寫其他筆記的 reference source。

Record 欄位以 `collection.name.field` 引用。Table view 使用以下區塊；把游標移入或按「編輯查詢」可修改：

````markdown
```grasp-query
{"collection":"aura","where":{"field":"element","equals":"fire"}}
```
````

`where` 可省略。第一版支援精確相等篩選，表格最多呈現 200 筆並顯示總數；所有資料仍保存在 DB。

## 資料與安全

- **SQLite 是唯一 runtime authority。** 瀏覽器編輯草稿是尚待提交的使用者输入；只有已提交 snapshot 會進入計算 worker。匯出檔不會自動同步。
- 關閉 host 後，可攜帶單一 `.grasp.db`。本版使用 DELETE journal、FULL synchronous 與 transaction。運行中不要只複製 DB 主檔。
- 刪除／匯入／復原前會保存 DB 內 recovery snapshot。復原會再保存目前版本；保留最近 100 筆的入口，舊快照不自動清除。
- 匯入須保留匯出 metadata 與邊界；一般 Markdown 可匯入成新筆記。不同 workspace 的完整 exchange 不直接合併。先審查，再單次 token + revision transaction 套用；格式毀損或衝突不會部分寫入。
- 儲存失敗會保留草稿、阻止切換造成遺失，離開時出現提示。可在使用說明下載當前草稿；有衝突時請先備份草稿再重新載入。

## 驗證與交付資料

```sh
npm test
npm run test:e2e
npm run benchmark
npm run package
```

以上驗證指令在 source checkout 執行。E2E 使用已建置成品，Windows 優先使用已安裝 Edge；其他主機須先 `npx playwright install chromium`。測試資料只在 `.cache/`。`npm run package` 產生 `artifacts/GraspPortable-0.1.0`，不包含使用者 workspace，無須 node_modules 即可用 Node 24+ 執行。既有版本目錄會拒絕覆蓋；先自行移開既有套件或更新版本。`node scripts/smoke-package.mjs` 可驗證隔離套件的啟動、保存、匯出與重啟。

- [ARCHITECTURE.md](ARCHITECTURE.md)：責任邊界與替換入口。
- [docs/VERIFICATION.md](docs/VERIFICATION.md)：實測涵蓋範圍、交付稽核。
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md)：benchmark 方法、數值與限制。
- [docs/DECISIONS.md](docs/DECISIONS.md)：技術決策。
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)：未完成能力與下一步。

`GraspPortable.slnx` 是起始 repository 的空 solution，保留作歷史檔；此版本的實際 build 入口是 npm scripts。
