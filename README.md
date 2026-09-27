# GraspPortable 0.3.1

在本機寫 Markdown、管理有資料夾的筆記庫，讓 identifier、records 與查詢表使用同一份資料。SQLite 保存筆記與附件；旁邊的檔案目錄提供可讀 Markdown、AI 交換檔及經過驗證的重建來源。

## 啟動

**Windows：雙擊 `Start-GraspPortable.cmd`，瀏覽器會開啟 `http://127.0.0.1:43821`。** 需要 **Node.js 24+**。`GraspPortable-0.3.1` 套件已包含成品，無須安裝 npm dependencies。其他桌面平台可執行 `node scripts/launch.mjs`；目前正式驗證環境是 Windows／Edge。若同一 port 已有不同版本或 workspace，launcher 會明確拒絕沿用；請關閉自己原先啟動的 host 或使用另一個 PORT。

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
2. **寫作與連動。** 新筆記使用下方 raw literal 語法；從 reference 的「修改共享值」編輯定義，巢狀結果與正文快取一起保存。可跳到 definition、Find References、重新命名，以及獨立「撤銷共享修改」。Source／Live Preview／閱讀模式共用同一筆記；Ctrl/⌘+Z 管理本地輸入。
3. **操作資料。** 在「資料」搜尋 record，修改欄位值，以 collection 或欄位計算值精確篩選。建立 table 筆記；點列名開啟 record，或按「開啟全部結果」分頁瀏覽。欄位詳細資料可查看引用並插入符合目前筆記語法版本的 reference。
4. **分組並取得檔案。** 開啟「分組策略與 Fallback」，可把同篇筆記的兩個共享定義分到不同 `.md`，預覽後保存策略，再建立完整 checkpoint。選取部分資料可直接匯出 Markdown 或下載外部分析 JSON；外部協作者回傳結構化分組提案，再由 App 審查。正常 AI 拖曳從「顯示筆記檔」進 File Explorer 即可。
5. **驗證往返與保存。** 修改已發布檔案的正文或 Definition source 區塊後，在「檔案與 Markdown」審查外部修改；僅改 rendered value 不會自動改寫共享資料。完整重建使用 `Markdown/.grasp-export/manifest.json` 和尚不存在的新 `.db`；保留原 DB，重建後關閉 host 再啟動確認。

## 筆記與知識管理

側欄一次呈現最多 80 個筆記／資料夾，所有頁面都可抵達；全庫搜尋附路徑與內容片段。最近開啟保留 20 筆。相同標題可在不同位置存在；`[[筆記]]`、Markdown 路徑連結、標題錨點和反向連結由「連結」面板檢查。缺失或同名歧義會顯示，不會任意猜測目標。移動筆記不會自動改寫其他筆記的文字路徑。

Identifier 面板可依名稱、namespace、來源與狀態篩選，definitions、references、diagnostics 和依賴清單都有分頁。重新命名前先看精確修改、碰撞、缺少定義與循環的變化；套用時檢查 workspace 修訂，並保存復原點。既有 record／欄位名稱使用同一條受控重新命名流程。

Records 可搜尋名稱、原始欄位值與計算值，並依名稱、collection 或欄位值排序。Query 的 `where` 使用成功計算後的字串做精確相等比對，區分大小寫。缺少或計算失敗的欄位不會誤匹配空字串。內嵌表格保留 200 列上限；「開啟全部結果」提供完整瀏覽與編輯入口。

## 新筆記的值語法

新筆記明示 `grasp-v1`。Binding 可放在正文適合的位置；literal 內容原樣保留，`+` 串接文字與 identifier 取值：

```text
@first_name = <|Sean|>
@last_name = <|Wu|>
@full_name = first_name + <| |> + last_name
@greeting = <|你好，|> + full_name + <|！|>

正文裡寫 [你好，Sean Wu！](:ref:greeting)。
另一種寫法：[[@full_name|Sean Wu]]。
```

Literal 可包含換行、Markdown、空字串；內容含 `|>` 時使用 `<||...||>` 等配對 delimiter。完整 expression 在行尾／EOF／下一個 binding 結束；行尾 `+` 可續行，同行接正文用 `;`。真正的 code fence 不執行 binding。缺少定義、循環或超限會保存結構並顯示錯誤；上一個成功值會有明確標示。打到一半的 literal 保存為可恢復草稿，不取代已提交共享值。

```markdown
正文也能引用 [fire](:ref:aura.flame.element)。
```

````markdown
```grasp-query
{"collection":"aura","where":{"field":"element","equals":"fire"}}
```
````

`where` 可省略。Query 是資料查詢描述，不執行 JavaScript 或 SQL。重新命名若會讓既有 query 的 collection／field 失效，會提示先處理 query；不會默默改寫其語意。

原有範例、舊筆記及直接遷入的 Markdown 明示 `legacy-v0.2`，沿用 `@name = "JSON string"`、`{dependency}` 與 `{{reference}}` 相容語法；不自動重寫私人筆記。Record 欄位目前仍使用既有 `{identifier}` template 編輯。詳見 [語法契約](docs/BINDING-EDITING-CONTRACT.md)。

## 檔案、附件與攜帶

**SQLite 是唯一 runtime authority，附件原始 bytes 也在 DB 裡。** 一個 human-readable projection 同時供 Obsidian、AI 上傳、人工檢查與重建使用，不再產生第二套 persistent AI folder。

驗收 workspace 的外觀：

```text
MainVault-Grasp/
├─ .grasp/
│  ├─ workspace.grasp.db
│  ├─ manifests/
│  ├─ recovery/
│  ├─ internal/
│  └─ exchange/
└─ Markdown/
   ├─ <logical folders / reviewed groups and ordinary .md files>
   ├─ _Attachments/
   └─ .grasp-export/
      ├─ manifest.json
      ├─ recovery.json
      └─ <coverage and reading metadata>
```

將 `Markdown/` 當 Obsidian vault 開啟。它代表最後成功發布的完整 generation；DB 編輯約每 10 分鐘合併 checkpoint，也可立即手動建立。身分、原文、巢狀計算、策略與必要重建 metadata 隨隱藏的 `.grasp-export` 一起攜帶。外部編輯、遺失檔案或衝突會顯示 dirty 並擋住替換；「審查外部修改」列出差異，確認後才更新 DB。Public metadata 不能自行授予共享寫入權限。

工具列「顯示筆記檔」直接在 File Explorer 選取目前筆記；「開啟資料夾」開啟目前筆記所在資料夾。筆記／資料夾操作選單及附件列也有 Explorer 入口。檔案面板顯示 absolute paths、workspace root、Markdown root；inbox/outbox 與重建 metadata 收在進階區。無須先 export 才能拖檔給 ChatGPT。

一般 Markdown 匯入仍會新增筆記；帶原 workspace IDs 的 `.grasp.md` exchange 更新既有資料。對已發布 projection 的外部修改，使用其專用審查入口才能依 manifest 辨識原筆記。`.grasp/exchange/inbox` 保存待審查回傳；outbox 只保存明確產生的 controlled exchange 檔，不建立另一套完整 projection。

附件上限 64 MiB；PNG/JPEG/GIF/WebP 可在 App Live Preview 顯示。Projection 將成功解析的 note／asset links 映射到相對實體路徑，保留完整可讀值；未包含、缺失或歧義目標會標示。它是有定位與審查區塊的普通 Markdown，不保證與原始筆記排版完全相同；query、Mermaid、Excalidraw 等專用執行功能仍有平台限制。

以 `.grasp/workspace.grasp.db` 開啟時，workspace root 為其上兩層。既有任意位置的 `.db` 仍使用旁邊的 `<db>.files/` 作為 projection root，內部同樣採 `Markdown/` + `.grasp/`。舊 mirror 不自動刪除；驗收準備已把本機舊演練與交換資料移到 SandboxRoot/Scratch 保留。

停止 host 後，攜帶整個 workspace，包括 `Markdown` 與 `.grasp`。DB 單檔仍含全部已提交內容及附件；未匯入 inbox 和外部 dirty 檔案不在 DB。不要直接編輯 database、manifests 或 internal recovery。從已發布 manifest 重建只會建立全新的 DB，驗證 checksum 並保留 entity IDs；外部修改過的 projection 須先審查，不能冒充原始 checksum。

## 保存與復原邊界

只有已提交 snapshot 進入共享計算。未完成草稿另存 SQLite，會顯示「草稿已保存」並可在重啟後恢復；草稿保存前的最後輸入仍可能因突然中斷而未落盤。衝突時保留兩份內容供比較，不猜測如何從展開文字反推 composition。重建帶回的草稿先列為手動恢復，避免自動提交舊稿。

刪除、受控匯入、semantic rename 與復原會保存 DB recovery snapshot。復原預覽列出筆記、資料夾、records、附件的變化，套用會替換整個 workspace 並再保存目前版本。Recovery 在同一 DB 內，離機備份仍應另外保存。普通文字編輯使用編輯器 undo；最近 20 份文件保留本次執行的編輯歷史。

一個 host 同時開啟一個 workspace，尚無即時多人協同。跨分頁過期寫入會遭拒絕。完整 `.grasp.md` exchange 用於原 workspace；跨 workspace 的完整轉移使用 DB 或經驗證的資料夾重建。

## 驗證與封裝

在原始碼 checkout 執行，先完成 build 再跑 production E2E：

```sh
npm test -- --maxWorkers=4
npm run test:e2e
npm run benchmark
node --import tsx scripts/benchmark-files.ts
npm run package
node scripts/smoke-package.mjs
```

`npm run package` 產生 `artifacts/GraspPortable-0.3.1`；不包含 workspace、私人遷移內容、npm dependencies 或 Node runtime。既有版本目錄拒絕覆寫。Package smoke 在 repository 外的隔離目錄驗證 launcher、build identity、靜態資產、保存／匯出／重啟，以及封裝後的附件與完整 Markdown 路徑。新版語義 benchmark 使用 `node --expose-gc --import tsx scripts/benchmark-shared.ts`；歷史 benchmark 的語法版本與結果另列。

E2E 在 Windows 優先使用已安裝 Edge，其他環境須先 `npx playwright install chromium`。測試 workspace 在 repo 外的 `SandboxRoot/Scratch/AutomatedTests/`；效能驗證應避開並行 benchmark。原生中文 IME、Obsidian／Explorer 桌面操作與 browser automation 證據分開記錄。

- [架構與替換點](ARCHITECTURE.md)
- [目前完整 Goal 的執行狀態](docs/EXECUTION-STATE.md)、[共享編輯證據](docs/M2-VERIFICATION.md)、[Projection 契約](docs/PROJECTION-CONTRACT.md)
- [Phase 2 驗證紀錄](docs/PHASE2-VERIFICATION.md)與[執行計畫](docs/PHASE2-PLAN.md)
- [計算與編輯器效能](docs/PERFORMANCE.md)、[檔案投影效能](docs/FILES-PERFORMANCE.md)
- [技術決策](docs/DECISIONS.md)與[已知限制](docs/LIMITATIONS.md)
- [本機驗收目錄與入口](docs/ACCEPTANCE.md)
- [完整驗證結果](docs/VERIFICATION.md)、[MainVault 遷移演練](docs/MIGRATION.md)與[額度紀錄](docs/USAGE-LOG.md)

實際 build 入口為 npm scripts。
