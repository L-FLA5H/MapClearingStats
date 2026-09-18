# CCT diagnostic watcher.
#
# WHY THIS EXISTS:
#   The user's machine has no `node` in PATH, and a file:// HTML page may be
#   blocked from calling http://localhost (private network access restriction).
#   PowerShell is always available on Windows and CAN reach CCT - verified.
#
# NOTE: this file is intentionally PURE ASCII.
#   Windows PowerShell 5.1 reads .ps1 files using the system codepage (GBK on a
#   Chinese Windows). Any UTF-8 Chinese text inside gets mangled and can even
#   break parsing. Keep it ASCII. Output values may still contain Chinese -
#   those come from CCT at runtime and are decoded correctly.
#
# USAGE (PowerShell):
#   powershell -ExecutionPolicy Bypass -File "<repo>\tools\diag.ps1" 180
#   (the number is how many seconds to watch; default 120)
#
# OUTPUT:
#   <repo>\tools\_diag.txt   <- send this file back
#
# TWO REQUEST HEADERS ARE MANDATORY (both were painful to discover):
#   Host: localhost:32270      - connecting to 127.0.0.1 gives 400 Invalid Hostname
#   Accept: application/json   - without it CCT returns 200 with an EMPTY body

param([int]$Seconds = 120)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Port = 32270
$Base = "http://127.0.0.1:$Port"
$Headers = @{ Host = "localhost:$Port"; Accept = "application/json" }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutFile = Join-Path $ScriptDir "_diag.txt"

function Write-Out($text) {
    Add-Content -Path $OutFile -Value $text -Encoding UTF8
}

function Get-CctJson($path) {
    try {
        $r = Invoke-WebRequest -Uri ($Base + $path) -Headers $Headers -UseBasicParsing -TimeoutSec 5
        if (-not $r.Content -or $r.Content.Length -eq 0) { return $null }
        return ($r.Content | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Get-Formats($formats) {
    try {
        $body = @{ formats = $formats } | ConvertTo-Json -Depth 3
        $r = Invoke-WebRequest -Uri ($Base + "/cct/parseFormat") -Method POST `
             -Headers $Headers -ContentType "application/json" `
             -Body $body -UseBasicParsing -TimeoutSec 5
        $j = $r.Content | ConvertFrom-Json
        if ($j.errorCode -ne 0) { return $null }
        return $j.formats
    } catch {
        return $null
    }
}

# Placeholders the overlay actually uses.
# 刻意独立维护：本脚本是给「没装 node 的用户」准备的诊断工具，不依赖任何 JS。
# 主表在 CCTOverlay.js 的 CctClient 分区（GOLDEN_STATS_PLACEHOLDERS / PROBE_PLACEHOLDERS），
# 改动占位符时请对照那边，保持这里的 9 项子集同步。
$FMT = @(
    "{room:name}",
    "{room:debugName}",
    "{room:goldenSuccessRate}",
    "{room:goldenSuccesses}",
    "{room:goldenEntries}",
    "{room:goldenEntryChance}",
    "{run:currentPbStatusNumber}",
    "{room:goldenDeaths}",
    "{room:goldenDeathsSession}"
)

function Get-Snapshot {
    $st = Get-CctJson "/cct/state"
    $fm = Get-Formats $FMT

    if ($null -eq $st) { return $null }

    $cr = $st.currentRoom
    $mod = $st.modState
    $pa = $cr.previousAttempts

    $paLen = -1
    $paStr = ""
    if ($null -ne $pa) {
        $paLen = $pa.Count
        $sb = New-Object System.Text.StringBuilder
        foreach ($v in $pa) { if ($v) { [void]$sb.Append("1") } else { [void]$sb.Append("0") } }
        $paStr = $sb.ToString()
    }

    $s = [ordered]@{
        room      = [string]$cr.debugRoomName
        paLen     = $paLen
        paStr     = $paStr
        streak    = [string]$cr.successStreak
        streakMax = [string]$cr.successStreakBest
        deathsRun = [string]$cr.deathsInCurrentRun
        holding   = [string]$mod.playerIsHoldingGolden
        gDeaths   = [string]$cr.goldenBerryDeaths
        gDeathsS  = [string]$cr.goldenBerryDeathsSession
    }
    if ($null -ne $fm) {
        $names = @("roomName","debugName","gRate","gSucc","gEntry","gEntryChance","runNo","gD","gDS")
        for ($i = 0; $i -lt $names.Count; $i++) {
            $s[$names[$i]] = [string]$fm[$i]
        }
    }
    return $s
}

# ---------------- main ----------------
Set-Content -Path $OutFile -Value ("===== CCT diag start " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " =====") -Encoding UTF8
Write-Out ("watch seconds: " + $Seconds)

$prev = $null
$start = Get-Date
$tick = 0

while ($true) {
    $cur = Get-Snapshot
    if ($null -eq $cur) {
        if ($tick -eq 0) {
            Write-Out "!! cannot reach CCT. Is Celeste running?"
        } elseif ($tick % 30 -eq 0) {
            Write-Out ("[" + (Get-Date -Format "HH:mm:ss") + "] still cannot reach CCT")
        }
        $tick++
    } else {
        if ($null -eq $prev) {
            Write-Out ""
            Write-Out ("[" + (Get-Date -Format "HH:mm:ss") + "] baseline")
            foreach ($k in $cur.Keys) { Write-Out ("   " + $k.PadRight(12) + " = " + $cur[$k]) }
        } else {
            $lines = @()
            foreach ($k in $cur.Keys) {
                if ($prev[$k] -ne $cur[$k]) {
                    $lines += ("   " + $k.PadRight(12) + " : " + $prev[$k] + "  ->  " + $cur[$k])
                }
            }
            if ($lines.Count -gt 0) {
                Write-Out ""
                Write-Out ("[" + (Get-Date -Format "HH:mm:ss") + "] room=" + $cur["room"] +
                           "  holding=" + $cur["holding"] + "  deathsRun=" + $cur["deathsRun"])
                foreach ($l in $lines) { Write-Out $l }
            }
        }
        $prev = $cur
        $tick++
    }

    if (((Get-Date) - $start).TotalSeconds -ge $Seconds) { break }
    Start-Sleep -Milliseconds 1000
}

Write-Out ""
Write-Out "===== done ====="
Write-Out ("result file: " + $OutFile)
