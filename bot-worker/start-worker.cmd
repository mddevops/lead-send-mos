@echo off
cd /d "%~dp0"
call npm.cmd run build
if errorlevel 1 exit /b 1
node dist\index.js
