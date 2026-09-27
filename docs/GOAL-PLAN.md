# 下一個 Goal：共享編輯與可攜往返

更新：2026-09-27。狀態：完整 A+B 的配套 Plan／執行基線；**link 視覺取捨已裁定**。Current objective、授權、progress、stop point 與 next action 只由 [EXECUTION-STATE.md](EXECUTION-STATE.md) 路由。本文件不冒稱 v0.2 已完成新的契約。

## 決策入口

- **A 共享編輯**：從任一 reference 操作其共享定義，原子更新 binding、受影響的巢狀結果及持久 cached values；未完成草稿與已提交資料分離。
- **B 可攜往返**：MainVault 副本確定性匯入 DB → 審查並保存結構化 Projection Strategy → 確定性 Markdown → 外部閱讀 → 完整 fallback 重建。
- **本次修正**：策略成員是 stable semantic units，不能永久限制為整篇 Note／Record。同一 Note 的 `Fruit` 與 `Person.Job` 可以分配不同輸出群組；原 owner、source lineage、binding placement 保留。
- **最新已定優先序**：Human 指定「link只是視覺考量，優先確保語意結構正確，link的視覺隱藏不用強求」。原生 parser 不保留 outer Link 或顯示標記，不再單獨構成 gate 失敗；值／依賴失真、誤吞正文、無法重建仍必須停。兩種 forms 不增加第三種。證據與 gate 見 [REFERENCE-HOST-GATE.md](REFERENCE-HOST-GATE.md)。不再要求重答同一視覺取捨。
- 語法及編輯細節見 [BINDING-EDITING-CONTRACT.md](BINDING-EDITING-CONTRACT.md)；共享交易／快取見 [SHARED-VALUE-CONTRACT.md](SHARED-VALUE-CONTRACT.md)；分組、checkpoint 與還原見 [PROJECTION-CONTRACT.md](PROJECTION-CONTRACT.md)。一般 HOW 是推薦實作契約，不是已完成或已實測證據。

## 來源及事實基線

Authority 由 [Project_Seed/README.md](Project_Seed/README.md) 路由到 Core Requirements rc.3、Core Development Method rc.3；使用者後續明確決策優先。三份本機 Definition rc.2／Reference Syntax rc.2／Config rc.1 位於 `Design-References/Legacy-Grasp-Syntax/`，是設計候選背景。

候選稿的 data roles、identity／observation／resolved value 區分與 nested composition 可沿用；舊 grouped body reference、固定 `@code` 入口、single-line value、quoted literal／bare RHS 舊規則，以及另按更新才維護所有引用的舊政策，已被 rc.3／對話決策取代。C03 pending 不可解讀為舊「所有來源同權」默認有效；其餘 carried-forward 不自動升格為接受政策。

實際 SandboxRoot 為 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`；repo 是其中 `GraspPortable`。`Acceptance/MainVault-Source` 與原 MainVault 唯讀；所有可寫實驗放 `Scratch` 獨立副本。私人內容、生成 Markdown／附件均不進 Git。

| 層次 | 現有 source／歷史證據 | 本次需完成的差距 |
| --- | --- | --- |
| Language | `src/domain/knowledge.ts` 逐行 JSON string binding；`template.ts` interpolation；正文 `{{name}}` | 新 raw literal／composition／兩種 reference，版本化 compatibility adapter |
| Identity | `model.ts` 有 Note／Record identity，Definition／Reference 以名稱及 source range 表示 | Stable Identifier／Binding／Occurrence identity、版本化 source mapping |
| Editing | `src/app/main.ts` 350 ms 存 raw note，再更新 runtime；未提交草稿主要在記憶體 | Semantic command、可恢復 draft、持久一致 caches、範圍 patch 保留 caret／IME／undo |
| Files | `server/api.ts` mutation 後排程整樹 projection；`server/files.ts` 單一 Markdown 樹 | 按需匯出＋有狀態的 checkpoint，共用 semantic-unit exporter |
| Migration | 160-note／11-asset rehearsal；舊全量 inventory 2,820 Markdown／506 assets | 全副本實際匯入、streaming／可恢復流程及完整比對；不能冒稱 rehearsal 等於全量成功 |
| Performance | 合成 2,820-note warm one-note publication 約 9.25 秒 | 避免打字觸發全樹發布；輸入、計算、提交、檔案延遲各自量測 |

歷史 build／189 tests／21 E2E 只驗證當時 v0.2；本次新規格不得援引為完成證據。上述 migration count 是歷史 inventory，不是本輪重新盤點。現有 migration 512 MiB aggregate 與全 snapshot 規模有落差，完整流程須處理，不要求 Human 拆私人資料來迴避完成條件。

## 已接受方向與待驗證細節

沿用已接受的 statement boundary：完整 expression 在 EOL／EOF 或下一個 binding 結束；`=` 或行尾 `+` 可續行；同一行接普通正文以 `;` 分隔；`@Name = First Last` 報錯；下一行 `+ item` 不被已結束的 binding 吃掉。

沿用已接受的 export conversion：canonical identity 與兩種 reference 可映射為輸出檔案＋穩定錨點；外部 Markdown 不必保持 canonical source 的完全相同拼寫。依最新裁定，宿主 block／link 的視覺呈現可以不同，但 Grasp 必須明確解析並保留完整 logical value、composition、相鄰正文及重建 mapping。輸出轉成普通區塊／links 是可選表示方式，不為隱藏 identifier 強制轉換。這不等於多段值／Obsidian／重建已通過驗證。

普通工程細節可自主補齊：transaction／revision checks、graph evaluation、review token、path collision、哈希、staging／recovery、adapter API。會改變同一合法 source 的意思或共享修改權限者，先提出 expected input/output 給 Human。

## 實作方案與替換點

保留現有 TypeScript、CodeMirror、worker／ValueGraph、SQLite 與本機 host；只替換責任有落差的部分。此決定來自現有可用模組與範圍控制，不是重新進行 stack 選型。

1. **Binding Language adapter**：Grasp-owned AST、raw spans、ordered parts、diagnostics、parse／serialize；第三方 Markdown AST 不流入 domain。舊語法按 source version 讀取，未知語法保留原文。
2. **Semantic Change service**：IdentifierID／BindingID 命令、受影響集、revision-bound evaluation、atomic commit；DB 同一 revision 保存 authoritative definition、results、occurrence caches 與必要原文。超時／取消／衝突不提交半套結果。
3. **Editor adapter**：draft 與 committed snapshot 分離；用具版本的 source patches，映射 selection／undo；不能把全文件 `setDocument` 當成每次 cache 更新方式。
4. **Persistence adapter**：identity、composition、source mapping、cached revision、strategy、draft/recovery 的持久化；既有資料 upgrade 前保留獨立可驗證 backup。
5. **Projection／Strategy adapter**：normalize semantic members、validate／review／apply、deterministic exporter、partial/full manifest、rebuild。檔案位置不決定 canonical identity。
6. **Platform Host**：檔案取得、absolute path、Explorer reveal／open、workspace lifecycle。OS GUI 結果與 API 成功分開驗證。

不得把 parser/evaluator/DB/Editor 的所有型別合成新的 framework；以這兩條流程實際用到的 contracts 為界。

## Milestones 與完成判準

| Milestone | 可獨立驗收成果 | 必要證據與停止條件 |
| --- | --- | --- |
| M1 語法與表示 gate | 兩種 reference 的語義解析；raw literal／composition codec | Generative round trips；LF/CRLF／pipe／empty／lone CR；multiline／multi-paragraph、Markdown context、實際 Obsidian reading、serializer、reconstruction。單純無 outer Link／標記可見不判失敗；發現資料／語義損壞或無法重建則停，不開始 M2 |
| M2 共享一致編輯 | 建 binding → reference → 從引用修改 → nested 更新 → restart 仍一致 | Literal／composition／rename；草稿中斷；missing/cycle；stale/取消；atomic failure；cache/version invariant；IME/undo/caret 操作 |
| M3 策略與 fallback | 同一 Note 的兩個 bindings 獨立分組；Review／Apply；外部可讀；fresh DB rebuild | 重複 canonical assignment、source slots/lineage、partial coverage、unassigned、stale proposal、attachment bytes、path relocation、failure injection、保留版本 |
| M4 整合驗收 | 全 MainVault 副本匯入 → 策略 → 外部閱讀 → 重建 → 重新共享修改 | 來源前後 count/hash；必要資訊逐項核對；真實 Explorer／Obsidian；阻擋流程 UI 修正；性能報告及已測平台界線 |

視覺取捨已接受，依 Working State 執行 M1；通過後接 M2–M4，不另設例行 Human gate。M1 先以 synthetic DTO／source bundle 證明表示重建，M3 再做完整 fresh-DB rebuild；不可用前者冒充後者。一次實驗不代表全部未知政策已接受。實際 codec 進度與證據見 [M1 verification](M1-VERIFICATION.md)，不在本 Plan 維護第二份動態狀態。

### UI 驗收範圍

沿用已回報／先前操作觀察：窄或低視窗清單被固定面板壓縮；fence／普通 table 閱讀不足；正文連結缺少直接跳轉；無 Reading View；125%／150% 先前僅 viewport/CSS 模擬。上述是既有觀察，不聲稱本輪再現。

本 Goal 只修正阻擋 A+B 的 Reading／Live Preview、reference 附近 definition/references/edit、清楚的 draft/cache/checkpoint 狀態、正常字級與可獨立捲動面板、匯出 review 與 Explorer path/reveal。完整 tree/navigation 重整、mobile/cloud、任意 Programming Runtime 留後續。

本輪工具沒有可呼叫的 Browser／Computer Use 操作能力。可讀 source、使用現有測試／CLI；Obsidian、Explorer GUI、真實 zoom／Windows IME 要另取得可操作工具或 Human 現場驗收。不得把 API、mock、process spawn 算成已看見桌面結果。

### 性能與資料安全

- 使用 deep chain、wide fan-out、diamond、mixed、反覆小改及 MainVault 副本；記錄 machine、規模、cold/warm、affected nodes、memory、p50/p95/max、取消及 stale work。UI input、parse、graph、DB、export、rebuild 分開。
- 建議驗收預算：合成高互動 workload 下輸入到下一次可見更新 p95 ≤ 100 ms，UI 無 ≥ 200 ms 的重算長任務；完成 cache 提交時間另列，不能以最後保存耗時替代 typing。實際目標機未測，此為目標而非已達成數字。
- 至少 10,000 identifiers、50,000 occurrences、12,000 deep chain，以及全 MainVault 實際 bytes；混合變更和錯誤期間仍能輸入／取消。資料過大時明確診斷，不截斷 value 假裝成功。
- 原 snapshot 唯讀；任何寫入測試只在 Scratch 的獨立副本。匯入/重建寫到新 DB，計數與 hashes 比對後才稱成功；不重新分類或合併原 identity。

## Git、額度與交付

**每次 Goal coding 前**：`git status` → `git fetch origin` → 比對 HEAD 與 origin/master。乾淨且可 fast-forward 才 `git pull --ff-only origin master`；重讀受影響 Seed/Plan，再決定是否開始。未提交工作先保留；divergence／conflict 先 reconcile，不 reset／checkout 掉工作、不 force push。

**Preflight evidence**：先前 Planning 開始時 clean master，fetch／ff-only pull 與 rc.3 重讀完成，HEAD/origin 同 `187be53`。此次 durable publication 再執行，三份 untracked 保留且與遠端無衝突；結果仍 `0/0`／Already up to date，詳見 Working State。這些是對應時點紀錄，不能跳過下次 coding 前核對。每個 major milestone 前再 fetch／確認並行更新，不無理由反覆 pull。

Coherent segment 經合理 validation 後 explicit add／commit／push 到既有 master，確認 remote SHA；禁止私人資料、credentials、build outputs。Temporary network failure 保留 local checkpoint；protection/conflict/credential/history risk 停 Git mutation，不採破壞性 workaround。

普通高能力額度耗盡／只剩 Luna Reserve 時停實質工作，只做可負擔的安全收尾。未達成產品條件標「因額度停止」；當前進度／stop point 只以 Working State 為準，不在本 Plan 維護第二份動態狀態。Quota 觀測記在 USAGE-LOG，來源與帳戶總量界線保留。

每個 major milestone 的 coherent checkpoint 必須同步更新 Working State：progress、實際 evidence／limits、未完成、stop point、exact next step 及 checkpoint locator。任何執行必要決策只在 conversation／provider memory 中，該 milestone 的 continuity 就尚未完成。

交付需同時提供可啟動產物、實際 workspace/file paths、A+B 自行操作證據、tests/benchmarks、full fallback rebuild 結果、平台缺口與 commit；不能以語法測試或可見 demo 當成整個 Goal 完成。
