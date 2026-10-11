# register_weekly_task.ps1 — Windows タスクスケジューラへの登録・解除
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1              # 毎週土曜 9:00 で登録(確認あり)
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1 -PrintPlan   # 登録内容の表示のみ(変更なし)
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1 -Day Monday -Time 08:00
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1 -Remove
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1 -DesktopShortcut
param(
  [string]$Day = "Saturday",
  [string]$Time = "09:00",
  [switch]$Remove,
  [switch]$DesktopShortcut,
  [switch]$PrintPlan,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$TaskName = "MusiclineSpotifySync"

# node.exe の絶対パスを解決する(PATH 依存で動かさないため)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "[エラー] node が見つかりません。Node.js をインストールするか、PATH を確認してください。"
  exit 1
}
$nodePath = $nodeCmd.Source

# プロジェクトのルート(このスクリプトの親ディレクトリ)
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "weekly_sync.bat"
if (-not (Test-Path $launcher)) {
  Write-Host "[エラー] weekly_sync.bat が見つかりません: $launcher"
  exit 1
}

function Show-Plan {
  Write-Host "タスク名      : $TaskName"
  Write-Host "スケジュール  : 毎週 $Day $Time (時刻を逃した場合は起動後すぐに実行)"
  Write-Host "実行コマンド  : $launcher $nodePath"
  Write-Host "作業ディレクトリ: $root"
  Write-Host "実行時間の上限: 1時間 / バッテリー駆動でも実行"
}

# 登録内容の表示のみ(何も変更しない)
if ($PrintPlan) {
  Show-Plan
  exit 0
}

# デスクトップに sync_now.bat のショートカットを作成
if ($DesktopShortcut) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnk = Join-Path $desktop "sync_now.lnk"
  Write-Host "デスクトップにショートカットを作成します:"
  Write-Host "  $lnk -> $(Join-Path $PSScriptRoot 'sync_now.bat')"
  if (-not $Yes) {
    $ans = Read-Host "よろしいですか? [y/N]"
    if ($ans -ne "y") { Write-Host "中止しました。"; exit 0 }
  }
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = Join-Path $PSScriptRoot "sync_now.bat"
  $sc.WorkingDirectory = $root
  $sc.Save()
  Write-Host "ショートカットを作成しました。"
  exit 0
}

# タスクの解除
if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $existing) {
    Write-Host "タスク '$TaskName' は登録されていません。"
    exit 0
  }
  Write-Host "タスク '$TaskName' を解除します。"
  if (-not $Yes) {
    $ans = Read-Host "よろしいですか? [y/N]"
    if ($ans -ne "y") { Write-Host "中止しました。"; exit 0 }
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "解除しました。"
  exit 0
}

# タスクの登録(PC の設定を変更するので、内容を表示して承認を取る)
Show-Plan
if (-not $Yes) {
  $ans = Read-Host "この内容で登録しますか? [y/N]"
  if ($ans -ne "y") { Write-Host "中止しました。(登録は行われていません)"; exit 0 }
}

$action = New-ScheduledTaskAction -Execute $launcher -Argument "`"$nodePath`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "NHK Musicline to Spotify weekly sync (musicline-spotify-sync)" | Out-Null
Write-Host "登録しました。手動で1回実行する場合: Start-ScheduledTask -TaskName $TaskName"
