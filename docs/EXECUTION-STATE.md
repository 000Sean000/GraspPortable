# Current Working State — GraspPortable

更新：2026-09-28。**使用者重置額度後已恢復執行，完整 A+B Goal 未完成。這是 current Working State 的唯一入口。** 新 thread 先讀此頁及下列 locator；不需要原對話、provider memory 或本機未提交檔案才能理解目標及續作。

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
| 7 | [Implementation contract](IMPLEMENTATION-CONTRACT.md)、[Limitations](LIMITATIONS.md) | v0.2 實作事實基線，不是新規格完成證據 |
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

M1 codecs/context/exact source reconstruction：361tests/build，已發布 `480f073b69fb7e79dd6d7bcd86c29dcfa243c834`，見 [M1](M1-VERIFICATION.md)。M2 shared commands/drafts/cache/undo/source rebase/Reading：436tests／32productionE2E，已發布 `9734f06e50ad1ad491104595a0e469263a73f31b`，見 [M2](M2-VERIFICATION.md)。

M3 semantic-unit strategy/scoped planning/review/partial+full renderer/DB-trusted external import/單一publisher/兩代recovery/freshDB重建/App UI 已完成。Schema5保存策略與可信baseline；fullfallback保留source/owner/IDs/dependencies/strategy/provenance/drafts，附件逐項讀取，不承諾完整operation history。**38files／512tests pass（9.19s）、build pass、36productionEdgeE2E pass（1.3m）**，見 [M3](M3-VERIFICATION.md)。

M4全量MainVault往返已通過：2,820notes／244folders／506assets，原文及附件全部hash一致；策略、partial隔離、外部匯回、獨立fallback／fresh DB／重建後shared修改與restart均驗證。原snapshot 3,365files及Scratch來源副本前後不變。詳細與93s／190s checkpoint成本見 [M4](M4-VERIFICATION.md)。現有Acceptance/MainVault-Grasp仍是舊160-note rehearsal，尚未部署新版。

## 5. Current point and remaining work

**M3已發布e037741ae2b96e88e75a04b234e8d542a1817815；M4全量資料往返通過，正在保存此獨立驗證段落，完整A+B Goal尚未完成。** 本段subject為 `test: verify complete vault roundtrip and source integrity`；精確SHA從Git取得並核對origin/master，不預填文件自身SHA。

M4剩下大型互動性能、新package／驗收workspace／launch note，以及當前source的最終build/tests/browser回歸。全量資料庫實際browser Reading／策略／Files／1024×768檢查通過，0pageerrors，啟動ready1.73s；發現settings-only觸發不必要fullcheckpoint的file-locate路徑，修補及tests已在working tree，尚待整合。

尚未提交產品段落：v0.3 launcher build identity／workspace核對、editor線性cache patches／CRLF mapping／range index、file-locate修正、benchmark與成品browser腳本、README/limits等。不要丟棄。Fullunit一輪522tests全過但browser afterAll在重IO下10s timeout，因此整套exit1，須空閒時重跑；不得記成全suite通過。10k/50k typing最新仍Live p95約645ms，未通過500ms regression gate，正在profile；早先88.433s cascade也須重測，失敗樣本保留。核心100ms理想預算沒有冒稱達成。

Human已接受durable drafts＋保留已提交值、完整missing/cycle保存且報錯、獨立共享undo；已實作，不再待批准。外部rendered/cache observation未取得共享寫入權限；不可唯一反推composition時編輯canonical literal/dependency。

Computer Use skill已讀，但目前沒有其需要的node_repl／Computer Use callable tool。Playwright實際production browser操作可用；Obsidian／Explorer／原生Windows IME／真實zoom缺當次desktop證據。API/mock/spawn不替代画面，依環境fallback授權完成其他工作並明列缺口。

## 6. Exact next executable steps

1. 保存本段verifier／匿名資料證據checkpoint並push；後續沿用完整A+B授權，不開新Planning gate。
2. 修正profile所示大型input熱點；fresh build跑GRASP_PERF_SCALE=10 tests/e2e/shared-performance.spec.ts，完整50kcache／identity／restart都要驗。不刪慢sample或放寬gate。另跑 scripts/benchmark-shared.ts（12kdeep／10kwide／mixed／30edits／SQLite），每項benchmark獨占重型runner。
3. 新版host的file-locate修正需在完整Scratch workspace重驗，script為scripts/verify-acceptance-browser.mjs；不要測原snapshot。最新成功全量資料在Scratch/MainVault-M4-20260928-0147/Imported；初次browser已closehost，可安全copy。舊0146失敗是verifierprototype比較，保留。
4. copy關閉且一致的Imported到Acceptance/MainVault-Grasp-v0.3，排除temporary migration checkpoint／Browser-verification／exchange測試輸出，保留DB／Markdown／recovery及metadata，hash核對。舊rehearsal保留。Rebuilt最後After rebuild尚未另發布projection，不直接當最新版交付。
5. 完整unit與productionE2E／freshpackage smoke／README及launch入口／成品browser，最後M4 checkpoint/push。全量往返已通過，只有後續相關改動才需要重跑全部約7分钟資料鏈。

## 7. Repository, local data and quota

SandboxRoot：C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace；repo為其中GraspPortable。舊cwd ...\GraspProject\GraspPortable 已移走，命令必須指定實際workdir。異機先git rev-parse --show-toplevel。

Branch master→origin/master；remote https://github.com/000Sean000/GraspPortable.git 。本次M3前fetch成功，HEAD/origin同9734f06、0/0；提交前再次fetch仍0/0。需要时可單次加入 -c safe.directory=<actualrepo> -c http.sslBackend=openssl，不改全域config。只stage本段source/tests/docs；私人資料/dist/node_modules不入Git。

Acceptance/MainVault-Source與原MainVault唯讀；Acceptance/MainVault-Grasp/.grasp/workspace.grasp.db及Markdown為舊rehearsal。測試位於Scratch。原啟動入口Sandbox/開啟 MainVault 驗收.cmd及README-驗收.md尚待M4更新；一般repo npm ci、npm run build、npm start需Node24+。異機缺私人資料是預期，不得因此聲稱全量驗證。

最新quota約2026-09-27 18:06UTC：**66%used、ordinaryUsageAllowed=true**，正常10080分鐘窗口/reset1791128122；M3的55%至此+11pp約27分鐘，帳戶觀測非任務帳單。歷史前窗口100%已依規則停工，使用者重置後恢復；未用Luna/Reserve/agent reset。詳見 [Usage log](USAGE-LOG.md)。達100%或只剩Luna/Reserve時停止實質工作，只安全保存coherent checkpoint，未完成就標因額度停止。

已授權每個coherent milestone commit/push。不因普通實作問題新增Human gate。Temporary network失敗保留commit/待push，credential/protection/conflict/history risk停Git mutation不繞過。Native新executable的application approval與舊Notepad確認分開。
