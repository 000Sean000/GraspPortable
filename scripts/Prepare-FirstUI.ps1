param([string]$Workspace, [string[]]$SampleFiles = @())
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $Workspace) { $Workspace = Join-Path $repository 'workspaces/FirstUI' }
$backend = Join-Path $repository 'src/GraspPortable.Host/bin/Release/net10.0/GraspPortable.Host.dll'
if (-not (Test-Path -LiteralPath $backend)) { throw 'Build Host Release first.' }
$start = [Diagnostics.ProcessStartInfo]::new('dotnet')
$start.ArgumentList.Add($backend)
$start.ArgumentList.Add('--workspace'); $start.ArgumentList.Add([IO.Path]::GetFullPath($Workspace))
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$process = [Diagnostics.Process]::Start($start)
$secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$process.StandardInput.WriteLine($secret); $process.StandardInput.Flush()
$handshake = $process.StandardOutput.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(20)).GetAwaiter().GetResult() | ConvertFrom-Json
$baseUri = 'http://127.0.0.1:' + $handshake.port
$headers = @{ Authorization = 'Bearer ' + $secret }
function Create-Note([string]$Title, [string]$Source) {
    $payload = @{ operationId=[Guid]::NewGuid().ToString('N');title=$Title;source=$Source } | ConvertTo-Json -Depth 10
    $response = Invoke-RestMethod -Uri "$baseUri/api/notes" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    if ($response.status -ne 'committed') { throw "Note seed failed: $($response.message)" }
    return $response.noteId
}
try {
    $notes = Invoke-RestMethod -Uri "$baseUri/api/notes" -Headers $headers
    if ($notes.Count -gt 0) { throw 'Seed requires an empty workspace; existing data will not be overwritten.' }
    $definitions = @'
# 第一個完整流程

修改下方定義，其他筆記中的引用會跟著更新。先試試把「蘋果」改成「梨子」。

@code{
    @Fruit = {蘋果}
    @Person.Job = {作家}
    @Slogan = {今天吃} + Fruit
    @Message = Slogan + {，然後繼續寫作。}
    @Description = {
第一段：筆記可以保留真正的段落。

第二段：引用也能保留空行，來源修改後一起更新。
    }
'@
    foreach ($i in 1..15) { $definitions += "`n    @Label$('{0:D2}' -f $i) = {標籤 $i}" }
    $definitions += "`n}`n"
    $null = Create-Note '01 定義與組合' $definitions
    $names = @('Fruit','Person.Job','Slogan','Message','Description') + @(1..15 | ForEach-Object { 'Label{0:D2}' -f $_ })
    $references = "# 引用與共享更新`n`n點右側定義可導航、查看引用或修改共享 literal。`n`n"
    foreach ($i in 1..5) {
        $references += "## 第 $i 組`n`n"
        foreach ($name in $names) { if ($i % 2) { $references += "[讀取中](:ref:$name)`n`n" } else { $references += "[[@$name|讀取中]]`n`n" } }
    }
    $null = Create-Note '02 多段落引用' $references
    $null = Create-Note '03 語法展示與操作' @'
# 試用步驟

1. 改來源的 Fruit，查看第二篇筆記的相依更新。
2. 在來源把 Fruit 改名為 Produce，確認影響後檢查 ID 與引用。
3. 試試 Source、Live Preview、Reading。
4. 在來源留下未完成語法，再關閉並重新開啟，檢查草稿恢復。

以下內容是示例，不會定義 Example。

```grasp-demo
@code{ @Example = {此處不解析} }
```

```json
{"example": "@code{ @Example = {此處不解析} }"}
```
'@
    foreach ($sample in $SampleFiles) {
        $resolved = (Resolve-Path -LiteralPath $sample).Path
        if ([IO.Path]::GetExtension($resolved) -ne '.md') { throw 'Only explicitly selected Markdown samples are supported.' }
        $body = [IO.File]::ReadAllText($resolved)
        if ($body.Length -gt 300000) { throw 'Sample exceeds the bounded S1 fixture size.' }
        # This is a test-data adapter, not production Vault import. Source files remain read-only.
        $id = Create-Note ('樣本 · ' + [IO.Path]::GetFileNameWithoutExtension($resolved)) ''
        $note = Invoke-RestMethod -Uri "$baseUri/api/notes/$id" -Headers $headers
        $draft = @{sessionId='sample-seed';draftRevision=1;baseNoteRevision=$note.revision;title=$note.title;source=$body} | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$baseUri/api/notes/$id/draft" -Method Put -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($draft))
        $commit = @{operationId=[Guid]::NewGuid().ToString('N');sessionId='sample-seed';draftRevision=1;expectedNoteRevision=$note.revision;expectedKnowledgeRevision=$note.knowledgeRevision;confirmRename=$false} | ConvertTo-Json
        $result = Invoke-RestMethod -Uri "$baseUri/api/notes/$id/commit" -Method Post -Headers $headers -ContentType 'application/json' -Body $commit
        Write-Host "Sample added ($($body.Length) UTF16 units), status=$($result.status)."
    }
    $info = Invoke-RestMethod -Uri "$baseUri/api/workspace" -Headers $headers
    Write-Host "Prepared local test workspace at $Workspace; revision $($info.revision)."
} finally {
    try { $null = Invoke-RestMethod -Uri "$baseUri/api/shutdown" -Method Post -Headers $headers } catch { }
    if (-not $process.WaitForExit(10000)) { $process.Kill() }
    $process.Dispose()
}
