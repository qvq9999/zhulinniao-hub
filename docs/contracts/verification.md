# 真机验证步骤（VID/PID 枚举 + HID 报告描述符抓取）

> 用于 Spec 的端到端验证素材。以下命令在 Windows 10/11 上执行，优先使用免安装的系统自带工具；第三方工具注明来源用途。

## 1. 枚举 USB 设备（确认 VID/PID 家族命中）

### 1.1 PowerShell（无需安装）

```powershell
# 列出所有 USB 设备的 VID/PID，过滤 C-Media 白名单
Get-PnpDevice -PresentOnly |
  Where-Object { $_.InstanceId -match 'VID_0D8C|VID_4C4A|VID_20F8|VID_0E6A|VID_046A' } |
  Select-Object Status, Class, FriendlyName, InstanceId |
  Format-Table -AutoSize
```

预期：应至少命中一个 `USB\VID_...&PID_...&MI_00`，PID 落在家族集合 `{0334,4255,A962,A963,A964,0110,01ED}` 内。

### 1.2 关联音频端点（APO 通道）

```powershell
# 查看音频渲染/采集端点，确认与设备家族关联
Get-PnpDevice -Class AudioEndpoint -PresentOnly |
  Select-Object FriendlyName, InstanceId | Format-Table -AutoSize
```

### 1.3 APO PropertyStore 上下文是否落地（验证 Tier1 前置）

```powershell
# 查看 C-Media APO 组件是否注册（对应 CMExt_Install.Components）
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'FX' } | Select-Object -First 20 Name
```

> 说明：APO 效果键位于 `...\FX\{0|1}\<CAPX*_PROPERTYSTORE_CONTEXT>\User`，上下文 GUID 见 `CM002X1_Ext.inf`（SFX/MFX/EFX 三个 context）。若上下文不存在，说明 APO 未安装，Tier1 的 EQ/空间音频无法生效。

## 2. 抓取 HID 报告描述符（Tier2 关键输入）

### 2.1 枚举 HID 设备

```powershell
Get-PnpDevice -Class HIDClass -PresentOnly |
  Where-Object { $_.InstanceId -match 'VID_0D8C|VID_4C4A|VID_20F8|VID_0E6A|VID_046A' } |
  Select-Object FriendlyName, InstanceId | Format-Table -AutoSize
```

### 2.2 使用 HIDAPI 工具抓取报告描述符（推荐）

选项 A —— `hidapitester`（Microsoft/HIDAPI 官方示例工具）：

```bat
hidapitester --vidpid 0D8C:0334 --list
hidapitester --vidpid 0D8C:0334 --open --get-report-descriptor
```

- 将 `VID:PID` 换成 §1.1 实际枚举到的值。
- `--get-report-descriptor` 输出原始报告描述符字节，供 Rust 侧 `HidP_*` 解析比对（Input/Output/Feature report 长度与 Report ID）。

选项 B —— Python（hidapi 绑定，快速验证）：

```python
# pip install hidapi
import hid
for d in hid.enumerate():
    if d['vendor_id'] in (0x0D8C, 0x4C4A, 0x20F8, 0x0E6A, 0x046A):
        print(hex(d['vendor_id']), hex(d['product_id']), d['manufacturer_string'], d['product_string'], d['path'])
```

### 2.3 抓取一次读写交互（LED 控制验证）

```python
# 需在确认真实 report 长度后进行；此处为占位流程，长度以 §2.2 描述符为准
import hid
dev = hid.device()
dev.open(0x0D8C, 0x0334)  # 换成实测 VID/PID
report = [0x00] * 65       # 首字节为 Report ID；长度以描述符为准
dev.write(report)
print(dev.read(64))
dev.close()
```

> 注意：写入前必须先依赖 §2.2 的描述符确定 Output Report 长度与 Report ID，禁止猜测；对设备的写操作仅用于验证，不得下发未定义指令。

### 2.4 电量/头动子设备（HeadTracking.json: FWVid=0D8C, FWPid=0337）

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_0D8C&PID_0337' } |
  Select-Object FriendlyName, InstanceId
```

> `0337` 属固件/头动子设备 PID，与主控家族区分处理（ADR-004 Consequences）。

## 3. 厂商 DLL 符号反查（Tier1 前置校验，强制）

对 `CmXearSDK.dll` / `CmHidra.dll` / `CmDevite.dll` 等在接入前必须反查导出符号：

```powershell
# 方式一：dumpbin（VS 开发人员命令行）
dumpbin /exports "E:\ZHUAUDIO HUB (CM002X1)\UI\CmXearSDK.dll"
dumpbin /exports "E:\ZHUAUDIO HUB (CM002X1)\UI\CmHidra.dll"

# 方式二：PowerShell 读取 PE 导出表
Get-Command dumpbin -ErrorAction SilentlyContinue
```

验收标准：能列出稳定导出符号 → 记录到 ADR-002 的 Tier1 前置校验项；同时确认厂商再分发授权。二者未齐备，Tier1 标记 BLOCKED。

## 4. 验证清单（端到端）

- [ ] VID/PID 枚举命中家族（§1.1）
- [ ] 音频端点与设备关联（§1.2）
- [ ] APO 上下文存在（§1.3）—— 决定 EQ/空间音频是否可用
- [ ] HID 报告描述符抓取成功（§2.2）—— 决定 Tier2 可行性
- [ ] 厂商 DLL 符号反查 + 授权确认（§3）—— 决定 Tier1 可行性
- [ ] 依据抓取结果回填 `docs/contracts/tauri-commands.md` 的报告长度/Report ID 常量
