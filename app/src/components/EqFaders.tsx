import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

export interface EqFadersProps {
  /** 频段标签（底部），数量决定推子个数 */
  labels: string[];
  /** 各段增益 dB */
  gains: number[];
  minDb?: number;
  maxDb?: number;
  /** 步进 dB（注册表存整数，默认 1） */
  step?: number;
  /** 推子轨道高度 px */
  height?: number;
  onChange: (gains: number[]) => void;
  ariaLabel?: string;
}

/**
 * 均衡器推子组 — **对齐原版模式**：每段一个独立竖向推子，上下拖动单独调该段增益。
 * 左侧 dB 刻度（+20 / +10 / 0 / -10 / -20），底部频段标签，顶部显示各段当前 dB。
 * 支持鼠标/触摸拖动与键盘（↑/↓ 1 dB，Shift 5 dB，Home 归零）。
 */
export default function EqFaders({
  labels,
  gains,
  minDb = -20,
  maxDb = 20,
  step = 1,
  height = 240,
  onChange,
  ariaLabel = '均衡器推子',
}: EqFadersProps) {
  const dragIdx = useRef(-1);
  const gainsRef = useRef(gains);
  gainsRef.current = gains;

  const clamp = (v: number) => Math.max(minDb, Math.min(maxDb, v));
  const snap = (v: number) => clamp(Math.round(v / step) * step);

  const setBand = (idx: number, db: number) => {
    const next = gainsRef.current.slice();
    next[idx] = snap(db);
    onChange(next);
  };

  /** 由指针 Y 反解 dB（随缩放自动正确：rect 与 clientY 同为视觉像素） */
  const dbFromY = (el: HTMLElement, clientY: number): number => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return 0;
    const ratio = 1 - (clientY - r.top) / r.height; // 底=0 → 顶=1
    return minDb + ratio * (maxDb - minDb);
  };

  const onDown = (i: number, e: ReactPointerEvent<HTMLDivElement>) => {
    dragIdx.current = i;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBand(i, dbFromY(e.currentTarget, e.clientY));
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragIdx.current < 0) return;
    setBand(dragIdx.current, dbFromY(e.currentTarget, e.clientY));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragIdx.current = -1;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onKeyDown = (i: number, e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = e.shiftKey ? step * 5 : step;
    if (e.key === 'ArrowUp') {
      setBand(i, gainsRef.current[i] + delta);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      setBand(i, gainsRef.current[i] - delta);
      e.preventDefault();
    } else if (e.key === 'Home') {
      setBand(i, 0);
      e.preventDefault();
    }
  };

  /** dB → 距底部百分比 */
  const pctOf = (db: number) => ((clamp(db) - minDb) / (maxDb - minDb)) * 100;
  /** 刻度（+20 / +10 / 0 / -10 / -20） */
  const ticks = [maxDb, maxDb - (maxDb - minDb) / 4, 0, minDb + (maxDb - minDb) / 4, minDb];

  const fmt = (g: number) => (g > 0 ? `+${g}` : `${g}`);

  return (
    <div className="eqf" role="group" aria-label={ariaLabel}>
      {/* 顶部：各段当前 dB */}
      <div className="eqf__vals">
        {labels.map((t, i) => (
          <span key={`v${t}`} className="eqf__val mono">
            {fmt(gains[i] ?? 0)}
          </span>
        ))}
      </div>

      {/* 左侧 dB 刻度（与轨道同高） */}
      <div className="eqf__axis" aria-hidden="true">
        {ticks.map((db) => (
          <span key={db} className="eqf__tick" style={{ top: `${100 - pctOf(db)}%` }}>
            {db > 0 ? `+${db}` : `${db}`} dB
          </span>
        ))}
      </div>

      {/* 推子轨道 */}
      <div className="eqf__tracks">
        {labels.map((label, i) => {
          const g = gains[i] ?? 0;
          const pct = pctOf(g);
          return (
            <div
              key={`t${label}`}
              className="eqf__track"
              style={{ height }}
              role="slider"
              tabIndex={0}
              aria-label={`${label} 增益`}
              aria-valuemin={minDb}
              aria-valuemax={maxDb}
              aria-valuenow={g}
              aria-valuetext={`${g} dB`}
              onPointerDown={(e) => onDown(i, e)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={(e) => onKeyDown(i, e)}
            >
              <span className="eqf__rail" />
              <span className="eqf__fill" style={{ height: `${pct}%` }} />
              <span className="eqf__thumb" style={{ bottom: `${pct}%` }} />
            </div>
          );
        })}
      </div>

      {/* 底部频段标签 */}
      <div className="eqf__freqs">
        {labels.map((label) => (
          <span key={`f${label}`} className="eqf__freq mono">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
