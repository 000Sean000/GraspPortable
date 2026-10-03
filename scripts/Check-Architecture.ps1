$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$allowed = @{
    'App' = @('GraspPortable.Contracts')
    'Host' = @('GraspPortable.Core','GraspPortable.Contracts')
    'Core' = @()
    'Contracts' = @()
}
foreach ($name in $allowed.Keys) {
    $file = Join-Path $repository "src/GraspPortable.$name/GraspPortable.$name.csproj"
    [xml]$project = Get-Content -LiteralPath $file -Raw
    $references = @($project.SelectNodes('//ProjectReference') | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Include.Replace('\','/')) })
    if (@(Compare-Object $allowed[$name] $references).Count -ne 0) { throw "Unexpected product references in $name" }
}
$coreFiles = Get-ChildItem -LiteralPath (Join-Path $repository 'src/GraspPortable.Core') -Recurse -File -Filter '*.cs' | Where-Object { $_.FullName -notmatch '[\\/](obj|bin)[\\/]' }
foreach ($file in $coreFiles) {
    if (Select-String -LiteralPath $file.FullName -Pattern '^\s*using\s+(GraspPortable\.(Host|App|Contracts)|Microsoft\.(AspNetCore|Data\.Sqlite|Maui))' -Quiet) {
        throw "Core imports an outer adapter: $($file.Name)"
    }
}
Write-Output 'PASS: four product project references and Core adapter boundary.'
