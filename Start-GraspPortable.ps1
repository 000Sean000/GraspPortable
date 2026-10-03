param([string]$Workspace, [switch]$Build)
$ErrorActionPreference = 'Stop'
$repository = $PSScriptRoot
if (-not $Workspace) { $Workspace = Join-Path $repository 'workspaces/FirstUI' }
$Workspace = [System.IO.Path]::GetFullPath($Workspace)
$application = Join-Path $repository 'artifacts/FirstUI/App/GraspPortable.App.exe'
$backend = Join-Path $repository 'artifacts/FirstUI/Host/GraspPortable.Host.dll'
if ($Build -or -not (Test-Path -LiteralPath $application) -or -not (Test-Path -LiteralPath $backend)) {
    & (Join-Path $repository 'scripts/Build-FirstUI.ps1')
}
$env:GRASP_WORKSPACE = $Workspace
$env:GRASP_HOST_PATH = $backend
# The foreground App is the requested interactive product; its Host uses a hidden process.
Start-Process -FilePath $application -WorkingDirectory (Split-Path -Parent $application)
