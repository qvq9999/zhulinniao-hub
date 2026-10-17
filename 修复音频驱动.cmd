@echo off
setlocal
chcp 936 >nul
title Zhuque Hub - Audio Driver Repair

fltmc >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] 需要管理员权限。
  echo       请右键本文件 -^> "以管理员身份运行"。
  echo.
  pause
  exit /b 1
)

rem 优先用安装目录内的驱动；否则用本脚本所在仓库的随包驱动
set "DRV=C:/Program Files\竹林鸟朱雀 Hub\driver"
if not exist "%DRV%\base\CM002X1.Inf" set "DRV=%~dp0app\src-tauri\resources\driver"
if not exist "%DRV%\base\CM002X1.Inf" (
  echo   找不到驱动文件目录。请先安装「竹林鸟朱雀 Hub」，或在仓库根目录运行本脚本。
  echo   已尝试：C:/Program Files\竹林鸟朱雀 Hub\driver
  echo             %~dp0app\src-tauri\resources\driver
  pause
  exit /b 1
)

echo ============================================================
echo   C-Media 音频驱动修复（竹林鸟朱雀 CM002X1）
echo   驱动目录：%DRV%
echo ============================================================
echo.
echo [1/5] 暂存基础音频驱动...
pnputil /add-driver "%DRV%\base\CM002X1.Inf"
echo.
echo [2/5] 暂存 APO 音效组件...
pnputil /add-driver "%DRV%\apo\CM002X1_APO.inf"
echo.
echo [3/5] 暂存扩展 INF（注册 APO 属性区）...
pnputil /add-driver "%DRV%\ext\CM002X1_Ext.inf"
echo.
echo [4/5] 在耳机上安装基础驱动...
pnputil /add-driver "%DRV%\base\CM002X1.Inf" /install
echo.
echo [5/5] 重启音频设备，使扩展与 APO 生效...
pnputil /restart-device /deviceid "USB\VID_0D8C&PID_0334&MI_00"
echo.
echo ============================================================
echo   完成。请拔插一次耳机，然后重新打开「朱雀耳机 Hub」。
echo   若仍提示未找到效果区，请把本窗口内容截图反馈。
echo ============================================================
pause
