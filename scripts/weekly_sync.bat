@echo off
rem Scheduler launcher. Runs weekly_sync.js from the project root.
rem The absolute path of node.exe can be passed as the first argument
rem (resolved by register_weekly_task.ps1 at registration time).
cd /d "%~dp0.."
set "NODE_EXE=%~1"
if "%NODE_EXE%"=="" set "NODE_EXE=node"
"%NODE_EXE%" scripts\weekly_sync.js
exit /b %ERRORLEVEL%
