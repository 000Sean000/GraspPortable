---
title: GraspPortable — Development Environment
version: 1.0.6
updated: 2026-10-03
scope: current-workspace-and-local-toolchain
---

## Workspace 與初始化紀錄

Workspace 保持 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace`。新版 repository 位於其下 `GraspPortable/`，完整路徑為 `C:\Users\ASUS\MyData\AgentWorkspace\All-of-Me\GraspProject\GraspPortableWorkspace\GraspPortable`。

開始工作時目標 repository 已存在，origin、branch、Git 狀態符合要求，因此直接沿用，沒有 clone、搬移、reset 或變更 remote。

| 項目 | 2026-10-03 實際觀測 |
| --- | --- |
| Origin fetch／push | `https://github.com/000Sean000/GraspPortable.git` |
| Branch／upstream | `rewrite/dotnet`／`origin/rewrite/dotnet` |
| 初始化時 HEAD／遠端 SHA | `0e08a4899647ee8d5f10b9cc21af9848eedcaba5`；當次 `git ls-remote` 核對相同 |
| 開始時狀態 | `git status --porcelain=v1 --untracked-files=all` 無輸出，工作目錄乾淨 |
| 本輪實作起始 | HEAD `426e9c71759758131b1d9a3572ebd6bbf27b7b69`；乾淨且與本機 upstream 同步。當前精確變更見 `git -C GraspPortable status --short` |
| Git hooks | 未設定有效 `core.hooksPath`；repository `.git/hooks` 未見非 sample 檔案 |

Workspace 根目錄及可適用的父層未找到既有 AGENTS.md；新 repository 內也未找到較深層 AGENTS.md。已建立 **Workspace 根目錄的 `AGENTS.md`**，明確記錄目錄角色、日常搜尋僅指定 `GraspPortable/`、查 Workspace 設定只讀根目錄相關檔案，以及 Legacy1 歷史指示不適用新版。根目錄 AGENTS.md **位於此 repository 外，不受其 Git 追蹤**。

Legacy1 的完整封存狀態依本輪使用者告知；僅確認根目錄有該目錄，未進入、盤點、搜尋或修改內容。沒有建立額外清理／索引系統。舊環境清理待辦已由最新授權取代，不需接續盤點 4,597 個舊 changes。

## 已有工具鏈

下表為本機命令及 registry 觀測，不是產品 build 證據。

| 工具／平台 | 已觀測版本或狀態 |
| --- | --- |
| Windows／RID | Windows 10.0.26200／win-x64 |
| Git | 2.54.0.windows.1 |
| .NET SDK／MSBuild | 10.0.401／18.9.11 |
| .NET／ASP.NET Core runtime | 10.0.12 可用 |
| MAUI Windows workload | `maui-windows`，manifest 10.0.20/10.0.100，VS 18.10.12217.157 安裝來源 |
| .NET workload 狀態 | 使用 manifests，工具顯示未安裝 workload set；不能據此推定現有 MAUI workload 缺失 |
| Node／npm | v24.18.0／11.16.0 |
| WebView2 runtime | Registry 顯示 154.0.4258.53；本輪已觀測 App 啟動其 WebView2 程序，互動與 IME 尚未驗證 |
| 搜尋工具 | `rg` 可用 |
| CPU／RAM | i9-13980HX，24 cores／32 logical processors；33,961,390,080 bytes RAM（約 32 GB 級） |
| Workspace 磁碟 | C: NTFS；檢查時可用約 243 GiB，屬動態觀測 |

起始檢查時，Windows SDK 的常見 Include 路徑及 registry locator 未回傳安裝版本；本輪已用實際 .NET 10 MAUI project 完成 Windows Release build／publish（0 warnings／errors），並啟動原生視窗、WebView2 與獨立 Host。這確認本機建置／啟動路徑，沒有宣稱 GUI 操作或移機部署通過。

規劃起始尚無 solution、project、`global.json` 或 npm package；本輪已進入 S0–S1 實作，這項歷史觀測不代表現在仍未建立程式。工具鏈與套件以實際 restore／build 相容後鎖定；進度與驗證結果見 EXECUTION-STATE，部署邊界見[實作規劃](Implementation-Plan-v1.0.0-rc.6.md)。

## 日常使用

保持 Workspace 根目錄設定，在該處可用以下命令；列舉或搜尋永遠帶新版路徑：

```powershell
git -C GraspPortable status --short --branch
git -C GraspPortable diff --check
rg --files -g '!**/.git/**' GraspPortable
rg -n '要查的內容' GraspPortable/docs/Engineering
```

建置／啟動命令由本輪實作交付紀錄保存，只有實際成功的命令才標示已驗證。測試 workspace、資料庫、依賴、build 與驗收產物沿用 repository `.gitignore`；私人資料不進 Git。

已成功執行 `scripts/Build-FirstUI.ps1 -SkipTests`（必要 runners 已個別通過）及 `Start-GraspPortable.ps1`。最後一項 UI 修正後另重新 publish App；`global.json` 固定 SDK 10.0.401，MAUI packages 10.0.20、SQLite bundle 3.0.5，NuGet／npm locks 保留確切解析版本。詳見 [First UI](FirstUI-Quickstart.md) 與 [S1 Validation](S1-Validation.md)。

一般 shell 與 node_repl 在本次 session 曾因 `helper_unknown_error: setup refresh had errors` 無法啟動。經受審核的 shell 執行已完成讀取、工具鏈與 Git 檢查；未變更 sandbox 設定。這是工具執行環境問題，不是 repository 故障或產品 build 失敗。一般 sandbox 路徑是否恢復，尚未確認。

## 後續接手

先讀根目錄 AGENTS.md 與[工作狀態](../EXECUTION-STATE.md)，再沿[Engineering 入口](README.md)取得現行計畫。使用者已明確授權 S0–S1；文件已同步接受基準，持續完成工具鏈、產品流程及必要驗證。S1 完成後停在使用者體驗，不自動開發 S2。

指定實驗資料來源為 Workspace "TestData/MainVault-Source" 的 Obsidian Vault（使用者本輪明確授權）。只能按具體缺口少量唯讀選取／複製至忽略的測試區，不修改原件、不將私人內容 commit，也不擴張 Legacy1 搜尋或完整 S2 匯入。
