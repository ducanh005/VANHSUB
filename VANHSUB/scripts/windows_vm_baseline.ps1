[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SnapshotId,
  [switch]$IndependentCleanGuest,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'Guest evidence')
)
$ErrorActionPreference = 'Stop'
if (-not $IndependentCleanGuest) { throw 'Run only in an independently controlled clean Windows guest; do not certify the developer host.' }
$targetDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
$system = Get-CimInstance Win32_ComputerSystem
$windows = Get-CimInstance Win32_OperatingSystem
$available = @{}
foreach ($name in @('node.exe', 'python.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  $available[$name] = if ($command) { $command.Source } else { $null }
}
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o')
  operatorDeclaredIndependentCleanGuest = $true
  snapshotId = $SnapshotId
  cleanInstallationPass = $false
  installationStatus = 'NOT TESTED'
  environmentDeclarationIsNotProofOfCleanInstallation = $true
  manufacturer = $system.Manufacturer
  model = $system.Model
  memoryBytes = $system.TotalPhysicalMemory
  windowsCaption = $windows.Caption
  windowsVersion = $windows.Version
  windowsBuild = $windows.BuildNumber
  availableCommands = $available
}
$file = Join-Path $targetDirectory ('baseline-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json')
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $file -Encoding UTF8
Write-Output "Baseline saved: $file. Installation remains NOT TESTED."
