import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  SlidersHorizontal,
  Mic,
  Settings2,
} from 'lucide-react';
import { useDevice } from '../device/DeviceContext';

interface NavEntry {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
}

/**
 * 导航项 = 原版对 ZG3 实际提供的范围：
 * 概览 / 音效控制（耳机 7 项）/ 麦克风（2 项）/ 设置（装置设置及信息 + 通用设置）。
 * 原版未开放的空间音频、超感听觉、LED 已整页下架（本设备通道不存在，见 docs/原版对齐规格.md）。
 */
const NAV_ITEMS: NavEntry[] = [
  { to: '/overview', label: '概览', Icon: LayoutDashboard },
  { to: '/sound', label: '音效控制', Icon: SlidersHorizontal },
  { to: '/mic', label: '麦克风', Icon: Mic },
  { to: '/device', label: '设置', Icon: Settings2 },
];

/**
 * 侧边导航 — 与原型 aside.sidebar 1:1。
 * 连接态取自 DeviceContext（系统真实设备状态）：
 * 未检出设备时设置项灰显（aria-disabled，样式由 app.css 处理）。
 * 兼容旧签名：connected prop 传入时优先于全局状态。
 */
export default function Sidebar({ connected: connectedProp }: { connected?: boolean }) {
  const { status } = useDevice();
  const connected = connectedProp ?? status === 'connected';
  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
            <line x1="16" y1="8" x2="2" y2="22" />
            <line x1="17.5" y1="15" x2="9" y2="15" />
          </svg>
        </span>
        <div>
          <div className="sidebar__title">朱雀耳机 Hub</div>
          <div className="sidebar__sub">CM002X1 · 竹林鸟</div>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        <div className="nav__label">功能</div>
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="nav-item"
            aria-disabled={connected ? undefined : 'true'}
            tabIndex={connected ? undefined : -1}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
