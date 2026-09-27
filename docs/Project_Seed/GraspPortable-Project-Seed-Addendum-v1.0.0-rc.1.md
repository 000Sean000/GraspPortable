---
title: GraspPortable — Project Seed Addendum
version: 1.0.0-rc.1
updated: 2026-09-27
status: current-product-correction
scope: binding-placement-and-raw-literal-editing
applies_to:
    - GraspPortable-Core-Requirements-v1.0.0-rc.2.md
    - GraspPortable-Core-Development-Method-v1.0.0-rc.2.md
---

## Purpose

本 Addendum 修正目前 Project Seed 對 Binding placement 的描述，並補充 Raw Literal 的必要編輯體驗。

若本文件與 rc.2 Core Requirements／Core Development Method 中「Binding 區」「外層 Binding container」等描述衝突，以本文件為準。其他未衝突內容維持有效。

## Binding 沒有固定區域

Assignment 本身就是 binding。

使用者不需要先建立或進入固定的 Binding 區、特定 section、comment container 或專用 fenced block。Binding statement 可以依個人習慣直接寫在 Note 中方便的位置。

Parser 必須依明確 syntax 辨認 binding，而不是依 heading、固定位置或 UI panel 決定它是不是 binding。

真正的 fenced code block 保留給真實程式語言、程式碼範例或一般 Markdown code。Binding parser 不因 fenced code 中出現相似文字，就把它當成可維護 assignment。

## 排版不決定資料語意

同一個 binding 可以依使用者習慣採不同排版。

例如 opening delimiter 可以和 assignment operator 在同一行：

```text
@Description = <|內容|>
```

也可以換行：

```text
@Description =
<|
內容
|>
```

Assignment operator 與第一個 expression token 之間的排版空白／換行屬結構分隔，不自動成為 logical value。

因此 parser 與 formatter 不應把「opening tag 是否緊貼等號」「binding 是否集中在某區」做成語義要求。

## Raw Literal 與字串組合

目前採用的 Binding 表達方向維持：

```text
@Fruit = <|apple|>
@Person.Job = <|doctor|>
@Slogan = <|An |> + Fruit + <| a day, keeps |> + Person.Job + <| away.|>
```

Raw literal 內的普通字元按內容保存；literal 外的 identifier 表示取值，`+` 表示 string concatenation。

多行 literal 保存實際內容換行。Delimiter collision 優先由 serializer 選擇較高 marker level 處理，例如 `<|| ... ||>`，而不是要求使用者大量修改正文 character 做 escape。

精確空值、首尾換行、縮排、statement termination、錯誤復原及各 Markdown context 的 parsing 邊界仍需配套 grammar 與 round-trip tests 定案。

## Editor 必須降低 Marker 輸入負擔

Raw literal marker 不容易手打，因此 Editor 應提供 paired-delimiter autocomplete：

- 輸入 opening marker 時，自動補出 matching closing marker。
- 游標留在 opening／closing marker 中間。
- Marker level 增加時，closing marker 維持相同 level。
- Autocomplete 是 UX 輔助，不是 grammar 的前提；手動輸入或外部匯入的合法 source 仍必須能獨立解析。
- 刪除、undo／redo、paste、IME 與 marker level 調整不可 aggressive 改寫使用者內容。

## 與 Reference／Code 的責任邊界

正文目前只保留兩種 managed reference：

`[value](:ref:Identifier)`

`[[@Identifier|value]]`

Reference 需要利用 Markdown link／wikilink 的天然 rendering 弱化 identifier，只保留可讀 value 作主要閱讀表面。

Binding 本身不需要隱藏。

真正 code 不屬於 Note Binding Language；需要程式能力時使用真實程式語言及其 compiler／runtime。