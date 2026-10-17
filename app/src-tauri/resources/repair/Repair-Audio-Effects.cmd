@echo off
chcp 936 >nul
title 竹林鸟朱雀 Hub - 音效修复
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo 正在请求管理员权限，请在弹出的 UAC 窗口点"是"...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "PS1=%~dp0repair-apo.ps1"
set "LOG=%~dp0driver-repair.log"

if not exist "%PS1%" (
  echo 找不到 repair-apo.ps1，请确认它与本文件在同一目录。
  pause
  exit /b 1
)

echo ============================================================
echo   修复音效：重新注册 APO（不影响耳机正常出声）
echo   驱动目录：%~dp0driver
echo   日志文件：%LOG%
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Drv "%~dp0driver" -Log "%LOG%"

echo.
echo ============================================================
echo   执行摘要
echo ============================================================
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -LiteralPath '%LOG%' -Encoding UTF8 | Where-Object { $_ -match '^\[' -or $_ -match '^---' -or $_ -match '^结果' } }"
echo ============================================================
echo.
echo   看到 apo_registered=True 即为修复成功；
echo   成功后请关闭并重新打开「竹林鸟朱雀 Hub」。
echo.
pause
