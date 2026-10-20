import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { DeviceProvider } from './device/DeviceContext';
import { SettingsProvider } from './state/settings';
import './styles/design-tokens.css';
import './styles/app.css';
// 质感层（方向 A · Light Precision）：只覆盖视觉，不改布局与交互。
// 需整层回退时删除下面一行即可。
import './styles/polish.css';

/** 渲染期错误边界：组件异常可视化 + 磁盘上报，避免只看到空白窗口 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      const inv = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => void } })
        .__TAURI_INTERNALS__?.invoke;
      inv?.('report_frontend_error', {
        message: 'react-render-error | ' + String(error.stack || error.message) + ' | ' + info.componentStack,
      });
    } catch {
      /* 浏览器预览环境忽略 */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 760, margin: '48px auto', padding: '20px 24px', border: '1px solid #B4322A', borderRadius: 12, font: '14px/1.6 system-ui, "Noto Sans SC", sans-serif', color: '#1A1D1F' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16, color: '#B4322A' }}>界面渲染异常</h2>
          <p style={{ margin: 0 }}>请把下面信息反馈给开发者：</p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '12px 0 0', padding: 12, background: '#F6F7F8', borderRadius: 8, font: '12px/1.5 ui-monospace, monospace', color: '#4A5054' }}>
            {String(this.state.error.stack || this.state.error.message)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
ReactDOM.createRoot(rootEl!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <DeviceProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </DeviceProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// 桌面软件观感：屏蔽浏览器右键菜单。
// Rust 侧已关闭 WebView2 原生菜单（lib.rs），这里兜住 DOM 层的默认行为，
// 顺带让浏览器预览调试时也不弹菜单。输入框放行，保留原生粘贴/复制。
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
});

// 挂载心跳上报：能收到这条说明 React 渲染链路正常
try {
  const inv = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => void } })
    .__TAURI_INTERNALS__?.invoke;
  inv?.('report_frontend_error', { message: 'react-mounted | isTauri=' + Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) });
  // DOM 快照：确知当前渲染出的屏幕内容（供无调试器环境排障）
  const snapshot = (tag: string) => {
    try {
      const root = document.getElementById('root');
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      inv?.('report_frontend_error', {
        message:
          'dom-snapshot[' + tag + '] rootChildren=' + (root?.childElementCount ?? -1) +
          ' | text=' + text,
      });
    } catch {
      /* ignore */
    }
  };
  window.setTimeout(() => snapshot('1.5s'), 1500);
  window.setTimeout(() => snapshot('4s'), 4000);
} catch {
  /* 浏览器预览环境忽略 */
}
