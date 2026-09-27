# M1 語法與表示驗證

2026-09-27。**純 lexical codec 已驗證；M1 完整 gate 尚未通過。** 目前狀態與授權只由 [Working State](EXECUTION-STATE.md) 保存。

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

Lexical scanner 不負責 Markdown code／escaped binding opener／HTML／metadata 等 context；不能直接當 runtime note parser。Raw literal 裏的 fence 不能污染外層 context mask；這是下一段必要整合案例。

尚缺 context matrix、相同案例的表示輸出與 synthetic reconstruction、真實 Obsidian reading，以及 editor marker/IME/undo 操作。M2 shared transactions、persistent identities/caches、M3 fallback、新 DB rebuild、M4 全 MainVault 均未以本報告宣稱完成。

這次沒有可呼叫 Browser／Computer Use 工具，沒有以 parser/API/spawn 代替 GUI 證據。沒有操作 MainVault 或驗收 workspace，沒有重跑 production E2E。App 仍是 v0.2 舊語法行為。
