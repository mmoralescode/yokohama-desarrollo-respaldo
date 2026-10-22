param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetDir = [IO.Path]::GetFullPath($Destination)
$runtimeDir = [IO.Path]::GetFullPath((Join-Path $projectDir '.runtime'))
if (-not $targetDir.StartsWith($runtimeDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'El paquete debe estar dentro de .runtime. No se escribira fuera del proyecto.'
}
if (Test-Path -LiteralPath $targetDir) { throw 'El destino ya existe. Usa un paquete nuevo para no reemplazar archivos.' }
New-Item -ItemType Directory -Path $targetDir | Out-Null
foreach ($name in @('server.py', 'vercel.json', '.python-version', '.vercelignore')) {
    Copy-Item -LiteralPath (Join-Path $projectDir "api-deployment/$name") -Destination $targetDir
}
New-Item -ItemType Directory -Path (Join-Path $targetDir 'backend/app') -Force | Out-Null
foreach ($source in @(Get-ChildItem -LiteralPath (Join-Path $projectDir 'backend/app') -File -Filter '*.py')) {
    Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $targetDir 'backend/app')
}
Copy-Item -LiteralPath (Join-Path $projectDir 'backend/requirements.txt') -Destination (Join-Path $targetDir 'requirements.txt')
Copy-Item -LiteralPath (Join-Path $projectDir 'catalogos') -Destination $targetDir -Recurse
New-Item -ItemType Directory -Path (Join-Path $targetDir 'config') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDir 'config/policy.json') -Destination (Join-Path $targetDir 'config')
$unexpected = @(Get-ChildItem -LiteralPath $targetDir -Recurse -File | Where-Object { $_.Name -match '\.(db|bak|sqlite|env|log)(-|$|\.)' })
if ($unexpected.Count -gt 0) { throw 'El paquete contiene un archivo privado inesperado. No desplegar.' }
Write-Output "Paquete API sin base local ni credenciales: $targetDir"
