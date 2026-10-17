import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type Values = Record<string, unknown>;

interface SettingsApi {
  values: Values;
  /** 写入单个键（自动持久化：本地缓存 + 桌面版 JSON 配置文件） */
  set: (key: string, value: unknown) => void;
  /**
   * 函数式更新单个键（**基于最新状态**）。
   * 用于同一事件里连续更新多个字段的场景——直接用 set 会因闭包里的旧快照互相覆盖
   * （曾导致「选预设后弹回自定义」「拖曲线不动」两个 bug）。
   */
  update: (key: string, updater: (prev: unknown) => unknown) => void;
  /** 是否已完成首次加载（避免用默认值覆盖真实配置） */
  ready: boolean;
}

const SettingsContext = createContext<SettingsApi | null>(null);

const LS_KEY = 'zhub-settings';

function readLocal(): Values {
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || '{}') as Values;
  } catch {
    return {};
  }
}

/**
 * 设置持久化（对齐原版：设置存配置文件，切页/重启都保留）。
 * - 桌面版：写入 appConfigDir/settings.json（settings_save 命令，原子写）
 * - 浏览器预览：退化为 localStorage
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Values>(readLocal);
  const [ready, setReady] = useState(false);
  const timer = useRef<number>(0);
  const valuesRef = useRef<Values>(values);
  valuesRef.current = values;

  // 首次加载：桌面版优先读 JSON 配置（真实持久化位置）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { tauriSettingsLoad } = await import('../device/tauriBridge');
        const json = await tauriSettingsLoad();
        const parsed = JSON.parse(json || '{}') as Values;
        if (!cancelled && parsed && Object.keys(parsed).length > 0) {
          setValues((prev) => ({ ...parsed, ...prev })); // 本地缓存优先（更新的可能还没落盘）
        }
      } catch {
        /* 浏览器预览：仅用 localStorage */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: Values) => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* 配额/隐私模式忽略 */
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const { tauriSettingsSave } = await import('../device/tauriBridge');
        await tauriSettingsSave(JSON.stringify(valuesRef.current));
      } catch {
        /* 浏览器预览忽略 */
      }
    }, 300);
  }, []);

  const set = useCallback(
    (key: string, value: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const update = useCallback(
    (key: string, updater: (prev: unknown) => unknown) => {
      setValues((prev) => {
        const next = { ...prev, [key]: updater(prev[key]) };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const api = useMemo<SettingsApi>(() => ({ values, set, update, ready }), [values, set, update, ready]);
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 <SettingsProvider> 内使用');
  return ctx;
}

/** 读取持久化设置项；未写入过时返回默认值 */
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const { values, set, ready } = useSettings();
  const value = (values[key] as T | undefined) ?? fallback;
  return [value, (v: T) => set(key, v), ready];
}

/**
 * 函数式补丁更新：`patch(prev => ({...}))` 或 `patch({ partial })`。
 * 与 useSetting 的 set 不同，它基于**最新状态**计算，适合一次事件改多个字段。
 */
export function useSettingPatch<T extends object>(
  key: string,
  fallback: T,
): [T, (delta: Partial<T> | ((prev: T) => Partial<T>)) => void] {
  const { values, update } = useSettings();
  const value = { ...fallback, ...((values[key] as T | undefined) ?? ({} as T)) };
  const patch = (delta: Partial<T> | ((prev: T) => Partial<T>)) =>
    update(key, (prevRaw) => {
      const prev = { ...fallback, ...((prevRaw as T | undefined) ?? ({} as T)) };
      const d = typeof delta === 'function' ? delta(prev) : delta;
      return { ...prev, ...d };
    });
  return [value, patch];
}
