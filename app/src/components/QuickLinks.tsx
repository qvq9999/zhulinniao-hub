import { Link } from 'react-router-dom';
import { SlidersHorizontal, Move3d, Mic, Lightbulb } from 'lucide-react';

const LINKS = [
  { to: '/sound', Icon: SlidersHorizontal, t: '音效控制', d: '均衡器与音效' },
  { to: '/spatial', Icon: Move3d, t: '空间音频', d: '3D全景空间音频' },
  { to: '/mic', Icon: Mic, t: '麦克风', d: '麦克风降噪与录音特效' },
  { to: '/lighting', Icon: Lightbulb, t: 'LED', d: '灯效与颜色' },
];

/** 快速入口四宫格 — 连接页与概览页共用（原型 1:1）。 */
export default function QuickLinks() {
  return (
    <section className="quick">
      <h2 className="quick__title">快速入口</h2>
      <div className="quick__grid">
        {LINKS.map(({ to, Icon, t, d }) => (
          <Link key={to} className="quick-link" to={to}>
            <Icon size={24} strokeWidth={1.5} />
            <div>
              <div className="quick-link__t">{t}</div>
              <div className="quick-link__d">{d}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
