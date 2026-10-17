import { Menu } from 'lucide-react';

interface TopbarProps {
  crumbs: string;
}

/**
 * 顶栏 — 只保留导航折叠按钮与面包屑。
 * 「配置库 / 搜索 / 更多菜单」在原版中均无对应功能，已移除（不放置无动作的控件）。
 */
export default function Topbar({ crumbs }: TopbarProps) {
  const toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('is-open');
  };

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn menu-toggle"
        aria-label="展开导航"
        aria-expanded="false"
        onClick={toggleSidebar}
      >
        <Menu size={20} strokeWidth={1.5} />
      </button>
      <span className="topbar__crumbs">{crumbs}</span>
    </header>
  );
}
