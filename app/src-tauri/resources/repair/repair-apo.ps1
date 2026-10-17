# 竹林鸟朱雀 Hub — 音效修复（APO 强制重装）
# 用法：Repair-Audio-Effects.cmd 会以管理员身份调用本脚本。
#   参数 -Drv  驱动目录（默认：脚本同级 driver\）
#        -Log  日志文件（默认：脚本同级 driver-repair.log）
param(
    [string]$Drv = '',
    [string]$LogPath = ''
)

$ErrorActionPreference = 'Continue'
if (-not $Drv)     { $Drv     = Join-Path $PSScriptRoot 'driver' }
if (-not $LogPath) { $LogPath = Join-Path $PSScriptRoot 'driver-repair.log' }
if (Test-Path $LogPath) { Remove-Item $LogPath -Force }

$PNP = 'C:\Windows\System32\pnputil.exe'
$DEV = 'USB\VID_0D8C&PID_0334&MI_00'
$APO_CLASS = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{5989fce8-9cd0-467d-8a6a-5419e31529d4}'
$SFX_CLSID = '{22677C05-5EC6-443C-8082-8D4A1662F4A3}'

function W([string]$m) { $m | Out-File -FilePath $LogPath -Append -Encoding utf8 }

# 注意：不要把参数命名成 $args —— 那是 PowerShell 自动变量，实参会被静默吞掉。
function Run([string[]]$cmdArgs) {
    W ('>>> pnputil ' + ($cmdArgs -join ' '))
    $out = & $PNP @cmdArgs 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($out.Trim()) { W $out.Trim() }
    W "<<< exit=$code"
    return $code
}

function Test-Apo {
    $ok = $false
    Get-ChildItem $APO_CLASS -ErrorAction SilentlyContinue | ForEach-Object {
        $k = Join-Path $_.PSPath ('AudioEngine\AudioProcessingObjects\' + $SFX_CLSID)
        if (Test-Path $k) {
            $n = (Get-ItemProperty $k -ErrorAction SilentlyContinue).FriendlyName
            if ($n) { $ok = $true }
        }
    }
    return $ok
}

function Test-FxBinding {
    $root = 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses\{6994ad04-93ef-11d0-a3cc-00a0c9223196}'
    $ok = $false
    Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like '*0D8C*' } | ForEach-Object {
        Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
            $fx = Join-Path $_.PSPath 'Device Parameters\FX\0'
            if (Test-Path $fx) {
                $v = (Get-ItemProperty $fx -ErrorAction SilentlyContinue).'{D04E05A6-594B-4fb6-A80D-01AF5EED7D1D},13'
                if ($v) { $ok = $true }
            }
        }
    }
    return $ok
}

function Check([string]$tag) {
    $apo = Test-Apo
    $fx = Test-FxBinding
    W "[$tag] apo_registered=$apo fx_bound=$fx"
    return @($apo, $fx)
}

W "=== start $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
W "driver=$Drv"

if (-not (Test-Path (Join-Path $Drv 'ext\CM002X1_Ext.inf'))) {
    W "错误：找不到驱动目录 $Drv"
    exit 2
}

Check 'before' | Out-Null

# 1) 暂存三个包
Run @('/add-driver', (Join-Path $Drv 'base\CM002X1.Inf'))     | Out-Null
Run @('/add-driver', (Join-Path $Drv 'apo\CM002X1_APO.inf'))  | Out-Null
Run @('/add-driver', (Join-Path $Drv 'ext\CM002X1_Ext.inf'))  | Out-Null

# 2) 安装基础驱动
Run @('/add-driver', (Join-Path $Drv 'base\CM002X1.Inf'), '/install') | Out-Null

# 3) 清掉扩展包的“已安装”陈旧记录，再重新应用（否则 Windows 会跳过 AddReg / AddComponent）
$enum = & $PNP /enum-drivers 2>&1 | Out-String
$extOem = $null
foreach ($block in ($enum -split "(\r?\n){2,}")) {
    if ($block -match 'cm002x1_ext') {
        $m = [regex]::Match($block, 'oem\d+\.inf')
        if ($m.Success) { $extOem = $m.Value }
    }
}
if ($extOem) {
    W "扩展包：$extOem —— 卸载以清除陈旧记录"
    Run @('/delete-driver', $extOem, '/uninstall', '/force') | Out-Null
    Start-Sleep -Seconds 2
}
Run @('/add-driver', (Join-Path $Drv 'ext\CM002X1_Ext.inf'), '/install') | Out-Null

# 4) 重启设备
Run @('/restart-device', '/deviceid', $DEV) | Out-Null
Start-Sleep -Seconds 3

$r = Check 'after-apply'
if (-not $r[0]) {
    # 5) 仍无证据 → 移除设备节点并重扫，强制走完整安装（AddComponent 才会创建组件）
    W '--- 强制整设备重装（remove-device + scan-devices）---'
    Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -like 'USB\VID_0D8C&PID_0334&MI_00*' } |
        ForEach-Object {
            W "removing $($_.InstanceId)"
            Run @('/remove-device', $_.InstanceId) | Out-Null
        }
    Start-Sleep -Seconds 2
    Run @('/scan-devices') | Out-Null
    Start-Sleep -Seconds 8
    $r = Check 'after-rescan'
}

if ($r[0]) {
    W '结果：APO 已注册，音效可用。请关闭并重新打开「竹林鸟朱雀 Hub」。'
} else {
    W '结果：APO 仍未注册。请确认耳机已插好；必要时重启电脑后再运行一次本脚本。'
}
W "=== done $(Get-Date -Format 'HH:mm:ss') ==="
