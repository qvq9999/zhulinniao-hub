import { useEffect, useRef, type ReactNode } from 'react';

interface FitScaleProps {
  children: ReactNode;
  /** 最小缩放比例（低于此值不再缩小，避免文字过小不可读） */
  min?: number;
  /**
   * 长页面模式：**不再为「塞进一屏」而缩小**，只用全站统一基准比例，
   * 内容超出时改为纵向滚动。用于设置页这类条目多的页面——
   * 否则整页被压到 0.8x 左右，字体明显小于其它页面。
   */
  scroll?: boolean;
}

/**
 * 基准版面尺寸 —— 全站统一缩放的参照。
 * 取「最高的那一页（音效控制 · 均衡器面板）在 1 倍下的自然高度」，
 * 所有页面都用同一个基准算比例，因此**页面之间、效果页签之间大小完全一致**，
 * 不会出现「打开均衡器页面突然变大/变小」。
 */
const REF_H = 830;
const REF_W = 1060;

/**
 * 自适应比例缩放容器 —— 页面内容超出可视区时整体等比缩小（CSS zoom），
 * 不产生滚动条、也不需要拉大窗口。
 *
 * 实现要点：
 * - 用 zoom 而非 transform：zoom 会重排（换行/栅格跟着变），文字保持矢量清晰；
 * - 比例 = min(基准比例, 本页实测所需比例)，基准比例只由窗口尺寸决定 → 各页一致；
 * - 同一页签内只减不增（lock），切换效果页签不会跳比例。
 */
export default function FitScale({ children, min = 0.55, scroll = false }: FitScaleProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** 本次挂载内已锁定的比例（同一页面切换页签时不再变大） */
  const locked = useRef(1);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;

    let raf = 0;
    let scheduled = false;

    const measure = (reset = false) => {
      const availH = o.clientHeight;
      const availW = o.clientWidth;
      if (availH < 40 || availW < 40) return;
      if (reset) locked.current = 1;

      // 全站统一基准比例：只取决于窗口可用区，和本页内容无关
      const base = Math.min(1, availH / REF_H, availW / REF_W);

      // 长页面：只按基准比例，不为了塞进一屏再缩小（改为滚动）
      if (scroll) {
        const final = Math.max(min, base);
        locked.current = final;
        i.style.zoom = String(final);
        i.dataset.fitZoom = final.toFixed(3);
        return;
      }

      // 本页实测所需比例（从 1 倍起迭代收敛）
      let need = 1;
      i.style.zoom = '1';
      for (let n = 0; n < 4; n += 1) {
        const r = i.getBoundingClientRect();
        if (r.height <= availH + 0.5 && r.width <= availW + 0.5) break;
        const factor = Math.min(availH / Math.max(r.height, 1), availW / Math.max(r.width, 1));
        const next = Math.max(min, Math.min(1, need * factor * 0.996));
        if (Math.abs(next - need) < 0.002) {
          need = next;
          break;
        }
        need = next;
        i.style.zoom = String(need);
        if (need <= min) break;
      }

      const target = Math.max(min, Math.min(base, need));
      const final = Math.min(locked.current, target);
      locked.current = final;
      i.style.zoom = String(final);
      i.dataset.fitZoom = final.toFixed(3);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      raf = window.requestAnimationFrame(() => {
        scheduled = false;
        measure();
      });
    };

    const onResize = () => {
      // 窗口尺寸变了才允许重新放大/缩小
      locked.current = 1;
      schedule();
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(o);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [min, scroll]);

  return (
    <div className={`fit${scroll ? ' fit--scroll' : ''}`} ref={outer}>
      <div className="fit__inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}
