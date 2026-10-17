@echo off
chcp 936 >nul
title 一键修复朱雀音效（开发用，调用随包脚本）
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo 正在请求管理员权限，请在弹出的 UAC 窗口点"是"...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "PS1=%~dp0app\src-tauri\resources\repair\repair-apo.ps1"
set "DRV=%~dp0app\src-tauri\resources\driver"
set "LOG=%~dp0driver-repair.log"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Drv "%DRV%" -Log "%LOG%"

echo.
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -LiteralPath '%LOG%' -Encoding UTF8 | Where-Object { $_ -match '^\[' -or $_ -match '^---' -or $_ -match '^结果' } }"
echo.
pause
