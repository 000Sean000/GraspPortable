# v0.3 驗收入口

SandboxRoot 是 repository 的上一層；本機絕對位置見 EXECUTION-STATE。私人資料與 generated Markdown 不在 Git。

```text
SandboxRoot/
├─ README-驗收.md
├─ 開啟 MainVault 驗收.cmd
├─ 開啟驗收資料夾.cmd
├─ GraspPortable/                       # source / tests / docs
│  └─ artifacts/GraspPortable-0.3.0/     # ignored packaged application
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

新版入口指定 packaged v0.3 與 port43861，避免沿用43821上可能存在的舊host。Node.js24+必須已安裝；保留啟動主控台，停止用Ctrl+C。Launcher核對build identity與DB路徑，不自動終止未知程序。

MainVault原始2,820篇筆記、244個資料夾、506個附件保持內容與階層。另有明示synthetic的「Grasp acceptance shared workflow」，用於試驗M4.Root／M4.Nested；不是自動重分類私人資料。全量roundtrip實際證據見M4 verification；歷史160-note rehearsal保留，不能當新版全量workspace。

先搜尋synthetic note，從reference修改共享值，查看巢狀結果，試獨立共享撤銷及Reading模式。開啟「分組策略與Fallback」可看所有資料的確定性配置，以及驗收note分出的三個semantic units；原owner不變。

「顯示筆記檔」與「開啟資料夾」提供Explorer入口；Files面板顯示絕對路徑與附件。一般AI使用直接從Explorer拖Markdown／附件給ChatGPT。需要跨資料夾精選輸出時才使用selected export，沒有第二套persistent AI projection。

Obsidian使用「Open folder as vault」開啟MainVault-Grasp-v0.3/Markdown。完整fallback要連同hidden .grasp-export與全部附件保存；以manifest.json重建新的DB。外部修改經Review／Import；不要直接編輯DB、metadata、recovery或原始snapshot。出現dirty時不覆蓋外部內容。

桌面Obsidian／Explorer／原生IME尚缺本輪GUI操作證據；Playwright browser與實際檔案hash證據另外陳述。正式交付是否完成以EXECUTION-STATE／M4-VERIFICATION為準，不由目錄範例推定。
