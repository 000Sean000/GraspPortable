# M1 語法與表示驗證

2026-09-27。**Lexical codec、有界 context adapter 與 raw-source 整合已驗證；M1 完整 gate 尚未通過。** 目前狀態與授權只由 [Working State](EXECUTION-STATE.md) 保存。

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

仍缺 context ceiling 的解除／合適策略、相同案例的實際可讀表示輸出／source-layout 重建、真實 Obsidian reading，以及 marker／IME／完整 UI undo 操作。M2 shared transactions、persistent identities/caches、M3 fallback、新 DB rebuild、M4 全 MainVault 均未以本報告宣稱完成。

## Context 與 raw-source 整合段落

`parseNoteLanguage(source, revision)` 回傳 Grasp-owned bindings/references、原文版本、排除範圍／診斷及 `contextsComplete`。第三方 AST 封裝在 adapter。Code、container fences、list-indented code、escaped openers、HTML／URL／初始 YAML metadata 不啟用；一般 paragraph／heading／list／quote／table 的 ranges 保持原始 UTF-16，multiline value 中 quote prefix 不無聲移除。

完整 semantic spans 對 host parser 遮蔽；若其內的 fake fence 污染後綴，先重新判定後綴 context，再承認後續 nodes。重要 regression：第一個 literal 內的 `~~~` 與後一 literal/cache 內的 `~~~` 被 host 配成 fence，不能因此先啟用後一 value 裏的假 binding/reference。此反例已修正並加入測試。

**已知限制：**最多 8 次 context passes。30 個合法 fake-fence literals 的壓力案例會超限；回傳 `contextsComplete=false`、`context-pass-limit`、空 bindings/references，保留 source，不發布部分語義。這是安全但尚需改善的產品限制，不把該案例算成完整 conformance 通過。

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
