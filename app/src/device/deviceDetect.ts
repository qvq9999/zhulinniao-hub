/**
 * 设备检测后端 — 双后端设计（唯一事实源，供 DeviceContext 消费）：
 * 1) Tauri 后端（正式版）：invoke('get_connection_state') + hub://device/* 事件。
 * 2) 浏览器后端（当前预览）：Web Audio enumerateDevices() 真实枚举系统音频端点，
 *    按设备名匹配朱雀 CM002X1 / C-Media；监听 devicechange + 定时轮询，
 *    插入即检出、拔出即失联 —— 状态与系统真实设备同步，不做任何假定。
 */

export type ConnStatus = 'scanning' | 'connected' | 'not_found';

export interface DetectedDevice {
  /** 系统报告的设备名（输出或输入端点） */
  name: string;
  hasOutput: boolean;
  hasInput: boolean;
}

/** 朱雀 CM002X1 在 Windows 端点中的常见命名（C-Media 方案） */
const DEVICE_PATTERN = /cm002x1|c[- ]?media|zhuaudio|竹林鸟|朱雀/i;

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function matchDevice(label: string): boolean {
  return DEVICE_PATTERN.test(label);
}

/** 请求一次麦克风权限，换取可读的设备标签（枚举结果默认可能隐藏 label）。 */
async function ensureLabelsReadable(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false; // 用户拒绝权限：标签不可读，本次按未找到处理并提示
  }
}

/** 浏览器后端：真实枚举音频端点，返回朱雀设备或 null。 */
export async function browserDetect(): Promise<DetectedDevice | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  let devices = await navigator.mediaDevices.enumerateDevices();
  // 标签被浏览器隐藏（未授权）→ 先请求一次权限再枚举
  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);
  if (labelsHidden) {
    await ensureLabelsReadable();
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  let found: DetectedDevice | null = null;
  for (const d of devices) {
    if (!matchDevice(d.label)) continue;
    if (!found) found = { name: d.label.replace(/\s*\([^)]*deviceId[^)]*\)/i, '').trim(), hasOutput: false, hasInput: false };
    if (d.kind === 'audiooutput') found.hasOutput = true;
    if (d.kind === 'audioinput') found.hasInput = true;
  }
  return found;
}

/** 浏览器后端监听：devicechange + 3s 轮询（枚举无推送，轮询保证拔出及时感知）。 */
export function watchBrowserDevice(onChange: () => void): () => void {
  const handler = () => onChange();
  navigator.mediaDevices?.addEventListener('devicechange', handler);
  const timer = window.setInterval(handler, 3000);
  return () => {
    navigator.mediaDevices?.removeEventListener('devicechange', handler);
    window.clearInterval(timer);
  };
}

/** Tauri 后端：invoke + 事件订阅（桥接层见 tauriBridge.ts，契约见 docs/contracts/tauri-commands.md）。
 *  带 4s 超时防御：命令层已读缓存瞬时返回，此处兜底防止任何异常挂起界面。 */
export async function tauriDetect(): Promise<DetectedDevice | null> {
  const { tauriGetConnectionState } = await import('./tauriBridge');
  const res = await Promise.race([
    tauriGetConnectionState(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('detect timeout')), 4000)),
  ]);
  return res.connected
    ? { name: res.name ?? '朱雀耳机', hasOutput: true, hasInput: true }
    : null;
}

/** Tauri 后端事件订阅：返回取消函数；桥接失败返回 null（由调用方回落轮询）。 */
export async function tauriWatchDevice(
  onChange: () => void,
): Promise<(() => void) | null> {
  try {
    const { onDevicePlugEvents } = await import('./tauriBridge');
    return await onDevicePlugEvents(onChange);
  } catch {
    return null;
  }
}
