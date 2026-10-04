[CmdletBinding()]
param([switch]$IncludeDemo,[string]$DemoRoot='')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
if(-not $DemoRoot){$DemoRoot=Join-Path $taskRoot '..\catooon-public'}
$taskStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$taskRelease=Join-Path $taskRoot ('artifacts\release-'+$taskStamp)
New-Item -ItemType Directory -Path $taskRelease | Out-Null

function Copy-Source([string]$Source,[string]$Name,[bool]$Public){
  $taskDestination=Join-Path $taskRelease $Name
  New-Item -ItemType Directory -Path $taskDestination | Out-Null
  foreach($taskDirectory in @('src','tests','agent','examples')){Copy-Item -LiteralPath (Join-Path $Source $taskDirectory) -Destination $taskDestination -Recurse}
  Copy-Item -LiteralPath (Join-Path $Source 'scripts') -Destination $taskDestination -Recurse
  if(-not $Public){Copy-Item -LiteralPath (Join-Path $Source '.agents') -Destination $taskDestination -Recurse}
  foreach($taskFile in @('package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','policy.example.json','.env.example','.gitignore','AGENTS.md','LICENSE')){Copy-Item -LiteralPath (Join-Path $Source $taskFile) -Destination $taskDestination}
  if($Public){
    foreach($taskFile in @('README.md','vite.public.config.ts','vercel.json','.vercelignore','render.yaml')){Copy-Item -LiteralPath (Join-Path $Source $taskFile) -Destination $taskDestination}
    foreach($taskDirectory in @('api','web')){Copy-Item -LiteralPath (Join-Path $Source $taskDirectory) -Destination $taskDestination -Recurse}
    $taskCircle=Join-Path $taskDestination 'deployment\circle';New-Item -ItemType Directory -Path $taskCircle | Out-Null
    foreach($taskFile in @('package.json','package-lock.json')){Copy-Item -LiteralPath (Join-Path $Source ('deployment\circle\'+$taskFile)) -Destination $taskCircle}
    Copy-Item -LiteralPath (Join-Path $Source 'deployment\render-start.ts') -Destination (Join-Path $taskDestination 'deployment')
    Copy-Item -LiteralPath (Join-Path $Source 'deployment\vps-start.ts') -Destination (Join-Path $taskDestination 'deployment')
    Copy-Item -LiteralPath (Join-Path $Source 'deployment\vps') -Destination (Join-Path $taskDestination 'deployment') -Recurse
  }else{
    Copy-Item -LiteralPath (Join-Path $Source 'Open-Tameion.ps1') -Destination $taskDestination
    Copy-Item -LiteralPath (Join-Path $Source 'Open-SettlePilot.ps1') -Destination $taskDestination
    Copy-Item -LiteralPath (Join-Path $Source 'README.md') -Destination $taskDestination
  }
  $taskDocs=Join-Path $taskDestination 'docs';New-Item -ItemType Directory -Path $taskDocs | Out-Null
  foreach($taskDoc in @('INSTALLATION.md','00-product-and-contest.md','01-product-scope.md','06-adaptive-agent-loop.md','08-tooling-and-setup.md','09-sources-and-research.md','submission.md','12-hermes-inspired-agent-runtime.md','13-telegram-notifications.md','18-autonomous-operations-results.md','22-observer-demo-and-installation.md','23-release-readiness.md','24-cloud-deployment.md','25-free-hosting-research.md','26-vps-deployment.md','27-live-connections.md','28-product-intelligence-review.md')){Copy-Item -LiteralPath (Join-Path $Source ('docs\'+$taskDoc)) -Destination $taskDocs}
  [IO.File]::WriteAllText((Join-Path $taskDocs '03-implementation-status.md'),'# Source release status'+[Environment]::NewLine+'Clean source only. Tests/builds use isolated adapters. No configured wallet, private history, published deployment or new financial authority is included. See INSTALLATION.md and 24-cloud-deployment.md for setup and remaining deployment acceptance checks.'+[Environment]::NewLine)
  # Include linked documentation without copying runtime records or private files.
  do {
    $taskCopied=$false
    foreach($taskMarkdown in Get-ChildItem -LiteralPath $taskDestination -Filter '*.md' -Recurse){
      foreach($taskMatch in [regex]::Matches([IO.File]::ReadAllText($taskMarkdown.FullName),'\[[^\]]*\]\(([^)]+)\)')){
        $taskTarget=$taskMatch.Groups[1].Value.Split('#')[0]
        if($taskTarget -match '^(https?:|app:|mailto:)' -or -not $taskTarget.EndsWith('.md')){continue}
        $taskLinked=[IO.Path]::GetFullPath((Join-Path $taskMarkdown.DirectoryName $taskTarget))
        if($taskLinked.StartsWith($taskDocs+[IO.Path]::DirectorySeparatorChar) -and -not (Test-Path -LiteralPath $taskLinked)){
          $taskRelative=$taskLinked.Substring($taskDestination.Length+1)
          $taskOriginal=Join-Path $Source $taskRelative
          if(Test-Path -LiteralPath $taskOriginal){Copy-Item -LiteralPath $taskOriginal -Destination $taskLinked;$taskCopied=$true}
        }
      }
    }
  } while($taskCopied)
  $taskZip=Join-Path $taskRelease ($Name+'-source.zip');Compress-Archive -LiteralPath $taskDestination -DestinationPath $taskZip
  return @{sourceDirectory=$taskDestination;archive=$taskZip;sha256=(Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLower();label='CLEAN_SOURCE_NO_CREDENTIALS_OR_OPERATOR_HISTORY'}
}
$taskManifests=@(Copy-Source $taskRoot 'settlepilot' $false)
if($IncludeDemo){$taskManifests+=Copy-Source ([IO.Path]::GetFullPath($DemoRoot)) 'settlepilot-demo' $true}
[IO.File]::WriteAllText((Join-Path $taskRelease 'manifest.json'),(ConvertTo-Json -InputObject $taskManifests -Depth 4))
Write-Output (ConvertTo-Json -InputObject @{directory=$taskRelease;releases=$taskManifests} -Depth 5 -Compress)
