/**
 * Tauri 桥接层 — 前端与桌面壳的唯一通道。
 * 浏览器预览环境不加载（DeviceContext 已按 isTauri() 分流）。
 *
 * 命令契约严格对应后端 generate_handler!：
 *   get_connection_state / get_device_info / scan_devices
 *   get_autostart / set_autostart / settings_load / settings_save
 *   audio_get_state / audio_set_volume / audio_set_mute / audio_set_balance
 *   device_details / audio_endpoint_list / audio_set_default
 *   apo_eq_read / apo_eq_write / apo_fields_read / apo_field_write
 *   relaunch_elevated
 *
 * ⚠️ 已随后端重构移除：apo_effect_* / apo_aux_*（旧的多效果键通道，
 *    其上下文归属有误；现统一走 apo_fields_read / apo_field_write）。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** 后端用 i32::MIN 表示该键在设备上不存在（界面须显示「未提供」，不得假装可写） */
export const UNAVAILABLE = -2147483648;

export function isAvail(v: number | undefined): boolean {
  return typeof v === 'number' && v > UNAVAILABLE;
}

// ---------- 连接 / 设备 ----------

export interface ConnectionState {
  connected: boolean;
  name?: string;
  source: 'hid' | 'stub';
}

export function tauriGetConnectionState(): Promise<ConnectionState> {
  return invoke<ConnectionState>('get_connection_state');
}

export interface DeviceFullInfo {
  connected: boolean;
  name: string | null;
  vid: number | null;
  pid: number | null;
  serial: string | null;
  interfaces: number;
}

export function tauriGetDeviceInfo(): Promise<DeviceFullInfo> {
  return invoke<DeviceFullInfo>('get_device_info');
}

export async function onDevicePlugEvents(
  cb: (connected: boolean) => void,
): Promise<() => void> {
  const unConnected = await listen('hub://device/connected', () => cb(true));
  const unDisconnected = await listen('hub://device/disconnected', () => cb(false));
  return () => {
    void unConnected();
    void unDisconnected();
  };
}

export function tauriScanDevices(): Promise<{ vid: number; pid: number; name: string }[]> {
  return invoke<{ vid: number; pid: number; name: string }[]>('scan_devices');
}

// ---------- 装置设置及信息（真实读取：Core Audio + 系统设备注册表） ----------

export interface DeviceDetailsDto {
  /** 装置名称（Core Audio 端点友善名） */
  name: string;
  /** 硬件驱动版本（如 11.1.3.2） */
  driver_version: string;
  driver_desc: string;
  provider: string;
  /** 固件版本（原版 = USBRevisionNumber，取自硬件 ID 的 REV_xxxx） */
  firmware_version: string;
  instance_id: string;
  /** 装置格式（IAudioClient::GetMixFormat 真实读取） */
  sample_rate: number;
  bits_per_sample: number;
  channels: number;
  is_default: boolean;
  is_default_communication: boolean;
}

export function tauriDeviceDetails(): Promise<DeviceDetailsDto> {
  return invoke<DeviceDetailsDto>('device_details');
}

/** 音频装置列表：[端点ID, 名称][] */
export function tauriEndpointList(capture: boolean): Promise<[string, string][]> {
  return invoke<[string, string][]>('audio_endpoint_list', { capture });
}

/** 设为默认装置（communication=false→默认装置；true→默认通讯装置） */
export function tauriSetDefault(communication: boolean): Promise<void> {
  return invoke<void>('audio_set_default', { communication });
}

// ---------- 开机自启动 ----------

export function tauriGetAutostart(): Promise<boolean> {
  return invoke<boolean>('get_autostart');
}

export function tauriSetAutostart(enabled: boolean): Promise<boolean> {
  return invoke<boolean>('set_autostart', { enabled });
}

// ---------- 音量 / 静音 / 左右平衡（Windows Core Audio，真实作用于耳机端点） ----------

export interface AudioStateFull {
  /** 0.0 – 1.0 */
  volume: number;
  muted: boolean;
  device_name: string;
  /** 左声道 0.0 – 1.0（对应原版卡片「左」百分比） */
  left: number;
  /** 右声道 0.0 – 1.0（对应原版卡片「右」百分比） */
  right: number;
  /** 端点声道数（<2 时界面不显示平衡） */
  channels: number;
}

export function tauriGetAudioState(capture: boolean): Promise<AudioStateFull> {
  return invoke<AudioStateFull>('audio_get_state', { capture });
}

export function tauriSetAudioVolume(capture: boolean, volume: number): Promise<void> {
  return invoke<void>('audio_set_volume', { capture, volume });
}

export function tauriSetAudioMute(capture: boolean, muted: boolean): Promise<void> {
  return invoke<void>('audio_set_mute', { capture, muted });
}

/** 左右声道音量（0.0–1.0），对应原版「平衡」滑杆两端的 左 / 右 */
export function tauriSetAudioBalance(capture: boolean, left: number, right: number): Promise<void> {
  return invoke<void>('audio_set_balance', { capture, left, right });
}

// ---------- EQ（原版 APO 属性区，真实读写耳机 10 段均衡） ----------

export interface EqSnapshot {
  enabled: boolean;
  sliders: number[]; // 10 段增益（-20..20）
  freqs: number[]; // 10 段频点 Hz
  qs: number[]; // 10 段 Q×100
  filters: number[]; // 10 段滤波类型 0..5
  store_path: string;
}

export function tauriEqRead(): Promise<EqSnapshot> {
  return invoke<EqSnapshot>('apo_eq_read');
}

/** 传 null 表示「不改该项」；返回值以真机回读为准 */
export function tauriEqWrite(
  enabled: boolean | null,
  sliders: number[] | null,
  filters: number[] | null = null,
  freqs: number[] | null = null,
  qs: number[] | null = null,
): Promise<EqSnapshot> {
  return invoke<EqSnapshot>('apo_eq_write', { enabled, sliders, filters, freqs, qs });
}

// ---------- 其余 8 项效果的字段读写（字段名 = 后端 FIELD_SPECS 的键） ----------

/** 后端 apo_fields_read 返回 [字段名, 值][]；缺失键值为 i32::MIN */
export type FieldMap = Record<string, number>;

export async function tauriFieldsRead(): Promise<FieldMap> {
  const list = await invoke<[string, number][]>('apo_fields_read');
  const map: FieldMap = {};
  for (const [k, v] of list) map[k] = v;
  return map;
}

export async function tauriFieldWrite(field: string, value: number): Promise<FieldMap> {
  const list = await invoke<[string, number][]>('apo_field_write', { field, value });
  const map: FieldMap = {};
  for (const [k, v] of list) map[k] = v;
  return map;
}

/** 以管理员身份重启（写 HKLM 属性区受阻时的兜底入口） */
export function tauriRelaunchElevated(): Promise<void> {
  return invoke<void>('relaunch_elevated');
}

// ---------- 本地设置持久化（appConfigDir/settings.json） ----------

export function tauriSettingsLoad(): Promise<string> {
  return invoke<string>('settings_load');
}

export function tauriSettingsSave(json: string): Promise<void> {
  return invoke<void>('settings_save', { json });
}

/**
 * 统一错误文案：Tauri 的 Err(String) 以字符串形式 reject，
 * 直接读 .message 会得到 undefined（曾导致界面显示“写入失败：undefined”）。
 */
export function errText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
