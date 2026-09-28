# v0.3.2 UI 修正版驗收入口

SandboxRoot 是 repository 的上一層；本機絕對位置見 EXECUTION-STATE。私人資料與 generated Markdown 不在 Git。

```text
SandboxRoot/
├─ README-驗收.md
├─ 開啟 MainVault 驗收.cmd
├─ 開啟驗收資料夾.cmd
├─ GraspPortable/                       # source / tests / docs
│  └─ artifacts/GraspPortable-0.3.2/     # ignored packaged application
├─ Acceptance/
│  ├─ MainVault-Source/                 # read-only original snapshot
│  ├─ MainVault-Grasp/                  # preserved v0.2 rehearsal
│  └─ MainVault-Grasp-v0.3/             # new full-corpus acceptance
│     ├─ .grasp/workspace.grasp.db
│     ├─ .grasp/recovery/
│     └─ Markdown/                      # one readable projection
│        └─ .grasp-export/              # full rebuild metadata
└─ Scratch/                            # private migration / benchmarks / tests
```

修正版入口指定 packaged v0.3.2，沿用相同 MainVault-Grasp-v0.3 資料及 port43861，避免沿用43821上可能存在的舊host。Node.js24+必須已安裝；保留啟動主控台，停止用Ctrl+C。Launcher核對build identity與DB路徑，不自動終止未知程序。

MainVault原始2,820篇筆記、244個資料夾、506個附件保持內容與階層。另有明示synthetic的「Grasp acceptance shared workflow」，用於試驗M4.Root／M4.Nested；不是自動重分類私人資料。全量roundtrip實際證據見M4 verification；歷史160-note rehearsal保留，不能當新版全量workspace。

先搜尋synthetic note，從reference修改共享值，查看巢狀結果，試獨立共享撤銷及Reading模式。開啟「分組策略與Fallback」可看所有資料的確定性配置，以及驗收note分出的三個semantic units；原owner不變。

「顯示筆記檔」與「開啟資料夾」提供Explorer入口；Files面板顯示絕對路徑與附件。一般AI使用直接從Explorer拖Markdown／附件給ChatGPT。需要跨資料夾精選輸出時才使用selected export，沒有第二套persistent AI projection。

Obsidian使用「Open folder as vault」開啟MainVault-Grasp-v0.3/Markdown。完整fallback要連同hidden .grasp-export與全部附件保存；以manifest.json重建新的DB。外部修改經Review／Import；不要直接編輯DB、metadata、recovery或原始snapshot。出現dirty時不覆蓋外部內容。

2026-09-28 續作驗收已取得真正 Computer Use 證據：既有 acceptance note 可在 Grasp UI 開啟，Reading mode 實際顯示 `Acceptance`、`M4.Root`、`M4.Nested`。原始 acceptance workspace 的完整 projection 亦已成功發布到 `DB revision 53 / public revision 53`；`Markdown/.grasp-export/manifest.json` 存在，revision 53、3,331 files，fingerprint 與發布結果一致。

目前不再把舊 Computer Use 缺失或原始 acceptance publication 視為 Grasp 開工 blocker。Explorer command 修正已在 bd1b9a0，20 focused tests、build 與 10 E2E 通過；本輪 Computer Use 因無法確認 browser URL 而停止，實際 Explorer 選中結果仍待驗。Scratch copy 的 `EPERM: rename Markdown -> .grasp/internal/projection/old-*` 根因未定，不能只憑另一次 sandbox access probe 就歸因於 sandbox；其失敗不取代原 Acceptance publication PASS。當前任務及證據界線由 [EXECUTION-STATE](EXECUTION-STATE.md) 與既有 [Chat 索引](UI-REPAIR-VERIFICATION.md#chat-單題接手) 路由。

本輪 UI 修正與實測見 [UI-REPAIR-VERIFICATION](UI-REPAIR-VERIFICATION.md)。Files／分組面板首次可能先等待全庫 checkpoint，面板會顯示說明；可關閉後继续閱讀及選筆記。檔案定位有畫面下方進度，最多等待5分鐘；逾時不代表host已取消。原驗收workspace更新前會停host並做完整離線hash備份，Scratch測試資料不覆蓋Human資料。

若顯示「Windows 無法替換 Markdown 資料夾」：資料庫寫入與舊 Markdown 保留；先關閉使用該 Markdown 資料夾的外部程式／視窗，再按建立 checkpoint。若仍失敗，保留畫面錯誤供診斷。不要手動刪除 `.grasp`、stage、journal 或舊 Markdown 來解鎖。完整 backup 位置見 EXECUTION-STATE。
