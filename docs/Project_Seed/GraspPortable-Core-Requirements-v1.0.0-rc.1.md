---
title: GraspPortable — Core Requirements
version: 1.0.0-rc.1
updated: 2026-09-27
status: current-working-baseline
scope: product-intent-and-requirements
---

## Interface｜Codex 先讀這裡

### 為什麼做

GraspPortable 的目的不是重做一套通用筆記軟體，而是解決現成工具一直無法完整支援的個人知識工作流。

核心問題是：

- 筆記必須像一般 Markdown 一樣自然好寫，不應為了程式化而變成程式碼。
- identifier、reference、formatted value 與結構化資料必須能被程式可靠理解與同步。
- 高度巢狀、交互引用不能像既有部分工具一樣在實際 Vault 上卡死。
- 大量物件型資料不應被迫拆成大量實體 Markdown 檔案。
- AI 應能方便讀取與回傳知識，而不必成為 App 內建的唯一 AI。
- 使用者沒有餘力長期維護複雜工具本身；工具必須降低工作負荷，而不是創造新的管理工作。

GraspPortable 因此要成為一個以筆記為中心、可程式化、可逐步擴充的個人知識環境。第一版的價值在於讓使用者真正開始使用，之後不滿意的能力可以局部替換，而不是重新做整個 App。

### 第一版醒來後應該是什麼

一個真的可以啟動、建立／開啟 workspace、寫 Markdown 筆記並操作 identifier 的可用成品，而不是只有架構骨架或技術展示。

至少要能走通：

1. 寫 Markdown 筆記。
2. 在同一編輯區取得自然的 Live Preview。
3. 宣告 identifier 的字串值。
4. 用其他 identifier 組成 formatted string。
5. identifier 改變後，只重算受影響的依賴並更新顯示值。
6. 從 reference 找到 definition，並能找到 references。
7. 保存後重新啟動仍得到一致結果。
8. App 的 runtime state 由 database 保存。
9. 能將需要的內容輸出成 Markdown，供 ChatGPT、Codex 或其他 AI 閱讀與修改。
10. AI 回傳的 Markdown 可以經明確的匯入流程回到 App，而不是形成第二套偷偷競爭的資料權威。

### 不可丟失的產品原則

- Note-first：主要內容是自然語言與 Markdown。
- Inline Live Preview：不能只用 source／preview 分割畫面代替。
- Database 是 runtime authority。
- Markdown 是 AI exchange representation；不是與 database 並列的 runtime authority。
- App Runtime 與 Programming Runtime 分離。
- iPhone／iPad 只需要 App Runtime；完整 Programming Runtime 可以留在 PC。
- App Runtime 必須能處理 identifier value sync，不應要求完整程式執行環境。
- Value Sync 第一階段只需要 string declaration／initialization 與 formatted string；不要為了未出現的需求先造完整程式語言。
- Value Sync 必須能承受 Excel 類型的高互動 dependency graph，而不只是少量 reference demo。
- 模組責任必須清楚，讓日後更換 editor、value language、storage implementation、host 或 calculation engine 時，不必重寫整個產品。
- 實作技術服務產品，不反過來限制產品。具體框架、套件、語言 implementation 可以由執行者依實務最佳與成本決定。

介面到此。以下提供完整需求背景與驗收方向。

---

## 1. 產品定位

GraspPortable 是個人知識工作環境。

它結合：

- Markdown note authoring
- identifier／reference
- reactive value sync
- structured data
- database-backed runtime state
- programmable extension point
- Markdown-based AI exchange

但這些能力的目的不是把 GraspPortable 變成完整 IDE、資料庫管理器或通用 scripting platform。

它們存在的理由是：讓知識能自然書寫，同時保有可追蹤、可計算、可查詢、可交給 AI 操作的結構。

## 2. Note-first authoring

### 2.1 Markdown 是主要寫作介面

使用者應能像使用成熟 Markdown note app 一樣直接寫正文。

一般 prose 不應因為程式功能而被迫改寫成：

- string literal
- object construction
- function call
- code block

程式與結構化能力應附著在筆記需要的位置，而不是取代筆記。

### 2.2 Live Preview 是核心體驗

Markdown 的 source 與 rendered result 應在同一編輯表面自然切換。

驗收重點是：

- 游標所在位置仍可直接編輯 source。
- 非編輯位置能呈現適合閱讀的結果。
- 中文 IME、selection、undo／redo、copy／paste 不因 rendering 而破壞。
- 大量 reference 或 background recalculation 時，輸入仍保持可用。

具體 editor library 不屬於產品要求。

## 3. Identifier 與 Reference

### 3.1 Identifier 是跨層穩定語意

Identifier 的目的，是讓 note、value sync、structured data 與未來 programming 能指向同一個可追蹤概念。

它不應等同某個特定 parser、程式語言 variable object 或 database row object。

### 3.2 Reference 的基本能力

對明確可解析的 reference，使用者應能：

- 查看目前 rendered value。
- Go to Definition。
- Find References。
- 在 identifier 發生變更後得到一致的 runtime 顯示。
- 知道 reference 是否 unresolved、stale 或 cyclic。

動態到無法靜態判斷的 reference 不應假裝完整。

### 3.3 顯示更新與 source 改寫是不同動作

Identifier value 發生改變後，App 可以自動更新 runtime／preview 中的顯示。

但將新 rendered value 寫回其他 source 位置，是 persistent mutation，應由明確的 command 或可審查流程處理。

這兩種行為不能因為都叫「sync」而混在一起。

## 4. Identifier Value Sync

### 4.1 為什麼它屬於 App Runtime

Value Sync 是日常讀寫筆記就需要的能力。

使用者在 iPhone／iPad 上不必能執行完整使用者程式，仍應能：

- 開啟 workspace。
- 解析 identifier。
- 取得 value。
- 更新 dependency。
- 重算 formatted value。
- 顯示最新結果。

因此它是 App Runtime 的一部分，而不是 Programming Runtime 的附屬功能。

### 4.2 第一階段的必要表達能力

目前明確需求只有：

- string identifier declaration
- string initialization
- formatted／composed string
- identifier-to-identifier dependency

概念例：

```text
first_name = "Sean"
last_name = "Wu"
full_name = "{first_name} {last_name}"
```

這只是需求形狀，不指定最終 grammar。

第一版不需要因為可能的未來需求預先加入：

- class
- inheritance
- loop
- arbitrary side effects
- filesystem／network APIs
- 完整 general-purpose programming language

### 4.3 Dependency 計算

系統應能從 value definition 得到必要 dependency，建立 dependency graph，並在 value 改變時只處理受影響的部分。

應正確處理：

- deep chain
- wide fan-out
- shared dependency
- nested formatted value
- repeated small edits
- cycle detection
- stale calculation result
- cancellation／superseded work

設計目標不是「勉強算得完」，而是高度交互引用下仍維持可操作的 editor。

## 5. Structured Data

大量具有共同結構的資料不應要求一筆資料一個 Markdown file。

使用者應能集中保存 structured records，並在 note 中依需要查詢與呈現 view。

例如同一組 Aura records 可以：

- 在一份 note 顯示篩選結果。
- 在另一份 note 顯示比較 table。
- 被 identifier 或未來 programming 引用。
- 不必維護多份資料副本。

第一版不要求完整 class system。

`character.name` 這種表達可以來自 qualified identifier、record property 或其他合理模型；具體 object model 由實作驗證後決定。

## 6. Data Authority 與 Markdown Exchange

### 6.1 Database 是 runtime authority

App 正常運作時，database 保存 authoritative runtime state。

使用者不應需要判斷：

「現在到底 DB 還是 Markdown 才是真的？」

正常規則是：

```text
Database
    → runtime truth
```

### 6.2 Markdown 是 AI exchange representation

Markdown 的主要角色是：

- 把人類可讀的知識交給外部 AI。
- 讓 AI 能用一般檔案能力修改或產出內容。
- 將結果透過受控匯入流程帶回 App。

概念：

```text
Database
    → Export / Projection
    → Markdown
    → AI
    → Markdown result
    → Validate / Diff / Import
    → Database
```

這個流程應盡量保留 identifier、reference、structured data 關係所需的資訊，避免 AI exchange 把內容扁平化到無法安全匯回。

Markdown 也可以兼具人工 fallback／recovery 價值，但不能因此變成背景雙向同步的第二個 runtime authority。

## 7. App Runtime 與 Programming Runtime

### 7.1 App Runtime

所有日常平台都需要：

- note editing
- identifier/reference
- dependency graph
- reactive value sync
- database
- query/view
- exchange

目標平台至少考慮 Windows、macOS、iPhone、iPad。

### 7.2 Programming Runtime

完整 programming 是更高階能力，第一版不必阻塞 App Runtime。

它可以只在 PC 提供。

未來它可以用來：

- 批次操作 note
- 進階 query
- 轉換 structured data
- 建立自訂工具
- 產生較複雜 value
- 執行 migration

Programming language 尚未作為產品 invariant 固定。

## 8. Performance Requirement

效能要求來自實際工作流，而不是技術 benchmark 本身。

既有經驗顯示：同樣是知識工具，有些應用在高度 nested cross-reference 下會卡死，而另一些工具在 MainVault 上仍可正常操作。

因此不能從「用了 Electron」、「用了 C#」或「用了 native code」單獨推論產品效能。

至少需要測：

- cold workspace load／index
- warm reopen
- deep dependency chain
- wide fan-out
- mixed graph
- frequent single-value updates
- formatted-value cascade
- reference lookup
- structured-data query
- recalculation 時的 editor responsiveness
- memory growth

如果高階 runtime 不足，可以更換或 native-optimize calculation implementation；產品語意不應因此重寫。

## 9. Replaceability Requirement

可替換性不是要求所有東西都做成 plugin。

真正要求是：

- 第三方 framework／library 不成為產品 domain language。
- 核心資料語意由 Grasp 自己擁有。
- Editor、Value Language、Calculation implementation、Storage adapter、Platform Host、Programming Runtime 等責任有清楚接面。
- 替換某個 implementation 時，其他模組不需要理解它的 vendor-specific objects。
- 可以先做簡單 implementation，再用實測結果局部替換。

如果為了「可替換」而建立大量沒有實際替換價值的 abstraction，也算失敗。

## 10. Portability

重要可攜資產包括：

- knowledge／workspace data
- user settings
- 必要的 App state
- 可合理攜帶的 account/session state

App binary、compiler、runtime 等可重新安裝的元件不必跟資料一起裝在 removable storage。

第三方登入 session 是否真的能跨機續用，受平台與服務限制，不應用架構圖假裝已經解決。

## 11. AI Collaboration

GraspPortable 不要求 AI 必須內建在 App。

使用者會依：

- intelligence
- quota
- price
- available tools

選擇 ChatGPT、Codex 或其他 AI。

因此 App 應提供低摩擦的 Markdown/file exchange，而不是把 canonical data model 綁定某一個 AI API。

AI 產出回到 App 時，應保留：

- diff
- validation
- affected scope
- recoverability

避免「AI 幫忙」變成新的人工整理負擔。

## 12. 第一版不需要完成什麼

除非實際 MVP 需要，第一版不要求：

- 完整 IDE
- debugger
- terminal
- plugin marketplace
- 完整 class/object programming language
- mobile full programming runtime
- 多種 value languages
- distributed backend
- built-in AI subscription
- 完整 automation platform
- 為所有未來功能預先建立 abstraction

第一版應優先完成目前確定會使用的主路徑。

## 13. 第一版完成判準

醒來後，使用者應能拿到一個可執行版本並實際操作。

至少應能驗證：

1. App 能啟動並建立或打開 workspace。
2. Markdown 可以自然輸入與顯示。
3. identifier string value 可以建立、修改。
4. formatted value 能引用其他 identifiers。
5. nested dependency 更新正確且不做全庫無必要重算。
6. cycle／missing reference 不會卡死 App。
7. definition／references 可被定位。
8. 關閉再開後資料與結果一致。
9. database 是唯一 runtime authority。
10. 可以輸出 AI 可讀 Markdown。
11. 外部修改結果有受控匯入路徑。
12. 已有基本 performance／correctness tests。
13. implementation 被分成足以局部替換的責任區。
14. 任何尚未完成的能力有清楚限制，而不是以 demo 假裝完成。

完成以上結果後，再以實際使用感受決定下一輪改哪個模組。
