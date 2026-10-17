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

  ; 修复工具（修复音效.cmd + repair-apo.ps1）由 tauri.conf.json 的 resources 直接落到安装根目录，
  ; 这里不再复制 —— 本文件是无 BOM 的 UTF-8，中文字面量会被 makensis 当 ANSI 解析成乱码。

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

  ; 2b) **把扩展 INF 真正应用到设备**（2026-10-17 事故教训，不可省）。
  ;     只 stage 不 /install 时，扩展的 AddReg（FX\0 的 CompositeFX CLSID 绑定）与
  ;     AddComponent（创建 SWC\CM002X1&CMEDIA&CMAPO_ICE 组件 → 注册 APO 的 5 个 CLSID）
  ;     都不会执行。此时应用仍能读写 FxProperties（User 区由属性存储 API 按需创建），
  ;     表现为「开关能打开、参数能写、但听不出任何变化」——因为根本没有 APO 在消费。
  ;     设备上若已是同版本基础驱动，base /install 不会重装设备，扩展也就不会被重新应用，
  ;     所以必须显式对扩展 INF 执行 /install（Win10 2004+ 支持）。
  DetailPrint "Applying extension INF to matching devices (APO registration)..."
  nsExec::ExecToLog '"$R9" /add-driver "${ZHUB_DRV_ROOT}\ext\CM002X1_Ext.inf" /install'
  Pop $R8

  ; 3) 重启该设备，强制重新应用扩展 INF 与 APO 组件（设备未插入时返回非 0，不算失败）
  nsExec::ExecToLog '"$R9" /restart-device /deviceid "USB\VID_0D8C&PID_0334&MI_00"'
  Pop $R6

  ; 4) 校验 APO 是否真的注册 —— 唯一可信的判据。
  ;    APO 组件 INF 的 Apo_AddReg 会写 HKR\AudioEngine\AudioProcessingObjects\{CLSID}，
  ;    而 SWD 软件组件设备的 HKR 映射到「设备类键」Control\Class\{5989fce8-...}\NNNN，
  ;    不是 Enum\SWC、也不是端点的 Device Parameters\FX（2026-10-17 实测踩坑，勿改回）。
  ;    有 C-Media 的 SFX CLSID 的 FriendlyName 即代表 APO 已安装并注册。
  StrCpy $R7 0
  StrCpy $R0 0
  zhub_scan_apo:
    EnumRegKey $1 HKLM "SYSTEM\CurrentControlSet\Control\Class\{5989fce8-9cd0-467d-8a6a-5419e31529d4}" $R0
    StrCmp $1 "" zhub_scan_apo_done
    ReadRegStr $2 HKLM "SYSTEM\CurrentControlSet\Control\Class\{5989fce8-9cd0-467d-8a6a-5419e31529d4}\$1\AudioEngine\AudioProcessingObjects\{22677C05-5EC6-443C-8082-8D4A1662F4A3}" "FriendlyName"
    StrCmp $2 "" +2
      StrCpy $R7 1
    IntOp $R0 $R0 + 1
    Goto zhub_scan_apo
  zhub_scan_apo_done:

  ; 4b) 证据缺失 → 清掉设备的陈旧安装记录后强制重装一次。
  ;     旧版原厂驱动卸载后，SetupAPI 仍记着「扩展已安装」，pnputil 会返回 0 但什么都不做；
  ;     只有把设备节点移除再重扫，Windows 才会重新走一遍安装（AddReg + AddComponent）。
  ${If} $R7 != "1"
    StrCpy $1 ""
    EnumRegKey $1 HKLM "SYSTEM\CurrentControlSet\Enum\USB\VID_0D8C&PID_0334&MI_00" 0
    ${If} $1 != ""
      DetailPrint "APO not registered yet; forcing device reinstall..."
      nsExec::ExecToLog '"$R9" /remove-device "USB\VID_0D8C&PID_0334&MI_00\$1"'
      Sleep 2000
      nsExec::ExecToLog '"$R9" /scan-devices'
      Sleep 8000
      StrCpy $R7 0
      StrCpy $R0 0
      zhub_scan_apo2:
        EnumRegKey $1 HKLM "SYSTEM\CurrentControlSet\Control\Class\{5989fce8-9cd0-467d-8a6a-5419e31529d4}" $R0
        StrCmp $1 "" zhub_scan_apo2_done
        ReadRegStr $2 HKLM "SYSTEM\CurrentControlSet\Control\Class\{5989fce8-9cd0-467d-8a6a-5419e31529d4}\$1\AudioEngine\AudioProcessingObjects\{22677C05-5EC6-443C-8082-8D4A1662F4A3}" "FriendlyName"
        StrCmp $2 "" +2
          StrCpy $R7 1
        IntOp $R0 $R0 + 1
        Goto zhub_scan_apo2
      zhub_scan_apo2_done:
    ${EndIf}
  ${EndIf}

  ; nsExec 无法启动进程时返回 "error"，统一折算为 9999，避免 WriteRegDWORD 写非数字
  StrCmp $R1 "error" 0 +2
    StrCpy $R1 9999
  StrCmp $R2 "error" 0 +2
    StrCpy $R2 9999
  StrCmp $R3 "error" 0 +2
    StrCpy $R3 9999
  StrCmp $R5 "error" 0 +2
    StrCpy $R5 9999
  StrCmp $R8 "error" 0 +2
    StrCpy $R8 9999

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
  ; 扩展必须真正生效（否则 APO 不注册 → 音效全是"哑开关"）。
  ; ⚠️ 不能看 pnputil 返回码：实测它在「设备无需更新」时返回 0，却一个动作都不执行。
  ; 只认证据：$R7 = 1（APO 已注册，见第 4 步）。
  ${If} $R7 != "1"
    StrCpy $R0 0
  ${EndIf}

  ${If} $R5 == "3010"
    SetRebootFlag true
  ${EndIf}

  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "BaseRc" "$R1"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "ApoRc" "$R2"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "ExtRc" "$R3"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "InstallRc" "$R5"
  WriteRegDWORD HKLM "${ZHUB_REG_KEY}" "ExtApplyRc" "$R8"
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
    FileWrite $R4 "install_rc=$R5 ext_apply_rc=$R8 restart_rc=$R6$\r$\n"
    FileWrite $R4 "apo_registered=$R7 apo_name=[$2] ok=$R0$\r$\n"
    FileWrite $R4 "note: 0/3010 = success; 9999 = pnputil could not be launched$\r$\n"
    FileClose $R4
  ${EndIf}

  DetailPrint "Driver result: stage(base=$R1 apo=$R2 ext=$R3) install=$R5 ext_apply=$R8 restart=$R6 apo_registered=$R7 ok=$R0"

  ; 失败时明确提示，但不中断应用安装（装置信息/音量仍可用，音效不可用）
  ${If} $R0 != "1"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Audio driver components could not be installed completely.$\r$\n$\r$\nThe app is installed, but sound effects will be unavailable until the driver is present.$\r$\nIf the headphones were unplugged, plug them in and run this installer again.$\r$\n$\r$\nstage base=$R1 apo=$R2 ext=$R3$\r$\ninstall=$R5 ext_apply=$R8 restart=$R6$\r$\napo_registered=$R7$\r$\nLog: ${ZHUB_LOG_FILE}"
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
  Delete "$INSTDIR\driver-repair.log"
  Delete "$INSTDIR\Repair-Audio-Effects.cmd"
  Delete "$INSTDIR\repair-apo.ps1"
  DeleteRegKey HKLM "${ZHUB_REG_KEY}"
!macroend
