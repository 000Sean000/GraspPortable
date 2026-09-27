# M1 語法與表示驗證

2026-09-27。**M1 語義／表示重建 gate 通過，可接續 M2；桌面 Obsidian reading 尚未驗證。** 目前狀態與授權只由 [Working State](EXECUTION-STATE.md) 保存。沒有把 unavailable GUI、單篇 bundle 或 CLI benchmark 宣稱完整產品／workspace fallback 驗收。

## 本次完成與最新驗證

- `note-language.ts` 解除原 8-pass ceiling。按需要取得 Markdown context，使用 Lezer TreeFragments、已閉合前綴回收及連續 semantic run；遇普通正文、container marker 或可能的 code indentation 回到 host context。真正 code／HTML／destination 仍排除，raw/cache 內假語法保持 opaque。
- `tests/note-language.test.ts` **44 tests pass**：30／300／3,000 個 fake-fence chain（空行及單 EOL 分隔）、同一長 paragraph 的 5,000 bindings＋5,000 refs、超過 lookahead 的真正 inline code／HTML，以及之前的 raw-spans/context 回歸。
- `source-bundle.ts` 保存完整單篇 layout、可選 canonical Binding／Identifier IDs、ordered parts／dependencies、兩式 refs。未提供 canonical IDs 時只稱 representation slot；不凭名稱創建或合併身分。Restore 驗證 format/version、UTF-16LE SHA-256、coverage、順序／ranges，再獨立 parse 核對 semantics。Checksum 不是外部 import 的授權。
- `markdown-value-export.ts` 產生可讀 blocks、實際相對 path／source-specific heading anchors，配 exact `.source.json`。沒有 resolver 時忠實顯示 composition，不捏造 nested result；可接 caller 提供的有版本 rendered observations。有限 reading profile 將 raw HTML 節點顯示為文字，避免未閉合 comment／script 吞掉後續 sections；真正 fenced／inline code 保持原內容，canonical source 不變。
- `tests/source-bundle.test.ts` **38 tests pass**：80 個 deterministic generative cases、BOM／mixed EOL／Unicode、tamper／gap／overlap／unknown version 拒絕、實際 host AST／URL／section 邊界、HTML regression。AST assertions 不代替 Obsidian 畫面。
- Root 完整回歸：**2026-09-27 23:56:06 Asia/Taipei，29 files／361 tests pass，4.44 秒**；`npm run build` 通過，既有 >500 kB bundle advisory 保留。未重跑 production E2E；runtime 還未接新語法，M2 才做。

### 可重現的閱讀與重建資料

在 repo 執行 `node --import tsx scripts/m1-reading-fixture.ts <Scratch output folder>`。原機已產生 `SandboxRoot/Scratch/M1-Reading-20260927/`：paragraph／heading／list／quote／table × pure／wiki 共 **10 例**；每例有 canonical source、reading Markdown、source bundle，`checks.json` 保存 raw/logical equality 與兩份 host AST。Fixture 不含私人資料；10 例 exact source／cached value restore 通過。可直接用 Obsidian 開該 folder，但此次沒有可用 Computer Use／node_repl，未宣稱桌面閱讀、anchor click 或原生 IME 通過。

### Context benchmark

Node v24.18.0、Windows x64、Intel Core i9-13980HX，warmup 1 次＋5 次量測，`performance.now()` 包住完整 `parseNoteLanguage`，取排序中位數。下列皆 2 context passes；`hostCharactersRead` 是實際 adapter input reads，用來發現重掃，不是整體 CPU 工作量。

| Fixture | UTF-16 chars | Host reads | p50 ms |
| --- | ---: | ---: | ---: |
| 空行 fake-fence chain ×30 | 738 | 639 | 0.613 |
| 空行 chain ×300 | 7,688 | 6,510 | 2.103 |
| 空行 chain ×3,000 | 79,888 | 13,873 | 11.921 |
| 單 EOL chain ×30 | 709 | 1,180 | 0.212 |
| 單 EOL chain ×300 | 7,389 | 12,380 | 2.108 |
| 單 EOL chain ×3,000 | 76,889 | 78,653 | 10.015 |
| Ordinary 5,000 bindings＋5,000 refs | 226,668 | 15,662 | 18.566 |
| 單 paragraph 5,000 bindings＋5,000 refs | 157,779 | 315,558 | 56.131 |

Ordinary max 24.479 ms；單 paragraph max 61.589 ms。這是 CLI parser evidence，不是 typing、SQLite、graph 或 UI latency。被排除的中間方案只加 TreeFragments 仍在 3,000 chain 讀約 103M characters、耗時 13.27 秒，因此沒有採用只提高 ceiling／整篇反覆重掃。

Repro input：chain 使用 `Array.from({length:n}, (_,i) => '@A'+i+' = '+serializeRawLiteral('```\nopaque')).join(separator)`，separator 為 `\n\n` 或 `\n`；ordinary 使用本頁末尾原 input；單 paragraph 使用 `Array.from({length:5000}, (_,i) => '@A'+i+' = <|x|>; [x](:ref:A'+i+')').join(' ')`。

M1 gate 判定只涵蓋語義邊界、完整值與可重建表示；沒有未解的語義損壞反例。依使用者「工具／非核心環境限制不停止整個 Goal」與 link 視覺裁定，保留 GUI gap 至整合驗收／Human 操作，直接接 M2，不建立額外批准關卡。以下保留前兩段 checkpoint 的歷史證據。

## 已實作與可重現證據

- `src/domain/binding-language.ts`：`parseRawLiteral`、`serializeRawLiteral`、`parseBindingAt`、`scanBindings`、`serializeBinding`。Raw UTF-16 ranges、literal content ranges、ordered composition／重複 dependencies；未完成 expression 不發布部分成功。
- `src/domain/reference-language.ts`：`parseReferenceAt`、`scanReferences`、`serializeReference`。兩種 forms、完整 cached string、局部 escapes、每個 decoded UTF-16 boundary 的 raw offset；成功 span opaque，失敗單調前進。
- 兩個模組是 context-free syntax adapter，尚未接入舊 App runtime。第三方 Markdown AST 不進入這些 DTO；`managed=false` diagnostic 代表尚不能確定是 managed reference，顯示政策留 context/UI。

| 測試 | 結果與範圍 |
| --- | --- |
| Binding codec | 34 tests；10-symbol alphabet `< > pipe [ ] backslash space CR LF x`、長度 0–4 共 11,111 values；seed `0x47524153` 共 1,000 長 Unicode／混合 EOL values |
| Reference codec | 21 tests；短 alphabet 與 binding 相同但 `x` 換 `a`，共 11,111 values × 兩式；seed `0x47524153` 共 750 長 values × 兩式 |
| Boundaries | Empty precedence、maximal pipe runs、exact closer、block structural EOL、首尾 lone CR、Unicode name boundary、semicolon／EOL／next binding、missing atom/operator、empty cache、ordinary links、相鄰 occurrence、escape mappings |
| Adversarial | 200,000-pipe literal、20,000 假 binding 的未閉 opaque body；100,000 broken brackets 加 300,000-character 未閉 tail。這是有界 correctness/stress tests，沒有宣稱正式 p95 benchmark |
| Host diagnostics | 32 tests 再跑通過；CommonMark／CodeMirror AST limitations。原先未追蹤檔已審閱，這次正式納入 checkpoint |
| 全套 regression | 2026-09-27 23:16:25 Asia/Taipei，`npm test`：26 files、276 tests pass，4.28 秒 |
| Build | 2026-09-27 23:16，`npm run build` 通過（含 tsc）；既有 Vite >500 kB bundle advisory 保留 |

## 還沒證明的部分

Lexical scanner 不負責 Markdown context。後續新增的 `note-language.ts` 承擔此邊界，尚未接正式 runtime；不能把獨立 codec 或此 adapter 直接宣稱可用的新 editor。

Context ceiling、可讀表示與 source-layout 重建已由本頁上方最新證據補齊。仍缺真實 Obsidian reading，以及 M2 marker／IME／完整 UI undo 操作。M2 shared transactions、persistent identities/caches、M3 fallback、新 DB rebuild、M4 全 MainVault 均未以本報告宣稱完成。

## Context 與 raw-source 整合段落

`parseNoteLanguage(source, revision)` 回傳 Grasp-owned bindings/references、原文版本、排除範圍／診斷及 `contextsComplete`。第三方 AST 封裝在 adapter。Code、container fences、list-indented code、escaped openers、HTML／URL／初始 YAML metadata 不啟用；一般 paragraph／heading／list／quote／table 的 ranges 保持原始 UTF-16，multiline value 中 quote prefix 不無聲移除。

完整 semantic spans 對 host parser 遮蔽；若其內的 fake fence 污染後綴，先重新判定後綴 context，再承認後續 nodes。重要 regression：第一個 literal 內的 `~~~` 與後一 literal/cache 內的 `~~~` 被 host 配成 fence，不能因此先啟用後一 value 裏的假 binding/reference。此反例已修正並加入測試。

**歷史限制（已解除）：**`d69ea80` 最多 8 次 context passes；30 個合法 fake-fence literals 會超限並 fail closed。最新版本改法與 3,000-unit 證據見上方，不再沿用該 ceiling。

- `tests/note-language.test.ts`：29 tests 通過，包含 5,000 bindings＋5,000 references／2 passes。
- `tests/language-source-roundtrip.test.ts`：3 tests 通過。兩式 reference 的精確 span patch 經現有 CodeMirror raw-source adapter 保留其他原文、BOM、mixed EOL、undo／redo；新的 cached value 內假 binding 不啟用。另有 JSON DTO 保存及 codec reconstruction，保留 ordered/repeated dependencies。它不是正式 exporter／DB fallback。
- 2026-09-27 23:28:19 Asia/Taipei，全套 **28 files／308 tests pass，4.34 秒**；`npm run build` 再次通過。
- 有界 CLI parse benchmark：226,668 UTF-16 code units、5,000 bindings＋5,000 references、2 passes；warmup 1 次＋10 次量測，agent 觀測 p50 **45.196 ms**、max **62.681 ms**。Root 獨立補齊重現資訊時 p50 **46.924 ms**、max **60.068 ms**（median 取中央兩樣本平均）。環境 Node v24.18.0、Windows x64、Intel Core i9-13980HX。這是整篇 parser 時間，不是 UI latency、DB 或 graph benchmark。

Root samples（排序、ms）：`42.0771, 42.2907, 42.3757, 42.5886, 46.3235, 47.5250, 49.3674, 50.7368, 52.7606, 60.0681`。在 repo 用 `node --import tsx --input-type=module` 執行下列 stdin；不讀寫私人資料：

```js
import { parseNoteLanguage } from './src/domain/note-language.ts';
const source = Array.from({length:5000}, (_, i) => '@A'+i+' = <|value '+i+'|>\n[cached](:ref:A'+i+')').join('\n\n');
parseNoteLanguage(source);
const times = [];
for (let i=0; i<10; i++) { const start=performance.now(); parseNoteLanguage(source); times.push(performance.now()-start); }
console.log(times.sort((a,b)=>a-b));
```

這次沒有可呼叫 Browser／Computer Use 工具，沒有以 parser/API/spawn 代替 GUI 證據。沒有操作 MainVault 或驗收 workspace，沒有重跑 production E2E。App 仍是 v0.2 舊語法行為。
