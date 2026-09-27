# v0.2 Acceptance Preparation

本輪只整理既有成品的驗收入口、資料位置及 filesystem projection。

```text
SandboxRoot/
├─ README-驗收.md
├─ 開啟 MainVault 驗收.cmd
├─ 開啟驗收資料夾.cmd
├─ GraspPortable/                 # Git source/tests/docs and ignored build dependencies
├─ Acceptance/
│  ├─ MainVault-Source/           # original private snapshot, read-only comparison
│  └─ MainVault-Grasp/
│     ├─ .grasp/workspace.grasp.db
│     ├─ .grasp/manifests/
│     ├─ .grasp/internal/
│     └─ Markdown/                # only human-readable projection
└─ Scratch/                      # former migration/benchmarks/workspaces/packages
```

啟動 sandbox root 的 MainVault launcher；它明確指定 Acceptance DB。程式工具列可直接顯示目前 note 檔或開啟 folder，Files 面板提供 workspace、Markdown root、附件、absolute paths 及進階 exchange/rebuild 操作。Obsidian 開啟 `Markdown`；從 File Explorer 直接拖 Markdown／附件給 ChatGPT。不需建立另一套 AI folder。

原始 snapshot 在本輪搬移前先建立全量 hash/count/mtime manifest，再於搬移後驗證完全一致。原始內容包含上輪結束後的既有變更；本輪保留其當前版本，沒有回復成舊 baseline。Grasp workspace 是既有 160-note／11-asset rehearsal DB 的逐 byte 複製，不是重新分類或重跑完整 source migration。私人驗證報告與所有原文只放 SandboxRoot/Scratch、Acceptance，不進 Git。

外部改動不自動進 DB；dirty projection 不被覆寫。Review/Import 綁定檔案 hash、workspace revision 與既有 note identity，DB 或檔案再變更即拒絕舊審查。Internal recovery 保留在 `.grasp`，不暴露成主要筆記目錄。Canonical `grasp-asset:` links 仍是 App 語法；原 MainVault 的 relative/wiki attachment paths 保持原樣。
