# HoloGesture installer for Windows (x64). In PowerShell:
#
#   Install:    irm https://github.com/Sambit1110/hologesture/releases/latest/download/install.ps1 | iex
#   Uninstall:  $env:HOLOGESTURE_UNINSTALL=1; irm https://github.com/Sambit1110/hologesture/releases/latest/download/install.ps1 | iex
#
# Downloads the app, checks its SHA-256 checksum, installs it to
# %LOCALAPPDATA%\Programs\HoloGesture and adds Start menu and desktop shortcuts.
$ErrorActionPreference = 'Stop'
$Repo = 'Sambit1110/hologesture'
$Base = if ($env:HOLOGESTURE_BASE_URL) { $env:HOLOGESTURE_BASE_URL } else { "https://github.com/$Repo/releases/latest/download" }
$Asset = 'HoloGesture-windows-x64.zip'
$Dest = Join-Path $env:LOCALAPPDATA 'Programs\HoloGesture'
$Shortcuts = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'HoloGesture.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'HoloGesture.lnk')
)

if ($env:HOLOGESTURE_UNINSTALL) {
  Get-Process HoloGesture -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue
  $Shortcuts | ForEach-Object { Remove-Item $_ -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:HOLOGESTURE_UNINSTALL
  Write-Host '==> HoloGesture removed. Settings and calibration recordings are in %APPDATA%\HoloGesture.'
  return
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Write-Host 'Windows on ARM: installing the x64 build, which runs under emulation.' }

$Tmp = Join-Path $env:TEMP ('hologesture-' + [guid]::NewGuid())
New-Item -ItemType Directory $Tmp | Out-Null
try {
  Write-Host '==> Downloading HoloGesture for Windows (x64)...'
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes downloads much slower
  Invoke-WebRequest "$Base/$Asset" -OutFile "$Tmp\$Asset" -UseBasicParsing
  Invoke-WebRequest "$Base/SHA256SUMS" -OutFile "$Tmp\SHA256SUMS" -UseBasicParsing

  Write-Host '==> Checking the download...'
  $line = Get-Content "$Tmp\SHA256SUMS" | Where-Object { ($_ -split '\s+')[1] -eq $Asset } | Select-Object -First 1
  if (-not $line) { throw "No checksum listed for $Asset." }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash "$Tmp\$Asset" -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw 'Checksum mismatch: the download is corrupted or was tampered with. Please try again.' }

  Get-Process HoloGesture -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
  New-Item -ItemType Directory (Split-Path $Dest) -Force | Out-Null
  Expand-Archive "$Tmp\$Asset" -DestinationPath $Tmp -Force
  Move-Item "$Tmp\HoloGesture-win32-x64" $Dest

  $shell = New-Object -ComObject WScript.Shell
  foreach ($path in $Shortcuts) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = "$Dest\HoloGesture.exe"
    $lnk.WorkingDirectory = $Dest
    $lnk.IconLocation = "$Dest\HoloGesture.ico"
    $lnk.Description = 'Control 3D holograms with your hands'
    $lnk.Save()
  }
  Write-Host "==> Installed to $Dest"
  Write-Host '    Open HoloGesture from the Start menu or the desktop shortcut.'
} finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
