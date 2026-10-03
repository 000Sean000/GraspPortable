---
title: GraspPortable — Core Development Method
version: 1.0.0-rc.1
updated: 2026-09-27
status: current-working-baseline
scope: autonomous-goal-development-method
---

## Interface｜給 Goal Mode / Codex 的工作方法

### 核心目的

你的任務不是忠實執行一份過度詳細的預製 implementation plan。

你的任務是：

> 依 `GraspPortable-Core-Requirements` 的 WHY、產品行為與硬限制，獨立作出合理工程決策，完成一版使用者醒來後可以真正操作的 GraspPortable。

使用者希望把睡眠時間轉成有效的 autonomous development，而不是醒來後收到大量問題、候選方案、半成品或需要人工整理的中間產物。

### 你擁有的決策權

除非會改變核心產品行為、造成不可逆資料風險、引入重大成本／法律限制，否則你可以自行決定：

- framework
- libraries
- editor implementation
- UI host
- data access implementation
- expression evaluator
- internal project layout
- graph data structures
- caching
- concurrency
- indexing
- testing tools
- build／packaging details
- 其他一般 HOW

選擇標準依序是：

1. 能完成需求。
2. 實際使用品質。
3. 可維護與可 debug。
4. 效能。
5. 開發與長期維護成本。
6. 成熟度、license、來源可取得性。
7. 能否在不重做整個 App 的情況下替換。

不要因為使用者不認識某技術，就要求使用者替你挑 framework。

### 不要過早 freeze HOW

目前已知產品 invariants 必須遵守；既有技術討論只能當 evidence／starting point。

如果更好的實作方式能保留相同產品行為，可以採用。

同樣地，不要為了「自由發揮」而推翻已經清楚的 WHY。

### 架構的核心要求

完成品要像「穩定主幹 + 可替換模組」，而不是一次性的 prototype。

至少讓以下責任能被分辨及局部替換：

- Editor / Live Preview
- Knowledge / Identifier / Reference
- Value Sync / Calculation
- Persistence
- Markdown Exchange
- Platform Host
- optional Programming Runtime

不要求固定的專案數量、class 名稱、design pattern 或 dependency-injection framework。

Boundary 的價值用「未來能不能局部換掉」與「bug 能不能定位」判斷，而不是 abstraction 數量。

### 第一輪交付優先於完美設計

先做一個完整、可操作、可驗證的 vertical slice。

不要在使用者睡覺期間停留在：

- architecture-only
- research-only
- benchmark-only
- TODO skeleton
- mocked end-to-end path

研究與 spike 是允許的，但它們應服務於完成產品；可以被丟掉。

---

## 1. Goal-driven Development

每個工程決策先問：

> 這能否更直接地完成使用者真正要操作的結果？

如果兩個方案都能完成：

- 選較成熟、維護成本較低者。
- 若 performance risk 是核心風險，先做最小 benchmark。
- 若兩者差異只在內部美學，不浪費時間比較。
- 若某套件使用後會把 domain 綁死，包在可替換 boundary 後再用。
- 若自行重造輪子沒有明確收益，使用成熟 implementation。

工具與 architecture 不是成果本身。

## 2. Human Attention Is Scarce

這個專案特別要避免把 AI 產能轉成 Human review 負擔。

因此：

- 不要每遇到 implementation choice 就詢問使用者。
- 不要提交十個候選讓使用者選。
- 不要把大量 raw research 當作完成。
- 不要需要使用者逐個 approve internal refactor。
- 不要為了安全感製造大量文件。

在需要權衡時，自行評估並選一個合理方案。

只在下列情況停下要求 Human：

1. 需求存在兩種會造成明顯不同使用體驗的合理解讀，而且沒有足夠 context 推斷。
2. 需要使用者帳號、secret、外部權限或硬體操作。
3. 某選擇會造成不可逆資料格式／migration commitment。
4. 必須接受重大付費、license 或服務依賴。
5. 證據顯示核心要求本身無法同時達成。

除此之外，繼續做。

## 3. Build for Replaceability, Not Hypothetical Flexibility

可替換的重點是責任邊界。

例如：

```text
User interaction
    ↓
Editor
    ↓
Application / Knowledge semantics
    ↓
Value Sync / Persistence / Exchange implementations
```

第三方 library 應停在 implementation side。

核心 contract 應描述 Grasp 的語意，例如：

- identifier
- reference
- value
- dependency
- document
- record
- change
- query
- import/export result

而不是：

- 某 editor 的 state object
- 某 ORM entity proxy
- 某 evaluator 的 AST class

但不要建立「每個 class 都有 interface」的形式主義。

只有：

- 真的可能更換
- 需要隔離第三方
- 需要獨立測試
- 需要跨 platform

的責任才值得 boundary。

## 4. Start Narrow, Keep the Seam

第一版 Value Sync 的需求很窄：

- string declaration／initialization
- formatted string
- identifier dependency

先把它做好。

若採現成 evaluator，可以使用，但 evaluator 必須留在可替換 implementation boundary。

不要先造：

- 完整 Python
- 完整 CEL
- 完整 scripting runtime
- class system
- reflection model

未來增加能力時，沿既有 seam 擴張。

同樣原則適用於 Editor、Database access 和 Programming Runtime。

## 5. Database-first Runtime

Database 是 App runtime authority。

因此 persistence flow 應明確：

```text
App action
    → validate
    → authoritative database transaction
    → runtime/index/view update
```

不要偷偷建立 DB／Markdown 雙主模型。

Markdown 是 exchange projection：

```text
DB
    → export
    → Markdown
    → AI / human external editing
    → import plan / diff / validation
    → DB transaction
```

若需要 recovery metadata，可以放進 exchange format，但仍不改變 runtime authority。

具體 database engine／schema／data access strategy可由 implementation 選擇，只要：

- 適合 local-first
- portable
- transactional
- performance 可驗證
- schema 可 migration
- 不讓 storage vendor type 滲進 domain

## 6. Runtime Separation

### App Runtime

日常開啟 App 就存在。

需要：

- note editing
- identifier/reference
- dependency graph
- reactive value sync
- database
- query/view
- exchange

### Programming Runtime

進階程式能力。

可以：

- 只存在 PC
- 晚於第一版
- 使用不同 runtime／language
- crash／timeout 而不拖垮 editor

不要因為 Programming Runtime 還沒做，就阻塞 iPhone／iPad 能使用的 App Runtime。

## 7. Performance Strategy

目標不是證明某語言很快，而是讓真實 workload 快。

計算模型應能合理處理 Excel-like dependency use case：

- deep chains
- wide fan-out
- shared dependencies
- repeated small edits
- incremental dirty propagation
- cache
- cycle detection
- cancellation
- stale result rejection

先讓演算法只重算 affected graph。

再考慮：

- batching
- parallelism
- optimized data structures
- native hotspot

不要一開始因性能焦慮就把整個 App 寫成 C++。

但若 benchmark 顯示某個 isolated hotspot 需要 native implementation，可以只替換那個 module。

### Benchmark 要回答的問題

至少量：

- graph build
- reference index build
- dirty propagation
- incremental recalculation
- definition／reference lookup
- memory
- editor input responsiveness during background work

使用：

1. synthetic Excel-like graph
2. 可取得時的 MainVault copy

不要用小 demo 宣稱大型 workload 已達標。

## 8. Technology Selection Rule

你可以自行選 technology。

不要把之前對話裡出現過的 C#、MAUI、CodeMirror、NCalc、CEL、Electron、SQLite 等名稱當成 mandatory stack。

它們是候選與既有研究。

選擇時優先考慮：

- 成熟
- 主流
- source 可取得
- license 可接受
- documentation 足夠
- AI 容易維護
- cross-platform 合理
- performance 有 headroom
- 不需要大量 glue code
- 能封裝在清楚 boundary

如果既有候選就是合理最佳解，直接用，不必為了顯得有研究而換技術。

如果選擇和先前候選不同，在最後 decision log 用幾句話說明原因即可。

## 9. Apple Mobile Constraint

使用者的 mobile devices 是 Apple。

第一版 overnight delivery 可以以目前可建置的 desktop platform 為主要可操作成果，但 architecture 不應把 App Runtime 鎖死在只支援 Windows 的 technology。

需要保留：

```text
Shared product semantics
    → Desktop host
    → Apple mobile host
```

mobile 不需要完整 Programming Runtime。

如果某第三方 component 在 iOS／iPadOS 有 AOT、WebView、sandbox 或 package limitation，應：

- 隔離 implementation
- 提供替代 path
- 不讓它成為 core semantic dependency

不要求一夜之間完成 App Store distribution。

## 10. Editor Strategy

使用者最終判斷的是手感，而不是 editor library 名稱。

Editor 必須優先保證：

- natural Markdown editing
- inline Live Preview
- IME
- selection
- undo／redo
- large-note responsiveness
- identifier navigation
- background sync 不阻塞 typing

可以重用成熟 editor。

高頻 UI state 應盡量在適合的 editor-side 處理，避免每次 keystroke 都經過昂貴跨-runtime roundtrip。

具體實作由 benchmark 與整合成本決定。

## 11. Correctness and Data Safety

即使是一夜 build，也不能用破壞資料換速度。

至少保證：

- transaction boundary
- no silent partial write
- cycle 不造成無限重算
- stale calculation 不覆蓋新狀態
- failed import 不破壞 authority
- DB migration 有 version
- external AI modification 先 validate／diff 再 commit
- destructive operation 可回復或至少有明確 backup／transaction strategy

測試優先針對：

- dependency ordering
- nested formatted strings
- missing identifiers
- cycle
- repeated updates
- reopen persistence
- import validation
- performance regression

## 12. Autonomous Overnight Workflow

在 Goal Mode 開始後，預設自行完成：

### Step A｜Rehydrate

- 讀 core requirements。
- 讀本方法。
- inspect current repo。
- 確認現有程式碼／build state。
- 不從舊 architecture proposal 抄下已被最新決策取代的 assumption。

### Step B｜Choose

自行選擇最實際的 implementation stack。

只做足以支持決策的 research／spike。

不要把選型工作丟回 Human。

### Step C｜Build Vertical Slice

優先走通：

```text
open workspace
→ edit Markdown
→ define identifier value
→ formatted value dependency
→ reactive recalculation
→ reference navigation
→ database persistence
→ restart
→ Markdown export
→ controlled import
```

若時間／環境不足，優先完成這條主路徑，而不是擴張功能面。

### Step D｜Harden

- tests
- performance benchmark
- error states
- persistence
- packaging
- minimal architecture map

### Step E｜Self-review

以使用者視角重新操作：

- 是否真的能啟動？
- 是否真的能輸入？
- 是否真的能保存？
- formatted value 是否真的會更新？
- nested reference 是否會卡？
- 重開是否一致？
- Markdown exchange 是否可用？

發現問題先修，不把明顯 broken state 交回使用者。

### Step F｜Deliver

交付成熟結果，不交付中間噪音。

## 13. Overnight Deliverables

醒來後應留下：

1. runnable build 或清楚的一步啟動方式。
2. source code。
3. automated tests。
4. benchmark results。
5. 一份很短的 `ARCHITECTURE.md`：
   - 主要責任區
   - dependency direction
   - 哪裡可以換 module
   - debug 從哪裡開始
6. 一份短 decision log：
   - 最終用了哪些主要技術
   - 為什麼
   - 哪些是 provisional
7. known limitations。
8. 建議下一個最小改進，不要列大量 backlog。
9. 建議 commit message。

不要把大篇研究報告放在交付最前面。

## 14. 成品評估方式

第一版不是靠「符合原計畫百分比」評估。

真正的 loop 是：

```text
Codex autonomous build
    ↓
User 實際操作
    ↓
找出真正不舒服／不足的地方
    ↓
定位責任模組
    ↓
替換或改進該模組
    ↓
再次實際操作
```

因此 architecture 的任務不是預測所有未來需求，而是讓這個 loop 的重構成本足夠低。

只要核心產品 WHY、資料權威與語意保持穩定，具體 implementation 可以隨證據演進。
