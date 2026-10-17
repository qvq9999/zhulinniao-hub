import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  browserDetect,
  isTauri,
  tauriDetect,
  tauriWatchDevice,
  watchBrowserDevice,
  type ConnStatus,
  type DetectedDevice,
} from './deviceDetect';

/** 设备详细信息（真实硬件数据；字段为空表示该通道尚未接入） */
export interface DeviceInfoFull {
  name: string | null;
  vid: number | null;
  pid: number | null;
  serial: string | null;
  interfaces: number;
}

interface DeviceState {
  status: ConnStatus;
  device: DetectedDevice | null;
  info: DeviceInfoFull | null;
  /** 重新扫描（连接页「重新检测」按钮） */
  rescan: () => void;
}

const DeviceContext = createContext<DeviceState | null>(null);

const EMPTY_INFO: DeviceInfoFull = { name: null, vid: null, pid: null, serial: null, interfaces: 0 };

/**
 * 连接状态唯一事实源（**仅真实检测，无演示模式**）：
 * - 挂载即扫描；浏览器端监听 devicechange + 3s 轮询，Tauri 端走事件推送；
 * - 耳机插入 → connected，拔出 → not_found，界面始终与系统真实状态一致；
 * - 已连接时进一步取真实设备详情（型号 / VID:PID / 序列号）供界面展示。
 */
export function DeviceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnStatus>('scanning');
  const [device, setDevice] = useState<DetectedDevice | null>(null);
  const [info, setInfo] = useState<DeviceInfoFull | null>(null);
  const genRef = useRef(0);

  const runScan = useCallback(async () => {
    const gen = ++genRef.current;
    let found: DetectedDevice | null = null;
    try {
      found = isTauri() ? await tauriDetect() : await browserDetect();
    } catch {
      found = null; // 枚举失败等同未找到，交由用户重试
    }
    if (gen !== genRef.current) return; // 已被更新的扫描取代
    setDevice(found);
    setStatus(found ? 'connected' : 'not_found');

    if (found && isTauri()) {
      try {
        const { tauriGetDeviceInfo } = await import('./tauriBridge');
        const d = await tauriGetDeviceInfo();
        if (gen === genRef.current) {
          setInfo({
            name: d.name,
            vid: d.vid,
            pid: d.pid,
            serial: d.serial,
            interfaces: d.interfaces,
          });
        }
      } catch {
        if (gen === genRef.current) setInfo(EMPTY_INFO);
      }
    } else {
      setInfo(found ? { ...EMPTY_INFO, name: found.name } : null);
    }
  }, []);

  const rescan = useCallback(() => {
    setStatus('scanning');
    void runScan();
  }, [runScan]);

  // 挂载扫描 + 持续监听真实设备变化（拔出自动回退）
  useEffect(() => {
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    void runScan();

    if (isTauri()) {
      void tauriWatchDevice(() => void runScan()).then((un) => {
        if (cancelled) {
          un?.();
          return;
        }
        unwatch = un;
        if (!un) {
          const timer = window.setInterval(() => void runScan(), 3000);
          unwatch = () => window.clearInterval(timer);
        }
      });
    } else {
      unwatch = watchBrowserDevice(() => void runScan());
    }

    return () => {
      cancelled = true;
      unwatch?.();
    };
  }, [runScan]);

  const value = useMemo<DeviceState>(
    () => ({ status, device, info, rescan }),
    [status, device, info, rescan],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceState {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice 必须在 <DeviceProvider> 内使用');
  return ctx;
}
