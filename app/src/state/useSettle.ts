import { useEffect, useState } from 'react';

/**
 * 首帧「静止态」守卫 —— 真机回读落定前，抑制所有状态过渡动画。
 *
 * 背景（用户反馈「切到音效控制页时，已开启的开关会闪一下打开动画」）：
 * 页面挂载时 state 只能是默认值（开关默认关、滑杆默认中间），
 * 异步回读真值后 React 覆盖一次 state —— 若此时 CSS transition 生效，
 * 控件就会从默认位置「滑」到真值位置。这不是真实状态变化，却看起来像一次操作。
 *
 * 做法与推子（Sound 页 faderAnim）同一口径：
 * 数据落定后等两帧再放开过渡，确保「默认值 → 真值」那一跳是瞬时的。
 *
 * 用法：
 *   const settled = useSettle(ready);
 *   <div className="app" data-booting={settled ? undefined : ''}>
 * 配套样式见 polish.css 的 [data-booting] 规则。
 *
 * @param ready 数据是否已从真机读回（含读取失败——失败也是一次确定状态）
 * @returns 是否已度过首帧静止期（true = 允许播放过渡动画）
 */
export function useSettle(ready: boolean): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!ready) {
      setSettled(false);
      return;
    }
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      window.cancelAnimationFrame(first);
      if (second) window.cancelAnimationFrame(second);
    };
  }, [ready]);

  return settled;
}

export default useSettle;
