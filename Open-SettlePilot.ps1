[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port = 4317,[switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$url = "http://127.0.0.1:$Port/"

function Test-SettlePilotEndpoint {
  try {
    $response = Invoke-RestMethod -Uri ($url + 'healthz') -TimeoutSec 2
    return $response.service -eq 'tameion' -and $response.surface -eq 'local' -and $response.status -eq 'ok'
  } catch { return $false }
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  throw 'SettlePilot dependencies are missing. Run npm ci in this folder once, then open the panel again.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) {
  throw 'The panel has not been built. Run npm run build once in this folder.'
}
$nodeCommand = Get-Command node -ErrorAction Stop
$nodeVersion = (& $nodeCommand.Source --version).TrimStart('v').Split('.')
if ([int]$nodeVersion[0] -lt 24 -or ([int]$nodeVersion[0] -eq 24 -and [int]$nodeVersion[1] -lt 11)) {
  throw 'SettlePilot requires Node.js 24.11 or newer.'
}

if (-not (Test-SettlePilotEndpoint)) {
  $portProbe = New-Object System.Net.Sockets.TcpClient
  try { $portProbe.Connect('127.0.0.1',$Port); throw "Port $Port is already occupied by another service. Choose -Port with a free local port." }
  catch [System.Net.Sockets.SocketException] { }
  finally { $portProbe.Dispose() }
  $previousPort = $env:PORT
  $env:PORT = [string]$Port
  $logDirectory=Join-Path $projectRoot 'data'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  try {
    $panelProcess=Start-Process -FilePath $nodeCommand.Source -ArgumentList @('--import','tsx','src/server.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'panel-startup.log') -RedirectStandardError (Join-Path $logDirectory 'panel-startup-errors.log')
  } finally {
    if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
    else { $env:PORT = $previousPort }
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-SettlePilotEndpoint) { $ready = $true; break }
    if ($panelProcess.HasExited) { break }
  }
  if (-not $ready) { if(-not $panelProcess.HasExited){$panelProcess.Kill()};throw 'SettlePilot did not start. Inspect data/panel-startup-errors.log locally or run npm start in PowerShell.' }
}

Write-Output "SettlePilot panel ready: $url"
if(-not $NoBrowser){Start-Process $url}
