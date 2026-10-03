# Builds the Windows installer: dist\CuteTube-Setup.exe
#   powershell -ExecutionPolicy Bypass -File packaging\build.ps1            (everything)
#   ... -Step app        interface + app folder (build\app\CuteTube)
#   ... -Step installer  installer from the app folder (signed in between on GitHub, see .github\workflows\release.yml)
param(
  [ValidateSet('all', 'app', 'installer')] [string] $Step = 'all',
  [string] $RepoUrl = 'https://github.com/'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$version = (Select-String -Path app\__init__.py -Pattern '__version__ = "(.+)"').Matches[0].Groups[1].Value
Write-Host "CuteTube $version"

if ($Step -in 'all', 'app') {
  $python = if (Test-Path .venv\Scripts\python.exe) { '.venv\Scripts\python.exe' } else { 'python' }

  Push-Location frontend
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm ci failed' }
  npm run build
  if ($LASTEXITCODE) { throw 'frontend build failed' }
  Pop-Location

  # Version resource: what Explorer, Task Manager and Windows' prompts show.
  $nums = @($version -split '[^\d]+' | Where-Object { $_ } | Select-Object -First 4)
  while ($nums.Count -lt 4) { $nums += '0' }
  $tuple = $nums -join ', '
  @"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($tuple), prodvers=($tuple)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'CuteTube'),
      StringStruct('FileDescription', 'CuteTube'),
      StringStruct('FileVersion', '$version'),
      StringStruct('InternalName', 'CuteTube'),
      StringStruct('LegalCopyright', 'Copyright (C) CuteTube contributors. GPL-2.0-only.'),
      StringStruct('OriginalFilename', 'CuteTube.exe'),
      StringStruct('ProductName', 'CuteTube'),
      StringStruct('ProductVersion', '$version')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@ | Set-Content -Encoding utf8 packaging\version_info.txt

  & $python packaging\notices.py
  if ($LASTEXITCODE) { throw 'notices failed' }
  & $python -m PyInstaller --noconfirm --clean --distpath build\app --workpath build\work packaging\cutetube.spec
  if ($LASTEXITCODE) { throw 'PyInstaller failed' }
}

if ($Step -in 'all', 'installer') {
  $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup)' }
  $terms = (Select-String -Path app\config.py -Pattern '^TERMS_VERSION = (\d+)').Matches[0].Groups[1].Value
  & $iscc /Qp "/DAppVersion=$version" "/DTermsVersion=$terms" "/DSourceDir=$root\build\app\CuteTube" "/DRepoUrl=$RepoUrl" "/O$root\dist" packaging\installer.iss
  if ($LASTEXITCODE) { throw 'Inno Setup failed' }
  $setup = Get-Item dist\CuteTube-Setup.exe
  Write-Host "Built $($setup.FullName) ($([math]::Round($setup.Length / 1MB)) MB)"
}
