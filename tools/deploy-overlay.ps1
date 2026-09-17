# Deploy the overlay files to the Celeste game folder.
#
# Usage (PowerShell, make sure Celeste is CLOSED first):
#   powershell -ExecutionPolicy Bypass -File "<repo>\tools\deploy-overlay.ps1"
#
# NOTE: this script is intentionally written in PURE ASCII.
# Windows PowerShell 5.1 reads .ps1 files using the system codepage (GBK on a
# Chinese Windows). Any UTF-8 Chinese text inside gets mangled into garbage and
# can even break parsing (an error about a missing string terminator).
# So: no Chinese characters in this file. Keep it that way.

$ErrorActionPreference = "Stop"

# --- target: the real overlay folder the game reads ---
$DST = "D:\Steam\steamapps\common\Celeste\ConsistencyTracker\external-tools\ExternalOverlay"
$FILES = @("CCTOverlay.js", "CCTOverlay.css", "CCTOverlay.html")

# --- source: derive it from this script's own location ---
# This script lives in <repo>\tools\, so the overlay is <repo>\ExternalOverlay.
# Deriving the path avoids hardcoding a folder name that contains CJK chars.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SRC = Join-Path (Split-Path -Parent $ScriptDir) "ExternalOverlay"

Write-Host ""
Write-Host "=== Overlay deploy ===" -ForegroundColor Cyan
Write-Host "  source: $SRC"
Write-Host "  target: $DST"
Write-Host ""

# 1) Celeste must be closed
$proc = Get-Process -Name Celeste -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[FAIL] Celeste is still running (PID $($proc.Id))." -ForegroundColor Red
    Write-Host "       Close the game first, then run this script again." -ForegroundColor Red
    Write-Host "       While the game is open the overlay files are locked and" -ForegroundColor Red
    Write-Host "       any copy would not take effect." -ForegroundColor Red
    exit 1
}
Write-Host "[1/4] Celeste is closed ......... OK" -ForegroundColor Green

# 2) both folders must exist
if (-not (Test-Path $SRC)) {
    Write-Host "[FAIL] Source folder not found:" -ForegroundColor Red
    Write-Host "       $SRC" -ForegroundColor Red
    Write-Host "       Put this script back under <repo>\tools\ and retry." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $DST)) {
    Write-Host "[FAIL] Target folder not found:" -ForegroundColor Red
    Write-Host "       $DST" -ForegroundColor Red
    Write-Host "       Check where ConsistencyTracker is installed." -ForegroundColor Red
    exit 1
}
Write-Host "[2/4] Both folders exist ........ OK" -ForegroundColor Green

# 3) backup the current game-side files
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bk = Join-Path (Split-Path $DST) ("ExternalOverlay_backup_" + $ts)
New-Item -ItemType Directory -Path $bk -Force | Out-Null
foreach ($f in $FILES) {
    $p = Join-Path $DST $f
    if (Test-Path $p) { Copy-Item $p $bk -Force }
}
Write-Host "[3/4] Backed up to:" -ForegroundColor Green
Write-Host "      $bk" -ForegroundColor Green

# 4) copy + verify by MD5
$ok = $true
foreach ($f in $FILES) {
    $s = Join-Path $SRC $f
    if (-not (Test-Path $s)) {
        Write-Host "      MISSING source file: $f" -ForegroundColor Red
        $ok = $false
        continue
    }
    Copy-Item $s $DST -Force
    $a = (Get-FileHash (Join-Path $SRC $f) -Algorithm MD5).Hash
    $b = (Get-FileHash (Join-Path $DST $f) -Algorithm MD5).Hash
    if ($a -eq $b) {
        Write-Host "      $f  OK  $a" -ForegroundColor Green
    } else {
        Write-Host "      $f  CHECKSUM MISMATCH" -ForegroundColor Red
        $ok = $false
    }
}

Write-Host ""
if ($ok) {
    Write-Host "[4/4] Done. Reopen the overlay page in game (or restart Celeste)." -ForegroundColor Green
} else {
    Write-Host "[4/4] Some files failed - see the red lines above." -ForegroundColor Red
}
Write-Host ""
