import { useEffect } from 'react';
import { useSetting } from './settings';

export type ThemeVal = 'light' | 'dark' | 'system';

/** 设置项键名（与 closeAction 等同级，落在 settings.json / localStorage） */
export const THEME_KEY = 'theme';

/** 未写入过时的默认值：浅色（沿用原实现初始值，不擅自改变外观） */
export const THEME_FALLBACK: ThemeVal = 'light';

const darkMedia = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * 把主题落到 <html>。
 * - 深色 → 挂 data-theme="dark"（design-tokens.css 的深色变量组）
 * - 浅色 → 摘除属性（走 :root 默认变量）
 * - 跟随系统 → 按 prefers-color-scheme 决定，并把 color-scheme 交回 CSS 的 light dark
 * 同时写内联 color-scheme，让滚动条/原生控件跟随主题，而不是跟随操作系统。
 */
export function applyTheme(theme: ThemeVal): void {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && darkMedia().matches);
  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  root.style.colorScheme = theme === 'system' ? '' : dark ? 'dark' : 'light';
}

/**
 * 主题同步器 — **必须常驻在路由之外**（App 顶层挂载）。
 *
 * 历史 bug（用户报「设置里选深色，再点侧边栏设置就变回浅色」）的根因：
 * 主题原本是 Device 组件内的 useState('light')，既不进持久化，也只在 Device 挂载时
 * 才把 data-theme 写到 <html>。于是 Device 一旦重新挂载（离开设置页再进入、应用重启、
 * 路由树重建），theme 就回到 'light'，effect 把 data-theme 摘掉 → 界面回落浅色。
 *
 * 现在：值来自持久化设置（切页/重启都保留），应用动作由常驻组件负责，
 * 与任何页面的挂载周期无关。
 */
export function ThemeSync() {
  const [theme] = useSetting<ThemeVal>(THEME_KEY, THEME_FALLBACK);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = darkMedia();
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return null;
}
