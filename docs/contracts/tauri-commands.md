# Tauri Command 契约清单（CM002X1 耳机 Hub）

> 本项目为 Tauri v2 桌面本地应用，**无 HTTP 服务端**。前后端边界 = Tauri command（`#[tauri::command]`）+ Tauri events。本文档为唯一契约，前端据此生成 TS 类型 / MSW Mock，Rust 后端据此实现。

## 0. 通用约定

- 命令命名：`snake_case`（Rust 侧），前端 invoke 使用同名（Tauri 默认 camelCase 转换禁用则显式配置，见下）。
- 统一响应封套（所有 command 返回同一结构）：

```ts
interface CommandResult<T> {
  code: number;      // 0=成功，非 0=错误码（见 §4）
  data: T | null;    // 成功时的业务数据
  message: string;   // 失败时的人类可读描述（成功为空字符串）
  channel?: 'tier1-sidecar' | 'tier2-rust'; // 实际命中的通信通道（控制类命令返回）
}
```

- 时间：所有时间为 Unix 毫秒（number）。
- 设备标识：`deviceId` 为运行时枚举得到的稳定键（VID+PID+路径哈希，见 ADR-004），非硬编码 PID。
- 事件（`listen`）：后端 → 前端单向推送，命名 `hub://<domain>/<event>`。

---

## 1. 设备（Device）

| 命令 | 入参 (TS) | 返回 | 通道 | 说明 |
|------|-----------|------|------|------|
| `scan_devices` | - | `DeviceSummary[]` | Tier2 枚举 | 枚举 VID 白名单内设备，PID 家族运行时匹配（ADR-004） |
| `get_connection_state` | - | `ConnectionState` | - | 当前连接与扫描状态 |
| `connect_device` | `{ deviceId: string }` | `DeviceInfo` | Tier1 优先/Tier2 回落 | 建立控制会话 |
| `disconnect_device` | - | `void` | - | 释放 HID 句柄与 sidecar 会话 |
| `get_device_info` | `{ deviceId: string }` | `DeviceInfo` | Tier1 优先/Tier2 回落 | 型号/固件/电量/VID/PID |
| `list_audio_endpoints` | - | `AudioEndpoint[]` | Tier2 | APO 通道关联的音频端点 |

```ts
type DeviceChannel = 'apo' | 'hid' | 'composite';

interface DeviceSummary {
  deviceId: string;
  vendorId: string;      // 十六进制，如 "0D8C"
  productId: string;     // 十六进制，如 "0334"
  family: 'CM002X1';
  channels: DeviceChannel[];
  productName: string;
}

interface DeviceInfo extends DeviceSummary {
  firmwareVersion: string | null;
  serial: string | null;
  batteryPercent: number | null;      // 无电池返回 null
  headTrackingSupported: boolean;
  connectedAt: number;
}

interface ConnectionState {
  scanning: boolean;
  connectedDeviceId: string | null;
  lastError: AppError | null;
}

interface AudioEndpoint {
  endpointId: string;
  friendlyName: string;
  dataFlow: 'render' | 'capture';
  apoContextAvailable: boolean;
}
```

---

## 2. 音频效果（APO PropertyStore 通道）

> EQ / 空间音频 / 降噪均走 Windows APO PropertyStore（ADR-002）。Tier1 sidecar 优先。

### 2.1 EQ

| 命令 | 入参 (TS) | 返回 | 通道 |
|------|-----------|------|------|
| `eq_read` | `{ deviceId: string }` | `EqState` | Tier1 |
| `eq_write` | `{ deviceId: string; state: EqState }` | `EqState` | Tier1 |
| `eq_select_preset` | `{ deviceId: string; presetIndex: number }` | `EqState` | Tier1 |
| `eq_list_presets` | - | `EqPreset[]` | 本地配置 |

```ts
interface EqBand { gain: number; frequency: number; q: number; filterType: number; }
interface EqState {
  enabled: boolean;
  presetIndex: number;
  bands: EqBand[];      // 固定 10 段
}
interface EqPreset { index: number; values: number[]; }  // 映射 EQPreset.json
```

### 2.2 空间音频 / 头动

| 命令 | 入参 (TS) | 返回 | 通道 |
|------|-----------|------|------|
| `spatial_get` | `{ deviceId: string }` | `SpatialState` | Tier1 |
| `spatial_write` | `{ deviceId: string; state: SpatialState }` | `SpatialState` | Tier1 |

```ts
interface SpatialState {
  surroundHeadphone: { enabled: boolean; mode: number; room: number };
  speakerShifter: { enabled: boolean };
  headTracking: { enabled: boolean; reverb: number };
  surroundMax: boolean;
}
```

### 2.3 降噪 / 麦克风

| 命令 | 入参 (TS) | 返回 | 通道 |
|------|-----------|------|------|
| `noise_get` | `{ deviceId: string }` | `NoiseState` | Tier1 |
| `noise_write` | `{ deviceId: string; state: NoiseState }` | `NoiseState` | Tier1 |

```ts
interface NoiseState {
  aiNoiseReduction: { enabled: boolean; level: number };
  micNoiseReduction: { enabled: boolean; level: number };
  voiceClarity: { enabled: boolean; level: number; nsLevel: number };
}
```

---

## 3. 设备控制（HID 通道）

> LED / 设备级控制 / 固件信息走 USB HID 报告（ADR-002）。

### 3.1 LED

| 命令 | 入参 (TS) | 返回 | 通道 |
|------|-----------|------|------|
| `led_read` | `{ deviceId: string }` | `LedState` | Tier1 优先/Tier2 |
| `led_write` | `{ deviceId: string; state: LedState }` | `LedState` | Tier1 优先/Tier2 |
| `led_set_enabled` | `{ deviceId: string; enabled: boolean }` | `LedState` | Tier1/Tier2 |
| `led_set_mode` | `{ deviceId: string; mode: number }` | `LedState` | Tier1/Tier2 |
| `led_set_color` | `{ deviceId: string; color: string }` | `LedState` | Tier1/Tier2 |

```ts
interface LedState {
  enabled: boolean;
  mode: number;        // 0=静态 1=呼吸 ...（映射 LEDDefaultConfig.Mode）
  dwellTime: number;   // ms
  color: string;       // #RRGGBB（禁止硬编码，来自配置/用户选择）
}
```

### 3.2 设备级控制 / 固件

| 命令 | 入参 (TS) | 返回 | 通道 |
|------|-----------|------|------|
| `device_set_control` | `{ deviceId: string; key: string; value: number }` | `void` | Tier1/Tier2 |
| `firmware_get_info` | `{ deviceId: string }` | `FirmwareInfo` | Tier1/Tier2 |

```ts
interface FirmwareInfo { version: string; vid: string; pid: string; }
```

---

## 4. 配置档（Profiles）

| 命令 | 入参 (TS) | 返回 | 说明 |
|------|-----------|------|------|
| `profiles_list` | - | `ProfileSummary[]` | 列出本地 profile |
| `profile_read` | `{ id: string }` | `Profile` | 读取单个 profile |
| `profile_write` | `{ profile: Profile }` | `Profile` | 创建/覆盖（幂等，带 schemaVersion） |
| `profile_delete` | `{ id: string }` | `void` | 删除 |
| `profile_apply` | `{ deviceId: string; id: string }` | `Profile` | 将 profile 下发到设备 |
| `legacy_config_import` | `{ sourceDir: string }` | `ImportReport` | 导入原版 Configs/*.json（ADR-005） |

```ts
interface Profile {
  id: string;
  schemaVersion: number;
  name: string;
  source: 'user' | 'legacy-import';
  migratedAt: number | null;
  eq: EqState | null;
  spatial: SpatialState | null;
  noise: NoiseState | null;
  led: LedState | null;
  gameOverrides: GameOverride[] | null;
}
interface GameOverride { name: string; explosion: number; selfStep: number; extStep: number; ambient: number; }
interface ProfileSummary { id: string; name: string; source: string; updatedAt: number; }
interface ImportReport { imported: string[]; skipped: string[]; failed: { file: string; reason: string }[]; }
```

---

## 5. 错误码（code）

| code | 名称 | 说明 |
|------|------|------|
| 0 | OK | 成功 |
| 1001 | DEVICE_NOT_FOUND | 未枚举到匹配设备 |
| 1002 | DEVICE_DISCONNECTED | 设备已断开 |
| 1003 | AMBIGUOUS_DEVICE | 同 VID/PID 多设备无法唯一定位 |
| 1004 | PID_NOT_IN_FAMILY | PID 不在已知家族（ADR-004） |
| 2001 | TIER1_UNAVAILABLE | sidecar 未启动/授权未确认 |
| 2002 | TIER1_CALL_FAILED | 厂商 DLL 调用失败 |
| 2003 | TIER2_HID_OPEN_FAILED | HID 句柄打开失败 |
| 2004 | TIER2_REPORT_PARSE_FAILED | 报告描述符解析失败 |
| 3001 | APO_ENDPOINT_NOT_FOUND | 音频端点缺失，无法写 PropertyStore |
| 3002 | APO_WRITE_DENIED | PropertyStore 写入被拒（权限/签名） |
| 4001 | CONFIG_VALIDATION_FAILED | 配置未通过 JSON Schema 校验 |
| 4002 | CONFIG_SCHEMA_MIGRATION_FAILED | 旧配置迁移失败 |
| 5001 | SIDECAR_CRASHED | sidecar 异常退出（已尝试重启） |
| 9000 | INTERNAL_ERROR | 未预期内部错误 |

---

## 6. 事件清单

| 事件名 | payload | 说明 |
|--------|---------|------|
| `hub://device/connected` | `DeviceInfo` | 设备接入 |
| `hub://device/disconnected` | `{ deviceId: string }` | 设备拔出 |
| `hub://device/changed` | `DeviceInfo` | 设备信息变化（电量等） |
| `hub://tier/status` | `{ tier1: 'up'\|'down'; tier2: 'up'\|'down' }` | 通道健康 |
| `hub://firmware/progress` | `{ percent: number }` | 固件进度（如实现） |
| `hub://window/close-requested` | `null` | 用户点了窗口 ×，且策略为「每次询问」 |

---

## 7. 前后端约定

- 前端 `src/lib/api/` 封装所有 invoke，统一处理 `CommandResult` 封套与错误码 → 用户可读提示。
- MSW Mock 依据本契约 + `docs/schemas/*.schema.json` 生成，覆盖 code=0 与至少 2001/3001/4001 三个错误分支。
- 契约变更流程：修改本文件 → 通过 team-lead 同步前后端 → 更新 TS 类型。

---

## 8. 窗口行为（点 × 的最小化/关闭）

实现：`src-tauri/src/window.rs`（拦截 `WindowEvent::CloseRequested`）。

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `window_set_close_action` | `{ action: 'ask' \| 'minimize' \| 'exit' }` | `void` | 同步当前策略到后端运行时状态；前端在设置加载完成与变更时各调用一次 |
| `window_action` | `{ action: 'minimize' \| 'exit' \| 'cancel' }` | `void` | 执行关闭询问弹窗的选择：`minimize` 隐藏窗口并在托盘创建图标，`exit` 退出进程，`cancel` 仅关闭弹窗 |

策略语义：

- `ask`：拦截关闭 → 恢复并聚焦窗口 → 发 `hub://window/close-requested` → 前端弹询问窗。
- `minimize`：拦截关闭 → 隐藏主窗口 + **惰性**创建托盘图标（左键单击或菜单「打开主界面」恢复；恢复后立即移除托盘图标）。
- `exit`：不拦截，交给 Tauri 正常退出。

持久化键：`settings.json` 的 `closeAction`（与设置页「关闭窗口时」同一个键）。

已知限制：无单实例保护——隐藏到托盘后再次启动会开第二个实例（见待办）。

