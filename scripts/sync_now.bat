@echo off
chcp 65001 >nul
rem One-click sync: fetch -> sync (dry-run) -> sync (write). Window stays open.
cd /d "%~dp0.."
echo === [1/3] NHK fetch ===
node src\index.js fetch
if errorlevel 1 goto :error
echo === [2/3] sync (dry-run) ===
node src\index.js sync --dry-run
echo === [3/3] sync (write) ===
node src\index.js sync
echo.
echo Done. Press any key to close this window.
pause
exit /b 0
:error
echo.
echo Error: aborted. Check the messages above and logs\last_run.txt.
pause
exit /b 1
