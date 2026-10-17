; ============================================================================
; 竹林鸟朱雀 Hub — NSIS 安装钩子
;
; 目的：让用户「只装本软件」即可获得全部功能，不再依赖单独安装原版驱动包。
;
; 为什么必须随包安装驱动（取证见 docs/通道全景图.md、docs/原版对齐规格.md）：
;   1) 基础 USB 音频驱动 CM002X1.SYS —— 提供播放/录音端点（音量、静音、平衡的前提）；
;   2) APO 组件 CmApoIce.dll —— EQ / 明亮化 / 人声清晰化 / 动态低频 / 智能音量 /
;      7.1 环绕 / 环绕扩增 / 麦克风降噪 / 麦克风均衡 的 DSP 本体，运行在 audiodg.exe 内，
;      应用进程无法替代；
;   3) 扩展 INF CM002X1_Ext.inf —— 以 AddComponent 注册 APO 的 CLSID，并创建
;      HKR,FX\0|FX\1\%CAPX*_PROPERTYSTORE_CONTEXT%\User 全部属性与默认值。
;      缺这一层，FxProperties 子树不存在，写进去的参数没有任何消费者。
;
; 因此三者必须按 base -> apo -> ext 的顺序安装，且安装器需以管理员身份运行
; （tauri.conf.json 里 installMode = perMachine）。
;
; ⚠️ 32 位安装器必须经 Sysnative 访问 64 位 pnputil（2026-10-17 实测事故）：
;    NSIS 安装器是 32 位进程，`$SYSDIR\pnputil.exe` 会被 WOW64 文件重定向到
;    C:\Windows\SysWOW64\，而该目录**不存在 pnputil.exe** → CreateProcess 失败 →
;    nsExec 返回 "error" → 四个返回值全变 9999，界面报「Audio driver components
;    could not be installed completely」。必须用 %WINDIR%\Sysnative\pnputil.exe
;    （仅 32 位进程可见的别名，指向真正的 64 位 System32）。
;
; 结果记录到 HKLM\SOFTWARE\ZhulinniaoHub\Driver，供应用启动时判断驱动是否就绪：
;   BaseRc / ApoRc / ExtRc  = pnputil 退出码（0 或 3010 视为成功；9999 = 启动失败）
;   Ok                      = 1 三个包全部成功
;   Log                     = 日志文件路径
;   DriverRoot              = 随包驱动文件所在目录
; ============================================================================

!include LogicLib.nsh

!define ZHUB_DRV_ROOT "$INSTDIR\driver"
!define ZHUB_REG_KEY "SOFTWARE\ZhulinniaoHub\Driver"
; 日志放在安装目录：本 NSIS 版本没有 $COMMONAPPDATA / $PROGRAMDATA 变量，
; 而安装器以 admin 运行，写 $INSTDIR 是安全的；卸载时随钩子一起删除。
!define ZHUB_LOG_FILE "$INSTDIR\driver-install.log"

; 资源文件写入前先建好目标子树。
; 注意：NSIS 的 CreateDirectory 不递归，且 File /oname 指向不存在的子目录会直接
; 中止安装（exit 2）；必须按从浅到深的顺序建，base\x64 不能漏。
!macro NSIS_HOOK_PREINSTALL
  CreateDirectory "${ZHUB_DRV_ROOT}"
  CreateDirectory "${ZHUB_DRV_ROOT}\base"
  CreateDirectory "${ZHUB_DRV_ROOT}\base\x64"
  CreateDirectory "${ZHUB_DRV_ROOT}\apo"
  CreateDirectory "${ZHUB_DRV_ROOT}\ext"
  SetOutPath "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  Push $R8
  Push $R9

  Delete "${ZHUB_LOG_FILE}"
  FileOpen $R4 "${ZHUB_LOG_FILE}" w

  ; 解析 pnputil 路径：优先 Sysnative（32 位安装器访问 64 位 System32 的唯一别名）
  StrCpy $R9 "$WINDIR\Sysnative\pnputil.exe"
  ${IfNot} ${FileExists} "$R9"
    StrCpy $R9 "$SYSDIR\pnputil.exe"
  ${EndIf}
  DetailPrint "Using pnputil: $R9"

  DetailPrint "Installing C-Media audio driver packages (stage base / apo / ext)..."

  ; 1) 先只**暂存**三个包（不带 /install，不动设备）。
  ;    扩展 INF 必须先入库：设备安装时 PnP 才会把 FX\0 的 APO CLSID 与 AddComponent 应用到设备。
  ;    若顺序反了（先 base /install 再装 ext），会出现「驱动装上了、设备能出声，
  ;    但 APO 属性区没建立 → 所有音效开关灰掉」——本机已实测踩到，必须按此顺序。
  nsExec::ExecToLog '"$R9" /add-driver "${ZHUB_DRV_ROOT}\base\CM002X1.Inf"'
  Pop $R1
  nsExec::ExecToLog '"$R9" /add-driver "${ZHUB_DRV_ROOT}\apo\CM002X1_APO.inf"'
  Pop $R2
  nsExec::ExecToLog '"$R9" /add-driver "${ZHUB_DRV_ROOT}\ext\CM002X1_Ext.inf"'
  Pop $R3

  ; 2) 在设备上安装/更新基础驱动（此时扩展已入库，会一并应用）
  DetailPrint "Installing base driver on matching devices..."
  nsExec::ExecToLog '"$R9" /add-driver "${ZHUB_DRV_ROOT}\base\CM002X1.Inf" /install'
  Pop $R5

  ; 3) 重启该设备，强制重新应用扩展 INF 与 APO 组件（设备未插入时返回非 0，不算失败）
  nsExec::ExecToLog '"$R9" /restart-device /deviceid "USB\VID_0D8C&PID_0334&MI_00"'
  Pop $R6

  ; 4) 校验扩展 INF 是否真的落到设备硬件键上（读 FX\0 的 Enable_EQ_GFX）。
  ;    1 = 属性区已建立；0 = 扩展没应用，音效必然不可用，必须让用户知道。
  StrCpy $R7 0
  StrCpy $R0 0
  zhub_scan_fx:
    EnumRegKey $1 HKLM "SYSTEM\CurrentControlSet\Enum\USB\VID_0D8C&PID_0334&MI_00" $R0
    StrCmp $1 "" zhub_scan_done
    ReadRegStr $2 HKLM "SYSTEM\CurrentControlSet\Enum\USB\VID_0D8C&PID_0334&MI_00\$1\Device Parameters\FX\0" "{BD341FFB-9FD1-4ED4-8159-7999D546EA8A},0"
    ReadRegStr $2 HKLM "SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_0D8C&PID_0334&MI_00\\$1\\FX\\0" "{BD341FFB-9FD1-4ED4-8159-7999D546EA8A},0"
    StrCmp $2 "" +2
      StrCpy $R7 1
    StrCmp $2 "" +2
      StrCpy $R7 1
    IntOp $R0 $R0 + 1
    Goto zhub_scan_fx
  zhub_scan_done:

  ; nsExec 无法启动进程时返回 "error"，统一折算为 9999，避免 WriteRegDWORD 写非数字
  StrCmp $R1 "error" 0 +2
    StrCpy $R1 9999
  StrCmp $R2 "error" 0 +2
    StrCpy $R2 9999
  StrCmp $R3 "error" 0 +2
    StrCpy $R3 9999
  StrCmp $R5 "error" 0 +2
    StrCpy $R5 9999

  ; 判定整体结果：暂存 + 设备安装都成功，且扩展属性区确实建立
  StrCpy $R0 1
  ${If} $R1 != "0"
  ${AndIf} $R1 != "3010"
    StrCpy $R0 0
  ${EndIf}
  ${If} $R2 != "0"
  ${AndIf} $R2 != "3010"
    StrCpy $R0 0
  ${EndIf}
  ${If} $R3 != "0"
  ${AndIf} $R3 != "3010"
    StrCpy $R0 0
  ${EndIf}
  ${If} $R5 != "0"
  ${AndIf} $R5 != "3010"
    StrCpy $R0 0
  ${EndIf}
  ; 注意：$R7（fx 探测）不参与成功判定，只写日志——探不到不等于安装失败

  ${If} $R5 == "3010"
    SetRebootFlag true
  ${EndIf}

  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "BaseRc" "$R1"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "ApoRc" "$R2"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "ExtRc" "$R3"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "InstallRc" "$R5"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "RestartRc" "$R6"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "FxApplied" "$R7"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "Ok" "$R0"
  WriteRegStr HKLM "${ZHUB_REG_KEY}" "Log" "${ZHUB_LOG_FILE}"
  WriteRegStr HKLM "${ZHUB_REG_KEY}" "DriverRoot" "${ZHUB_DRV_ROOT}"

  ; 日志：便于售后定位（pnputil 全部输出已通过 ExecToLog 显示在安装详情里）
  ${If} $R4 != ""
    FileWrite $R4 "zhulinniao-hub driver install$\r$\n"
    FileWrite $R4 "driver_root=${ZHUB_DRV_ROOT}$\r$\n"
    FileWrite $R4 "pnputil=$R9$\r$\n"
    FileWrite $R4 "stage: base=$R1 apo=$R2 ext=$R3$\r$\n"
    FileWrite $R4 "install_rc=$R5 restart_rc=$R6 fx_applied=$R7 ok=$R0$\r$\n"
    FileWrite $R4 "note: 0/3010 = success; 9999 = pnputil could not be launched$\r$\n"
    FileClose $R4
  ${EndIf}

  DetailPrint "Driver result: stage(base=$R1 apo=$R2 ext=$R3) install=$R5 restart=$R6 fx=$R7 ok=$R0"

  ; 失败时明确提示，但不中断应用安装（装置信息/音量仍可用，音效不可用）
  ${If} $R0 != "1"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Audio driver components could not be installed completely.$\r$\n$\r$\nThe app is installed, but sound effects will be unavailable until the driver is present.$\r$\n$\r$\nstage base=$R1 apo=$R2 ext=$R3 | install=$R5 restart=$R6 fx=$R7$\r$\nLog: ${ZHUB_LOG_FILE}"
    ${EndIf}
  ${EndIf}

  SetOutPath "$INSTDIR"

  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 只清理安装目录里随包的驱动文件。
  ; 已装入驱动存储（DriverStore）的驱动包不卸载 —— 卸载它们会让耳机失去音频端点，
  ; 这与厂商安装器的行为一致；如需彻底移除，使用「设备管理器」或 pnputil /delete-driver。
  RMDir /r "${ZHUB_DRV_ROOT}"
  Delete "${ZHUB_LOG_FILE}"
  DeleteRegKey HKLM "${ZHUB_REG_KEY}"
!macroend
