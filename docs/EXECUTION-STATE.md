# Current Working State — GraspPortable

更新：2026-09-28。**完整 A+B 產品 Goal 的 M1–M4 已完成；v0.3 可啟動並驗收。這是 current Working State 的唯一入口。** 新 thread 先讀此頁及下列 locator；不需要原對話、provider memory 或本機未提交檔案才能理解目標及續作。

## 1. Current objective、WHY 與範圍

當前交付是 **正式產品 Goal，完整 A+B，依 M1–M4 自主推進**。使用者於 2026-09-27 明確授權 coding、驗證及每個 coherent milestone 的 commit／push；M1 通過後直接接續 M2–M4，不設例行人工批准。前次 docs-only publication 已在 `6bb2024959d39dc0753e3b0baac6d25cdd45d244` 完成並確認遠端。

本次完整產品 Goal 是兩條配套流程：**A 共享 Identifier／Value 一致編輯**；**B MainVault 副本確定性匯入 → 審查保存分組策略 → 可讀 Markdown → 完整 fallback 重建**。WHY 是自然筆記、可追溯的共享資料與低管理負擔；獨立 DB identities 不必各占一個 Markdown 檔案。日用 Obsidian Vault 尚未切換 authority，Grasp 使用副本。

先完成 M1 語義／往返 gate 再接 M2–M4；不以 codec 或第一個小實驗替代完整產品目標。普通實作問題自行修正，只有需要改變已接受語義、重大產品行為或未裁定資料權限時才交回 Human。

**授權狀態明示**：最新使用者直接要求「現在開始 Goal」完成兩條完整流程，取代前次 docs-only 停點；可以修改產品、tests 及必要設定。各契約記述的 publication-only 授權是歷史背景，不是本次限制。仍待裁定的資料含義／來源政策不因此自動定案。

## 2. Read order 與 authority

| 順序 | Locator | 角色／狀態 |
| --- | --- | --- |
| 1 | [Project Seed 入口](Project_Seed/README.md) | 現行路由；Core Requirements rc.3 ＋ Core Development Method rc.3，WHY／方法 authority |
| 2 | [完整 Goal Plan](GOAL-PLAN.md) | A+B 範圍、技術責任、M1–M4、驗收、Git preflight |
| 3 | [Binding／Reference contract](BINDING-EDITING-CONTRACT.md) | Parsing、serialization、raw literal、multiline、editor、generative invariants |
| 4 | [Shared-value contract](SHARED-VALUE-CONTRACT.md) | Shared commands、draft、persistent cache、transaction／external review、M2 |
| 5 | [Projection contract](PROJECTION-CONTRACT.md) | Semantic units、strategy schema、export／checkpoint／rebuild、M3 |
| 6 | [Reference host gate evidence](REFERENCE-HOST-GATE.md) | 已知 AST 限制、最新 Human 裁定及 M1 待驗矩陣 |
| 7 | [Implementation contract](IMPLEMENTATION-CONTRACT.md)、[Limitations](LIMITATIONS.md) | 當前實作接面及限制；完成證據見各 milestone 報告 |
| 8 | [Verification](VERIFICATION.md)、[Phase 2 evidence](PHASE2-VERIFICATION.md)、[Files performance](FILES-PERFORMANCE.md)、[Migration](MIGRATION.md)、[Usage log](USAGE-LOG.md) | 歷史測試、效能、資料邊界及 quota；按報告版本解讀 |

設計背景三份候選稿已在 Git： [Definition rc.2](Design-References/Legacy-Grasp-Syntax/Markdown_Extension_Definition-v1.0.0-rc.2.md)、[Reference Syntax rc.2](Design-References/Legacy-Grasp-Syntax/Reference_Syntax-v1.0.0-rc.2.md)、[Config rc.1](Design-References/Legacy-Grasp-Syntax/Markdown_Extension_Config-v1.0.0-rc.1.md)。Seed 入口提及「當時遠端未含」是其原始編輯背景；當前實際 tracked files 為準。Pending／carried-forward 不升格成默認政策；被 rc.3／下列決策取代的舊 `@code`、grouped reference、single-line、RHS／更新政策不沿用。

## 3. Settled decisions

- Note-first；binding 自由放置，無 mandatory section/container。Raw literal＋identifier 取值＋`+` composition；真正 fenced code 不作 binding 執行。
- 正文維持 `[value](:ref:Identifier)` 與 `[[@Identifier|value]]`；完整 cached value、identity、composition、dependency、raw source 角色分開。
- **最新 Human 裁定**：「link只是視覺考量，優先確保語意結構正確，link的視覺隱藏不用強求」。不再要求 native Markdown AST 必須保留 outer Link，也不再詢問同一視覺取捨。標記可見可接受；資料、正文邊界與重建仍須正確。不得自行新增第三種 managed form。
- 完整 expression 遇 EOL/EOF 或下一 binding 結束；`=`／行尾 `+` 允許續行；同行接 prose 用 `;`。`@Name = First Last` 報錯；下一行 Markdown `+ item` 不接入前一個完整 binding。
- 共享 UI 操作指向 definition，連同受影響 nested results、persistent caches 一致提交；展開文字不能唯一反推時引導編輯 literal／dependency。外部檔案經 Review／Import，無 silent bidirectional sync。
- Projection member 不限制整篇 Note／Record：stable Binding／Entity identity 可獨立分組。保留 owner／source lineage／原 binding placement；同一 canonical binding 不重複配置、不合併 identities。普通正文以 Note identity 分組。
- DB 唯一 runtime authority；單一 Human-readable projection 共用於 fallback、inspection、AI。按需匯出與完整 checkpoint 共用 exporter；輸出形式可轉換且保留重建資訊，link 隱藏不構成強制轉換理由。

Supplemental 中的 lexical 細節、schema、10 分鐘／兩代 checkpoint、效能預算標為**工程推薦／待 M1–M4 驗證**，不是已測試結果或已默認裁定所有政策。

## 4. Actual implementation and evidence

M1 codecs/context/exact source reconstruction：361 tests/build，已發布 `480f073b69fb7e79dd6d7bcd86c29dcfa243c834`，見 [M1](M1-VERIFICATION.md)。M2 shared commands/drafts/cache/undo/source rebase/Reading：436 tests／32 production E2E，已發布 `9734f06e50ad1ad491104595a0e469263a73f31b`，見 [M2](M2-VERIFICATION.md)。

M3 semantic-unit strategy/scoped planning/review/partial+full renderer/DB-trusted external import/單一 publisher/兩代 recovery/fresh DB 重建已完成。Schema 5 保存策略與可信 baseline；full fallback 保留 source/owner/IDs/dependencies/strategy/provenance/drafts，不承諾 DB operation/history。512 tests／36 production E2E，已發布 `e037741ae2b96e88e75a04b234e8d542a1817815`，見 [M3](M3-VERIFICATION.md)。

M4 全量 MainVault 往返及 source integrity 已獨立發布 `74faacfee9519982c58d0a07ed9581384f4da238`。2,820 原始 notes／244 folders／506 assets 全部原文及附件 hash 一致；策略、partial 隔離、外部匯回、獨立 fallback／fresh DB／重建後 shared 修改與 restart 通過。原 snapshot 3,365 files 及匯入用 Scratch source copy 前後不變。另加一篇明示 synthetic acceptance note；沒有私人語意重分類。

**M4 最终整合通過：41 files／528 tests（12.75s）、production build、36 production Edge E2E（1.8m）、scale10 production browser 2 tests、獨立目錄 package smoke，以及 Sandbox 一鍵入口指向 relocated Acceptance DB 的啟動核對。** 詳見 [M4 verification](M4-VERIFICATION.md) 與其中 JSON evidence。早先單輪在重 IO 下有 browser afterAll timeout，整套 exit1；最終空閒時完整重跑通過，沒有把個別 tests passed 冒充 suite 成功。

Scale10 為 10,000 identifiers／50,000 references／約 1.75M source characters。正文 EOF typing Source p95 204.285ms、Live 319.283ms，原 500ms regression gate 通過；cascade 7.667s，全部 10k results／50k caches 及 IDs 核對；真正 restart/readback 4.054s。12k deep／10k fanout／mixed／反覆小改／SQLite durability 另外量測。**Plan 的 100ms 理想目標及無 ≥200ms 長任務尚未完全達成**；不能擴大 EOF benchmark 為所有編輯位置保證。

完整 corpus 的實際 headless Edge browser：ready 1.652s，Reading／策略／Files／1024×768 無水平 overflow、0 page errors。File locate 改成 content fingerprint＋dirty 檢查，settings/drafts-only 不再強迫 full checkpoint；實測 9.089s，generation 不變。全樹安全檢查仍昂貴；full checkpoint 曾為 93–190s。這些是已知性能成本，不是資料流程失敗。

## 5. Delivery and current stop point

**M1–M4 正式產品工作已完成，停止在可操作 v0.3 交付；沒有等候 Human 的 routine implementation gate，也不是因額度停工。** 最後交付 checkpoint subject：`feat: deliver validated v0.3 acceptance package and scalable editing`；精確 SHA 與是否已推送由 Git history／origin/master 核對，不在同一 commit 填入自己的 SHA。最終回覆提供實際 remote-verified SHA。

程式：`GraspPortable/artifacts/GraspPortable-0.3.0/`，需要已安裝 Node.js 24+，無需 production npm install。雙擊 SandboxRoot 的 `開啟 MainVault 驗收.cmd`，指定新版 Acceptance DB 與 `http://127.0.0.1:43861/`；保留主控台、Ctrl+C 停止。Launcher 核對 build identity／明示 workspace，拒絕沿用不符的舊 host，不自動終止未知程序。本次 launch smoke 的程序已關閉。

驗收資料：`Acceptance/MainVault-Grasp-v0.3/.grasp/workspace.grasp.db`，唯一可讀樹 `Acceptance/MainVault-Grasp-v0.3/Markdown/`；完整 fallback 保留 hidden `.grasp-export/`、正常 Markdown 與附件。驗收副本在 host 關閉時 copy，10,003 files／2,478,018,402 bytes 全 hash 一致，排除 migration checkpoint／temporary exchange／browser screenshots。舊 `Acceptance/MainVault-Grasp/` 160-note rehearsal 保留且不再由入口開啟。

MainVault 原始 snapshot 為 `Acceptance/MainVault-Source/`，只讀且不移動／改寫。Private full-roundtrip／重建樣本／screenshots／copy inventory 在 `Scratch/MainVault-M4-20260928-0147/`；0146 verifier prototype-comparison 失敗樣本保留。Scratch 的 Rebuilt DB 最後另有 After rebuild 測試變更，不當成交付主 workspace。新版 launch/readme 位於 Sandbox root；旧入口備份在 `Scratch/Acceptance-entry-before-v0.3-20260928/`。

Human 可先搜尋 `Grasp acceptance shared workflow`，從 reference 改 M4.Root，檢查 M4.Nested、獨立共享撤銷、Reading、分組策略與筆記檔定位。Obsidian 開啟 `Markdown` 為 vault；從 Explorer 拖 `.md`／附件給 ChatGPT，不需要另建 persistent AI folder。外部檔案必須 Review／Import；DB 保持唯一 runtime authority。

## 6. Remaining limits and next action

下一步是 Human 使用驗收及選定下一輪改善，沒有本輪尚未完成的產品實作待續。合理優先序是大型檔案定位／full checkpoint 成本、長文中段編輯性能，再依真實寫作體感調整 Editor。所有替換點見 [ARCHITECTURE](../ARCHITECTURE.md)／[Implementation contract](IMPLEMENTATION-CONTRACT.md)，不必重寫整個 App。

下列缺口保留，不因自動測試通過就升格成真實桌面證據：

- 本輪沒有 callable Computer Use 所需 node_repl／Windows GUI tool。Obsidian、Explorer 視窗、實體 Windows 中文 IME、真實系統 zoom 尚待現場驗收；API／spawn 不替代畫面。歷史 Notepad 核准不推及未來新 executable。
- 交付是 Windows 本機 browser host，非 native installer；Node runtime 另裝。其他平台、FAT/exFAT／network filesystem、mobile／Sync 未驗。
- 100ms 輸入目標未全面達成；大型 locate 約9s、full checkpoint 約1.5–3分鐘。效能資料逐層陳述，不把 graph time 當 UI time。
- Full Markdown fallback 保留 current sources、IDs、bindings、dependencies、cached/rendered values、owners、策略、lineage、attachments、durable drafts；不複製 DB recovery／operation receipts／共享撤銷歷史。關閉 host 後的完整 workspace DB 複本才保留這些歷史；同磁碟 fallback 不是離機備份。
- 原始候選稿中其他 pending／carried-forward 資料政策沒有擅自定案；cache-only observation 仍不構成共享寫入權。未唯一反推 composition 的情況由 Human 編輯 canonical literal/dependency。

## 7. Repository, Git and quota

SandboxRoot：`C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`；repo 為其中 `GraspPortable`。舊 cwd `...\GraspProject\GraspPortable` 已移走，命令必須指定實際 workdir。異機先 `git rev-parse --show-toplevel`；Acceptance／Scratch 為私有本機資料，remote clone 不附帶是預期。

Branch `master`→`origin/master`，remote `https://github.com/000Sean000/GraspPortable.git`。M4 最後 checkpoint 前 fetch 成功，HEAD/origin 同74faacf、0/0 divergence，保留所有在地成果，沒有 reset／force push／新branch。必要時 command-local `-c safe.directory=<actualrepo> -c http.sslBackend=openssl`，不改全域 config。Git 只納入 source/tests/docs／匿名 benchmark；私人內容、Acceptance、Scratch、dist、artifacts 不推送。

額度最近觀測 2026-09-27 18:21:36 UTC：**71% used、ordinaryUsageAllowed=true**，正常10080分鐘窗口/reset1791128122；詳細收尾紀錄見 [Usage log](USAGE-LOG.md)。使用者重置後從原 Goal 接續，沒有使用 Luna／Reserve／agent reset。100% 或只剩低能力備用模型時仍是實質停工條件，不因本次完成取消後續規則。

每個後續 coherent milestone 依授權 build/tests、更新本頁及必要文件、commit/push、核對遠端。Temporary network 失敗保留 local commit／pending push；credential、protection、conflict／history risk 停 Git mutation，不作破壞性 workaround。
