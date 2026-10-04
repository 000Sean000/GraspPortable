param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repository
try {
    & (Join-Path $PSScriptRoot 'Check-Architecture.ps1')
    if (-not $SkipTests) {
        dotnet run --project tests/GraspPortable.Core.Tests -c Release
        if ($LASTEXITCODE -ne 0) { throw 'Core fixtures failed.' }
        dotnet run --project tests/GraspPortable.Integration.Tests -c Release
        if ($LASTEXITCODE -ne 0) { throw 'SQLite integration checks failed.' }
        dotnet run --project tests/GraspPortable.Host.Tests -c Release
        if ($LASTEXITCODE -ne 0) { throw 'Host HTTP/process checks failed.' }
        foreach ($suite in @('FileOperations', 'Markdown', 'ExternalEdits', 'Sources', 'MarkdownWorkspace', 'Migration', 'Coordinator', 'FileActions', 'Backup', 'BackupManager', 'GroupedNotes', 'Records', 'Content', 'GroupedWorkspace', 'GroupingMetadata', 'RecordsKnowledge', 'RecordsWorkspace', 'GroupingLinks', 'GroupingService', 'RecordsService', 'RecordImport', 'RecordsUi', 'DraftDeparture')) {
            dotnet run --project "tests/GraspPortable.$suite.Tests" -c Release
            if ($LASTEXITCODE -ne 0) { throw "$suite checks failed." }
        }
    }
    dotnet publish src/GraspPortable.Host -c Release -r win-x64 --self-contained false -o artifacts/FirstUI/Host
    if ($LASTEXITCODE -ne 0) { throw 'Host publish failed.' }
    dotnet publish src/GraspPortable.App -c Release -r win-x64 --self-contained false -p:WindowsAppSDKSelfContained=true -p:WindowsPackageType=None -o artifacts/FirstUI/App
    if ($LASTEXITCODE -ne 0) { throw 'Windows App publish failed.' }
    Write-Host 'Build ready. Run Start-GraspPortable.cmd from the repository root.'
} finally { Pop-Location }
