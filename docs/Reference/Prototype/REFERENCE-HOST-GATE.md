> 歷史參考副本｜來源：[`master@5ca1373` 的 docs/REFERENCE-HOST-GATE.md](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/REFERENCE-HOST-GATE.md)。
> 本文的狀態、授權、next step、方法與測試結果屬舊 Prototype；新版工作範圍見 [重寫狀態](../../EXECUTION-STATE.md)。以下保留來源內容，僅將相對 Markdown 連結轉成固定來源連結。

# Multiline reference：第一里程碑 gate

2026-09-27；觀測基底 `187be53`，現有套件。**Link 視覺取捨已裁定。** 本文件保存 host 呈現限制與驗收條件；M1 新實作證據見 [M1 verification](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/M1-VERIFICATION.md)，動態停點／下一步見 [Working State](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/EXECUTION-STATE.md)。不將 host AST 等同 Grasp semantic AST。

## 最小反例

同一 logical value `first\n\nsecond` 若原樣放入 pure form：

```markdown
[first

second](:ref:Text)
```

現有 `@lezer/markdown`：`Document(Paragraph,Paragraph)`，沒有 Link／`:ref:Text` destination。現有 CodeMirror `markdownLanguage.parser` 基底也分成兩段，並把失去外層 link 保護的 `:ref:` 辨識為 Emoji：`Document(Paragraph,Paragraph(Emoji))`。

對照 `first\nsecond`（只有一個換行）仍形成一個 Link；ordinary newline 是 soft break，不能據此聲稱外部畫面保留可見硬換行。LF 與 CRLF 的空白段落案例均會失去 outer link。

另一個合法 Markdown value：

```markdown
[outer [inner](https://example.com)](:ref:Text)
```

現有 parser 只保留 inner https link，outer managed reference 消失。這不是多加 delimiter level 就能修正；raw literal 對資料的定界與外層 Markdown link 的 block/inline 規則是不同問題。

`[[@Text|first\n\nsecond]]` 也被上述 parser 拆段，但它們不實作 Obsidian wikilink；**不能由此推論已完成 Obsidian 測試**。List、fence、table pipe、escape 等邊界保留在 diagnostic test 中。

## 證據層級

| 證據 | 結果／界線 |
| --- | --- |
| Source | `src/editor/editor.ts` 使用 `markdown({ base: markdownLanguage })`；本測試針對其 Markdown 基底 AST，不是整個 Grasp renderer |
| 實際 parser probes | 已取得上述 AST，未修改筆記或私人 workspace |
| 自動化 diagnostic suite | `npm test -- tests/reference-host-gate.test.ts`：32 tests pass，2026-09-27 23:13:49 Asia/Taipei 重新驗證；斷言是上述限制可以重現，**不是 new-reference conformance pass**。此前未追蹤測試已在本次授權的產品 Goal 審閱，納入 codec checkpoint |
| 首次測試嘗試 | Vite `.vite-temp` EPERM，測試未啟動；之後正常取得工作目錄寫入權限再執行，未更改 dependency 或配置 |
| Obsidian／可視 renderer | 本輪工具不可用，未操作、未證明成功或失敗 |
| Serializer／rebuild | 新 reference serializer、raw literal generative round trips、完整 reconstruction 尚未完成，無通過證據 |

官方 [CommonMark links](https://spec.commonmark.org/0.31.2/#links)、[paragraphs](https://spec.commonmark.org/0.31.2/#paragraphs)、[soft line breaks](https://spec.commonmark.org/0.31.2/#soft-line-breaks) 支持這個結構判讀：inline label 不能充當任意多段 block 容器，nested links 也不能保留完整外層 link。官方規則不能替代 Obsidian 的實際相容性結果。

## 已接受決策與影響

Human 最新原文：「link只是視覺考量，優先確保語意結構正確，link的視覺隱藏不用強求」。這是已接受的優先順序，不再要求 Human 重答。單純沒有 native outer Link、標記可見，不單獨判 gate failure；完整值、identity、composition、相鄰正文與重建正確仍是必要條件。

DB／Grasp 仍保留完整 logical value、兩種 reference identity/form、composition 與 occurrence；Grasp-owned parser 負責語義定界。宿主可見 bracket／identifier 不要求抹掉，也不能以 code 化／摘要／trim 掩蓋資料損失。未來 exporter 可依 context 輸出普通 blocks、links／定位，完整 fallback 保存原 source＋occurrence mapping；**這是可選呈現方案，並非為隱藏 link 強制轉換**。不新增第三種 authored managed syntax。

可選輸出示意（錨點生成方式待宿主實測，不是第三種 managed syntax）：

```markdown
[Text 的定義](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/definitions.md#text-stable-anchor)

first

second
```

同時保存 occurrence 起迄、完整 cached value、原 form、IdentifierID、source revision 與輸出 mapping；full fallback 必須能重建原 Note 中該 occurrence。單篇／部分輸出的表示與metadata可攜規則依 Projection Contract。

最新裁定不等於無條件接受所有 Markdown 內容損壞。如何在「正文前綴＋多段值＋正文後綴」、table cell、list item 中定界／呈現仍需有界實驗，不能誤吞正文或把資料重排成不可還原文字。Grasp domain AST 的 reference／dependency 必須完整；host AST 是否有 Link 是觀測欄位，不能作為 domain correctness 的唯一代理。

## M1 同案例矩陣（待實作驗證）

| Input 類別 | Grasp 必須證明 | Host／rebuild 必須記錄 |
| --- | --- | --- |
| Single line、soft line、LF／CRLF／lone CR | Exact logical value 與 occurrence boundary，identifier 可解析 | 實際可讀內容，換行差異；round-trip exact value |
| Blank paragraphs、list、fence | 完整 carrier；value 內部 Markdown 不偷成外層 binding/reference | 各 block 閱讀結果；source/metadata 能恢復原表達 |
| Inner link、brackets、pipes、backslashes | 局部 escape 可逆，不截斷、不建立假的 nested dependency | 可見標記可接受；不能漏內容；逐值／結構比對 |
| Adjacent prose、兩個 refs、malformed/unclosed refs | 相鄰正文不被當 value 吞入，錯誤無 partial success | 未解析原文可見、診斷；合法 occurrence 仍可重建 |
| Table、heading、list／quote context | Context 與 source offsets 正確，raw source 未被默默 normalize | Obsidian 真實閱讀；表格 delimiter 影響需明列 |

每個案例交付 raw source、expected value／ordered dependencies、Grasp AST、host AST 觀測、實際 Obsidian 結果、serializer round-trip、reconstruction 比對。M1 可用合成資料 bundle 證明 source/DTO 重建；完整 fresh-DB recovery 屬 M3，不能混稱。沒有 Computer Use 時明示 desktop gap，不能僅靠 API/spawn 宣稱通過。

## Exact next step

由 [Working State](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/EXECUTION-STATE.md) 讀取 publication／coding 狀態。Durable docs 經 commit、push、remote／rehydration 核對前不 coding；之後的有界 M1 使用 [Binding contract](https://github.com/000Sean000/GraspPortable/blob/5ca1373dca91e16d9e161de498bf8fcaebac1031/docs/BINDING-EDITING-CONTRACT.md) 實作 raw literal/parts codec、reference parser／serializer、生成式 tests 及同案例 reconstruction。不接正式 DB、不碰 MainVault。一般工程推薦可依矩陣驗證；若必須改變已接受 source 的含義，提出具體反例回 Human。

完成停點是提交 M1 證據與可重現 fixtures，再按原 gate 決定能否進 M2；不以 raw literal codec 單獨通過作為 bypass。
