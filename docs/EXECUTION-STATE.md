# Current Working State — GraspPortable

更新：2026-09-27。**這是 current Working State 的唯一入口。** 新 thread 先讀此頁及下列 locator；不需要原對話、provider memory 或本機未提交檔案才能理解目標及續作。

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

## 4. Actual implementation baseline 與 local state

程式版本 0.2.0；publication 前 Git baseline `187be53ef5138bd9b24bc96a7c76f3a0901dfd04`。TypeScript／CodeMirror／worker ValueGraph／Node 24+／SQLite；路徑與 API 見 implementation contract。

現有 App runtime 仍是逐行 JSON-string binding、brace interpolation／`{{name}}`。M1 已有 `binding-language.ts`／`reference-language.ts` codec、`note-language.ts` context adapter，並驗證新語法穿過既有 raw-source adapter 的 patch／undo；尚未接正式 runtime、DB 或 UI。沒有 stable Binding／Occurrence DB rows、新 persistent-cache transaction 或 semantic-unit strategy。現有 migration rehearsal 是 160 notes／44 folders／11 assets，不是全 MainVault 搬運完成。歷史完整 inventory 為 3,365 files／2,820 Markdown／506 assets；512 MiB aggregate migration cap 與全量 bytes 的落差需 M4 處理，先重新 inventory，不要求讀取每篇私人內容。

歷史 v0.2 build／189 tests／21 production E2E，以及 warm projection 約 9.25 秒，只描述當時實作；不是新契約驗收。新 reference 的 32 個診斷測試曾通過，但僅證明 host 限制。

`VERIFICATION.md` 的 Core Requirements §13／14 項對照使用歷史需求版本，並非 rc.3 的 9 項 mapping；新驗收以現行 Seed＋本次 contracts 為準，不重寫舊報告製造新 conformance 證據。

本 publication 的 baseline validation：2026-09-27 22:23 Asia/Taipei，`npm run build` 成功；使用 `git ls-files 'tests/*.test.ts'` 列出 **23 個已追蹤測試檔**後傳給 `npm test -- <tracked paths>`，**189 tests pass，4.66 秒**，明確排除 untracked diagnostic。沒有重跑 production E2E／benchmark，也沒有以這些舊語法測試聲稱新 codec 完成。Seed、產品 source、tests/config 沒有本輪修改。

前次 publication 排除的 `tests/reference-host-gate.test.ts`，本次產品 Goal 已審閱並重跑 32 tests，納入純 codec checkpoint。它仍只驗證 host AST 限制，不是 Obsidian GUI 或新版語義 conformance。新 codec、generative/adversarial tests 與完整驗證數據見 [M1 evidence](M1-VERIFICATION.md)。本次 `npm test` 共 **26 files／276 tests pass**（4.28 秒）；`npm run build` 通過。沒有修改私人 workspace，未重跑 production E2E。

## 5. Milestone progress、open items、exact stop point

| 段落 | 目前位置／待完成 |
| --- | --- |
| v0.2 Acceptance Preparation | 歷史已完成；保留可啟動版本及既有資料 |
| Continuity publication | 已完成，`6bb2024` 已推送並核對遠端；本 Goal 已從此接續 |
| M1 | **Codec 與有界 context adapter 已完成測試；整體 gate 尚未通過**。308 tests/build 通過。仍有 8-pass context ceiling；synthetic DTO 重建已測，外部表示／source-layout bundle／Obsidian reading 尚未驗完整 |
| M2 | Shared semantic editing、draft／cache／DB consistency 尚待實作 |
| M3 | Strategy review、semantic grouping、完整 exporter／checkpoint／rebuild 尚待實作 |
| M4 | 全副本往返、真實 GUI、failure recovery、性能及整合驗收尚待完成 |

Current handoff point：**M1 context adapter 與 raw-source 整合測試已驗證，準備保存第二個 checkpoint**。第一個 checkpoint `8048da627fc7e27f26d5de6b7ab7fcc295d7fac9` 已推送並 exact remote SHA verified。產品 Goal 仍 active，未宣稱 M1 或 A+B 完成；沒有 routine Human approval gate。沒有尚待 Human 再次確認的 link 視覺取捨。

Continuity review：一個未繼承原對話的 reviewer 從本頁出發，讀 Seed、Plan、三份 contracts、gate 與 baseline/evidence 後，已能恢復 WHY、settled decisions、actual repo、完整 plan、stop point、next action、Git locator 與 quota rule。初次發現缺 Projection／授權措辭不明，補齊後第二次判定 PASS。這是文件續作檢查，不是 M1/M2/M3/M4 產品驗收；Git 發布仍以實際 commit／remote verification 為準。

Open items：新語法 context 與表示重建仍需驗證。**2026-09-27 Human 已接受 M2 的 DB durable draft＋明示 last committed value、語法完整 missing/cycle 可保存且顯示錯誤，以及獨立共享撤銷／本地 Ctrl+Z**，詳見 Shared Value contract 第 3–4 節；這些不再待批准，也尚未實作。外部 observation 更新權限仍未授予，不能套用舊 Config；需要該權限的實際案例才回 Human。Obsidian／Explorer 真實 GUI、IME／zoom 尚缺當次驗證；既有 Notepad approval 及 mock/spawn 不足以證明這些。本次工具列表也無 Browser／Computer Use 操作能力，不反覆初始化或用 shell 冒充 GUI。

## 6. Exact next executable step

1. 確認正常高能力額度；恢复／major milestone 前 status、fetch、比較 HEAD/upstream。保留工作樹，只有需要且安全時 ff-only 同步；目前正常額度仍可用但接近上限。
2. 接續 `src/domain/note-language.ts`：處理合法長 fake-fence chain 觸發 8-pass ceiling 的限制，保留 fail-closed 與 bounded work；不能以無界重掃或只調大常數假裝修好。迴歸案例在 `tests/note-language.test.ts`，必須繼續防止暫時遮蔽外層 opener 導致啟用 payload 內的假 binding/reference。保持 context source offsets，true code／escaped opener／HTML／URL／metadata 排除。
3. `tests/language-source-roundtrip.test.ts` 已證明兩式 patch＋raw EOL／undo、synthetic JSON DTO／composition 重建；下一步完成同 corpus 的實際可讀表示輸出、source-layout bundle 重建與比對。不能以 DTO 測試冒充 M3 full package／fresh DB。
4. 驗證 paragraph／heading／list／quote／table 與實際 Obsidian reading。native Link 外觀不是硬 gate；工具缺口明列，不能聲稱實際 GUI 通過。語义反例先修正，必要時才以具體例子請 Human 裁定。
5. M1 整體完成後更新 evidence、checkpoint／push，直接接 M2–M4。M2 draft/error/undo 政策已接受，直接照 contract 實作；外部 observation 的權限若產生必須裁定的具體案例才提出。

## 7. Branch、checkpoint locator 與 rehydrate

既有 branch `master` → `origin/master`；remote `https://github.com/000Sean000/GraspPortable.git`。Publication commit subject 固定為 `docs: publish durable planning continuity`；不在文件內預填尚未產生的自我 SHA。以下 locator 從 Git history 取得精確 commit，後續 milestones 不需猜本次對話：

```powershell
git log origin/master --format='%H %s' --grep='^docs: publish durable planning continuity$' -1
git log -1 --format='%H %s' -- docs/EXECUTION-STATE.md
git rev-parse HEAD origin/master
git ls-remote origin refs/heads/master
```

原機 sandbox user 若遇 ownership 或 SChannel 問題，可在單次命令加入 `-c safe.directory=C:/Users/ASUS/MyData/AgentWorkspace/All-of-Me/GraspProject/GraspPortableWorkspace/GraspPortable -c http.sslBackend=openssl`；不更改全域 Git config。其他機器使用自己的實際 checkout path。

產品 Goal preflight：2026-09-27 15:08 UTC，fetch origin 成功，HEAD/origin/master 同 `6bb2024`、ahead/behind `0/0`，無需 pull；既有 untracked host diagnostic test 保留。已讀 SandboxRoot/AGENTS.md 與現行 rc.3／contracts。第一個產品 checkpoint subject 為 `feat: add lossless binding and reference codecs`；只 stage 明列 source/tests/docs，禁止 private data／dist 混入。發布狀態以 origin/master 到達該 subject 對應 SHA 為準。

## 8. Local workspace、quota 與 continuation

原機 SandboxRoot：`C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`；repo 是其 `GraspPortable` 子目錄。舊 cwd `...\GraspProject\GraspPortable` 已移走。其他機器從 `git rev-parse --show-toplevel` 定位，不假設同一絕對路徑。

Sandbox 的 `Acceptance/MainVault-Source` 與原 MainVault 唯讀；`Acceptance/MainVault-Grasp/.grasp/workspace.grasp.db` 為既有 rehearsal DB，唯一可讀樹是 `Acceptance/MainVault-Grasp/Markdown`。寫入測試只能在 repo 外 `Scratch` 獨立副本。私人檔案不在 Git，異機 clone 沒有是預期：可先跑 synthetic M1，不得聲稱已驗 MainVault；全量驗收需原機副本。啟動既有驗收用 Sandbox `開啟 MainVault 驗收.cmd`／`README-驗收.md`；一般 repo `npm ci`、`npm run build`、`npm start`（Node 24+），開新 Scratch workspace，勿用私人 workspace 測試新 code。

本產品 Goal quota start：2026-09-27 15:07:39 UTC，Codex account-wide 95% used；純 codec validation snapshot：15:16:52 UTC，97% used；兩次 ordinaryUsageAllowed=true，window 10,080 分鐘、reset `1791048521`。後續觀測見 [Usage log](USAGE-LOG.md)，不要把歷史 snapshot 當未來可用額度。只用正常高能力額度；耗盡或只剩 Luna Reserve／GPT-5.6 Luna 就停止實作、研究、debug、benchmark，不開始長工作、不切 Reserve。只做可負擔的 coherent 保存／validation／commit／push，標 **因額度停止**、留下 exact next step，不把產品標完成。

每個 coherent milestone 已授權直接 commit／push，不重複問 Human。Temporary network failure 保留 local commit／待 push 標記；branch protection、conflict、credential/history risk 停 Git mutation，不破壞性 workaround。Quota 恢復且仍有有效續作授權才繼續。Native 新 executable 若需要 application approval，另取得核准；舊 Notepad GUI confirmation 不涵蓋新 App。
