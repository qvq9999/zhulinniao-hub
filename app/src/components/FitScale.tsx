import { useLayoutEffect, useRef, type ReactNode } from 'react';

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
 * - 比例上限 = 全站基准比例（只由窗口尺寸决定）→ 各页一致；
 * - **二分求「刚好塞得下的最大比例」**：旧实现从 1 倍逐步缩小，遇到第一次适配就停，
 *   会留下上百像素空白（内容在更小的 zoom 下重排后变矮），比例明显偏小；
 * - 首帧在 **useLayoutEffect** 中测量（绘制前完成），页面一出现就是最终比例，不闪；
 * - 挂载后按 60/180/400/800/1300/1750ms 复测 + 字体就位复测：
 *   内容晚到时也能自动收进一屏，**不再需要用户手动拖一下窗口**；
 * - 同一挂载内只允许继续缩小（绝不放大），切换页签不会跳比例。
 */
export default function FitScale({ children, min = 0.55, scroll = false }: FitScaleProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** 本次挂载内已锁定的比例（同一页面切换页签时不再变大） */
  const locked = useRef(1);
  /** 已实际写入 DOM 的比例（避免同值重复写、减少无谓重排） */
  const applied = useRef(0);
  /**
   * 用 useLayoutEffect 而不是 useEffect：首帧比例必须在**浏览器绘制之前**算好并写入，
   * 否则用户先看到 1 倍大小的版面、再被缩到目标比例 —— 这就是「每次打开概览闪一下」。
   */
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;

    let raf = 0;
    let scheduled = false;
    let suspendUntil = 0;

    const apply = (z: number) => {
      // 以 DOM 上的实际值为准：二分测量过程会把 zoom 停在测试值上
      const cur = Number.parseFloat(i.style.zoom || '1') || 1;
      if (Math.abs(cur - z) < 0.001) {
        applied.current = z;
        i.dataset.fitZoom = z.toFixed(3);
        return;
      }
      applied.current = z;
      // 自己改 zoom 会触发尺寸变化，短时间内的 RO 回调一律忽略，避免自激
      suspendUntil = performance.now() + 320;
      i.style.zoom = String(z);
      i.dataset.fitZoom = z.toFixed(3);
    };

    /** 把 zoom 设为 z 后读取**视觉尺寸**（zoom 会重排，故每次都要实测） */
    const measureAt = (z: number) => {
      i.style.zoom = String(z);
      const r = i.getBoundingClientRect();
      return r;
    };

    /**
     * 二分求「在 [min, cap] 内刚好不溢出」的最大比例。
     * 内容高度随 zoom 单调增加（zoom 变小时排版宽度变大、换行变少），故可二分。
     */
    const solve = (availH: number, availW: number, cap: number) => {
      const top = measureAt(cap);
      if (top.height <= availH + 0.5 && top.width <= availW + 0.5) return cap;

      const lo0 = Math.min(min, cap);
      const atLo = measureAt(lo0);
      if (atLo.height > availH + 0.5 || atLo.width > availW + 0.5) return lo0;

      let lo = lo0;
      let hi = cap;
      for (let n = 0; n < 8; n += 1) {
        const mid = (lo + hi) / 2;
        const r = measureAt(mid);
        if (r.height <= availH + 0.5 && r.width <= availW + 0.5) lo = mid;
        else hi = mid;
        if (hi - lo < 0.003) break;
      }
      return lo;
    };

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
        apply(final);
        i.dataset.fitReady = '1';
        return;
      }

      const cap = Math.max(min, base);
      const target = solve(availH, availW, cap);

      // 同一挂载内**只允许继续缩小**：内容晚到时收进一屏（不再被裁掉），
      // 但绝不放大 —— 否则会出现「先小后大」的跳动（用户投诉的"闪一下/忽大忽小"）。
      // 需要放大只能在窗口尺寸变化（onResize → reset）时发生。
      const final = Math.min(locked.current, target);
      locked.current = final;
      apply(final);
      // 比例已落定：解除首帧遮罩（正常情况下这一步在浏览器绘制前就完成了）
      i.dataset.fitReady = '1';
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

    // 异步内容（真机回读 / 字体 / 端点面板）晚到导致的高度变化 → 多次复测兜底。
    // 这是「打开概览要手动拖一下窗口才完整」的根因修复点。
    const timers = [60, 180, 400, 800, 1300, 1750].map((ms) =>
      window.setTimeout(schedule, ms),
    );
    void document.fonts?.ready.then(schedule).catch(() => undefined);

    const ro = new ResizeObserver(() => {
      if (performance.now() < suspendUntil) return; // 忽略自己改 zoom 引发的变化
      schedule();
    });
    ro.observe(o);
    // 只观察外层：内层会因 zoom 自身抖动，改为定时 + 字体复测覆盖
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      timers.forEach((t) => window.clearTimeout(t));
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
