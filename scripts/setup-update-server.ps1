param([switch]$NoPause)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $PSScriptRoot ".update-server.env"
$manifest = Join-Path $root "update-server\latest.json"

if (-not (Test-Path -LiteralPath $envFile)) {
    throw "请先复制 scripts/.update-server.env.example 为 scripts/.update-server.env，并填写 UPDATE_PASS"
}
if (-not (Test-Path -LiteralPath $manifest)) {
    throw "找不到更新清单样例：$manifest"
}

Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
    $pair = $_ -split "=", 2
    Set-Item -Path "Env:$($pair[0].Trim())" -Value $pair[1].Trim()
}
if (-not $env:UPDATE_PASS) { throw "scripts/.update-server.env 中的 UPDATE_PASS 不能为空" }
$env:UPDATE_MANIFEST = $manifest

python (Join-Path $PSScriptRoot "_setup_update_server.py")
if ($LASTEXITCODE -ne 0) { throw "创建更新目录失败" }
python (Join-Path $PSScriptRoot "_enable_closedport_location.py")
if ($LASTEXITCODE -ne 0) { throw "配置 Nginx 失败" }

$url = "http://$($env:UPDATE_HOST)/closedport/latest.json"
$response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
if ($response.Headers["Content-Type"] -notmatch "json") {
    throw "服务器仍未返回 JSON：$($response.Headers['Content-Type'])"
}
Write-Host "更新服务器初始化完成：$url" -ForegroundColor Green

if (-not $NoPause -and [Environment]::UserInteractive) {
    Write-Host "按 Enter 关闭窗口"
    [void][Console]::ReadLine()
}
