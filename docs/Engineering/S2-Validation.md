---
title: GraspPortable — S2 Validation
version: 1.4.0
updated: 2026-10-04
status: engineering-and-native-gui-partially-verified
---

## 判定與發行範圍

S2 的 Markdown adapter／coordinator 已接入實際 Host，App／Host 使用 protocol 3。已保存原文與最後接受的 AST／診斷分開；無效外部原文保留並標示 Stale，外部版本與 dirty draft 衝突不以舊文字覆蓋。實際檔案樹與右鍵操作已有工程與有限 Windows GUI 證據，**S2 仍為 PARTIAL，沒有宣告使用者接受或完整共同編輯驗收通過**。

App／Host 已重新發布，包含最新版 link codec、tree 自動選取、本機圖片與 wiki 導航。下方補記實測範圍；後續分組及 Records 尚未沿用這份 GUI 證據。

## 2026-10-04 原生操作證據

### Obsidian 共同編輯實測（13:00 左右，S4 驗收 workspace）

使用已安裝 Obsidian 1.13.7 的「Open folder as vault」開啟獨立 `workspaces/S4-Acceptance-1004`，沒有使用日用 vault。Grasp 尚未啟動時，由 Obsidian 在「連結驗收－來源」加入 `Interop.Value`、兩層 composition 與兩式 references；Grasp 重開自動讀入，revision 27 的三個 definitions 為 Valid，兩式 reference cache 更新亦在 Obsidian 可見。

兩個程式同時開啟時，從 Obsidian 修改 `Interop.Value` 的 literal，Grasp 自動更新至 revision 28；兩層相依與 Obsidian 中的引用同步，無診斷。

接著僅從 Obsidian 修改同篇筆記末尾的 wiki-style reference 顯示值，卻收到 `shared-source-conflict`。Grasp 保留外部新原文、標示 Stale，未錯誤發布舊值為最新成功結果，但本案應可唯一對應 literal，因此是實作缺陷，不能將共享回寫驗收標記通過。已定位同檔來源 guard 過度拒絕純 reference cache 變化，修正及重驗結果續記於下方。App／Host 已正常關閉，程序不存在。

以上是真實 Obsidian GUI 證據；尚未涵蓋外部改檔名、dirty／IME 競態或所有共同編輯流程，S2 仍 PARTIAL。

### 同篇共享回寫修正及原生重驗

Core 現在僅放行 classifier 已證明的純 cache 修改；真正 mixed source、dirty draft、stale owner、版本或值矛盾仍保留衝突。改写使用候選原文的 AST 範圍，前置 reference 長度改變不會使 literal 定位偏移。新 Coordinator 定點 2 組與既有跨筆記 shared 1 組通過，涵蓋兩式 reference、多段值、CRLF、ID、兩層相依、另一實檔 cache、own echo，以及 mixed／dirty 拒絕。

13:08:25 Host／13:08:34 App 發行。由 Obsidian 將先前失敗的測試 reference 恢復為已接受值，Grasp 重開至 revision 30、診斷零；再由 Obsidian 只改同一 reference 的顯示值，新版成功回寫 literal，兩層相依更新至 revision 31、全部 Valid。回到 Obsidian 亦親眼確認定義與兩式引用為新值。未使用 API 代替此次 GUI 操作，也未要求自動猜測先前衝突意圖。

另外的唯讀審查確認：已有引用的筆記在外部新增／移除引用，會因 classifier 的 topology 限制被一律保留為衝突；這與一般外部編輯流程不符，列為下一修正。新引用不應冒充共享改值，既有 carrier 無法唯一配對或同時改值時仍需保護。本段未修改這一分支。

### 較早的 S2 檔案樹流程

獨立驗收 workspace：`C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable\workspaces\S2-Review-1004`。此資料夾及產生的驗收資料均在忽略區，不進 Git。

1. 由實際 Windows App 的 Projects 右鍵建立資料夾，再在子資料夾右鍵建立 `右鍵新筆記.md`。
2. 貼入中文正文與 `TreeCheck` 定義，確認自動保存。
3. 由右鍵將檔案改名為 `重新命名驗證.md`，再移動至 Notes；實體位置、正文與 definition 保留，note ID 前綴仍為 `3d3aba5a`。
4. 以 shell 模擬外部 editor 修改檔案中的值為「外部修改也保留身分」，GUI 自動反映變動，身分保持。
5. 正常關閉並重開 App，搜尋「重新命名」、開啟該筆記，確認相同 ID、值與路徑。完成後已關閉 App，前台釋放。

這是原生 Grasp UI 加上外部檔案修改的證據；**未在本段操作 Obsidian GUI，沒有重測原生 IME，也沒有量化端到端效能結果**。複製路徑／reveal 接面已實作，但上述紀錄不構成兩者完整原生驗收。

## 本機圖片、改名連結及還原補驗

同一 Windows App 與 `S2-Review-1004`，新增合成色塊 PNG 與 `Notes/圖片連結驗證.md`。Live Preview／Reading 均顯示相對 Markdown image 及 wiki image；wiki 筆記連結可開啟相同 note ID。JSON fence 的 wiki 文字保持展示內容。

右鍵將 `Notes/重新命名驗證.md` 改為 `Notes/右鍵連結改名驗證.md`：預覽包含來源及 incoming link 檔案；套用後 ID `3d3aba5a`／TreeCheck 保留，另一筆記的 wiki 目標改寫，GUI 點擊可導航。

備份介面手動 capture 成功、restore 至新資料夾並開啟，筆記及圖片可讀。**發現 GUI 選單顯示新版但 state 保留舊 generation 的問題，實際還原的是較舊備份；已修 capture 後明確選取新版及 keyed select，尚待重新發布重驗，不能標記整項通過。** 本次還原目錄為 `workspaces/S2-Review-1004-Restored-20261004-041108`。正常關閉，App／Host 都已結束，前台釋放。

Content resolver 44 assertions、editor regression／TypeScript、App／Host 發行通過。未以此取代 Obsidian GUI、原生 IME 競態或量化效能驗收。

## 有界工程驗證

2026-10-04 10:30 原生重驗：最新發行 App 在同一工作區按「立即建立備份」，選單更新為 10:30:25；按「還原至新工作區」成功建立 `workspaces/S2-Review-1004-Restored-20261004-103009`。其 `.grasp/restore-receipt.json` 的 SourceGeneration 明確為 `generation-20261004T0230258277980Z-d447f320557f459e899e0b18dcaf4ea6`，與畫面新建版本一致；還原 Notes 保留最新的 `右鍵連結改名驗證.md`。本次確認 generation 選取缺陷已修，不代表尚未執行的所有還原故障案例都通過。

以下為本段已取得的結果；assertions、fixtures、groups 沿測試 runner 的計量，不混加為涵蓋率。

| 範圍 | 已通過結果 | 證據邊界 |
| --- | --- | --- |
| Sources | 59 assertions | 原文版本、語意接受與來源狀態 |
| MarkdownWorkspace | 12 groups | Markdown／SQLite adapter 整合、重開與來源保護 |
| Coordinator | 7 groups | 協調及實際 filesystem watcher；不等於 Obsidian GUI |
| Migration | 42 assertions | schema 1 舊 DB 複製至新的相鄰資料夾，保留舊環境 |
| FileActions | 15 fixtures | 檔案／資料夾操作、ID、byte guards、重試／恢復及有限 link codec；最新版尚待發布後 GUI |
| Host HTTP | 43 assertions | 實際 Host 接面、關閉備份、新資料夾還原及重新啟動 |
| FileOperations | 62 assertions | journal、衝突版本保存及恢復 primitive |
| Markdown envelope | 12 groups | YAML identity 與原文邊界 |
| ExternalEdits | 15 fixtures／68 assertions | 外部編輯意圖、來源及衝突保護 |
| 既有 Core／SQLite | Core 162、SQLite 63；本段較早通過 | 不將既有結果當作新增跨檔流程的全部覆蓋 |
| S3 backup primitive／manager | 39 assertions／9 groups | 備份與還原、排程及重試；UI 已接入建置，尚待原生操作 |

檔案操作的有限 codec 支援可唯一辨認的相對 Markdown links／images、reference-definition 與 wiki links，保留 anchor／alias／title；排除 fence、inline code、Grasp literal／reference cache。受影響檔案列入 preview、dirty 與 hash guards。歧義 wiki、相關未解析目標、未完成連結、HTML 相對連結、case-only rename 及將 `.md` 改為其他副檔名目前明確拒絕，不猜測改寫。來源與附件的 before bytes 保留於 operation journal；未宣稱跨多檔 ACID。

## 尚未完成與下一步

- 已補最新 link codec／tree／本機圖片 GUI；備份 generation 選取於 10:30 重驗通過，完整還原範圍另驗。
- Obsidian 關閉期間新增／重開、同時開啟時定義更新已有上方證據；共享引用值回寫缺陷修正與重驗、外部改名、衝突解決及 IME／dirty 時序仍待完成。
- S1 剩餘政策 GUI、DPI、端到端流暢度；本次沒有新的性能數字。跨檔 journal／完整 snapshot 的成本尚未證明符合成長門檻。
- S3 分組、checkpoint 排程／介面與 restore UI；S4 長文屬性／Records／凍結表格。

下一個版本沿 [Implementation Plan rc.9](Implementation-Plan-v1.0.0-rc.9.md) 繼續，不因這份 checkpoint 停止 Goal，也不標記 S1／S2／S3 或 Goal 全部完成。
