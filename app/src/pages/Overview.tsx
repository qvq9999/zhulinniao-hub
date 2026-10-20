import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CircleCheck,
  CircleAlert,
  Mic,
  SlidersHorizontal,
  MicOff,
  Hash,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import EndpointPanel from '../components/EndpointPanel';
import SliderRow from '../components/SliderRow';
import SwitchRow from '../components/SwitchRow';
import DeviceLineArt from '../components/DeviceLineArt';
import MicMeter from '../components/MicMeter';
import FitScale from '../components/FitScale';
import { errText } from '../device/tauriBridge';
import { useDevice } from '../device/DeviceContext';
import { useSettle } from '../state/useSettle';

// 仅保留原版对 ZG3 实际开放的两类：音效 / 麦克风（空间音频与 LED 已整页下架）
const HOTSPOTS = [
  { to: '/sound', target: 'card-sound', label: '音效设置', style: { left: '63%', top: '30%' } },
  { to: '/mic', target: 'card-mic', label: '麦克风设置', style: { left: '22%', top: '78%' } },
];

/** 概览页 — 设备热区图 + SVG 引线 + 快捷控制（播放/录音端点音量、平衡、静音走系统音频端点，真实生效）。 */
export default function Overview() {
  const navigate = useNavigate();
  const { info, status } = useDevice();
  const heroRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const setActiveRef = useRef<(id: string, on: boolean) => void>(() => {});

  const [mic, setMic] = useState<{ volume: number; muted: boolean; device: string }>({
    volume: 0.8,
    muted: false,
    device: '',
  });
  const [micNote, setMicNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** 首帧静止守卫：麦克风音量/静音默认为 80%·关，被真机值覆盖时不播过渡 */
  const settled = useSettle(ready);
  /** 用户最近一次操作时间戳：操作中不让轮询覆盖（避免拖拽打架） */
  const interacting = useRef(0);

  const micVolume = Math.round(mic.volume * 100);

  // 真实录音端点状态：音量与静音（Windows Core Audio）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { tauriGetAudioState } = await import('../device/tauriBridge');
        const m = await tauriGetAudioState(true);
        if (cancelled) return;
        setMic({ volume: m.volume, muted: m.muted, device: m.device_name });
      } catch {
        if (!cancelled) setMicNote('浏览器预览：麦克风控制仅在桌面版生效');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushMic = async (next: { volume?: number; muted?: boolean }) => {
    interacting.current = Date.now();
    setMic((prev) => ({ ...prev, ...next }));
    try {
      const { tauriSetAudioVolume, tauriSetAudioMute } = await import('../device/tauriBridge');
      if (next.volume !== undefined) await tauriSetAudioVolume(true, next.volume);
      if (next.muted !== undefined) await tauriSetAudioMute(true, next.muted);
      setMicNote('已写入麦克风端点（真实生效）');
    } catch (e) {
      setMicNote(`写入失败：${errText(e)}`);
    }
  };

  // 实时同步：外部调整后，界面 1s 内自动跟随
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (Date.now() - interacting.current < 1500) return; // 正在拖动/刚改过，避免打架
      try {
        const { tauriGetAudioState } = await import('../device/tauriBridge');
        const m = await tauriGetAudioState(true);
        setMic((prev) =>
          prev.volume.toFixed(3) === m.volume.toFixed(3) && prev.muted === m.muted && prev.device === m.device_name
            ? prev
            : { volume: m.volume, muted: m.muted, device: m.device_name },
        );
      } catch {
        /* 通道不可用时静默 */
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const onMicVolumeChange = (v: number) => void pushMic({ volume: v / 100 });
  const onMicMuteChange = (v: boolean) => void pushMic({ muted: v });

  /** 成功类反馈 4s 自动消失；错误类保留 */
  useEffect(() => {
    if (!micNote) return;
    if (micNote.includes('失败')) return;
    const t = window.setTimeout(() => setMicNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [micNote]);

  // SVG 引线：测量热区与卡片位置绘制贝塞尔曲线，resize 时 rAF 重绘
  useEffect(() => {
    const hero = heroRef.current;
    const svg = svgRef.current;
    if (!hero || !svg) return;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const draw = () => {
      if (!hero.isConnected) return;
      const heroRect = hero.getBoundingClientRect();
      if (heroRect.width < 2 || heroRect.height < 2) return;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute('viewBox', `0 0 ${Math.round(heroRect.width)} ${Math.round(heroRect.height)}`);
      svg.setAttribute('preserveAspectRatio', 'none');

      hero.querySelectorAll<HTMLElement>('.hotspot[data-target]').forEach((hs) => {
        const targetId = hs.getAttribute('data-target');
        const card = targetId ? document.getElementById(targetId) : null;
        if (!targetId || !card) return;
        const hr = hs.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const x1 = hr.left + hr.width / 2 - heroRect.left;
        const y1 = hr.top + hr.height / 2 - heroRect.top;
        const onLeft = x1 < heroRect.width / 2;
        const x2 = onLeft ? cr.right - heroRect.left : cr.left - heroRect.left;
        const y2 = cr.top + cr.height / 2 - heroRect.top;
        const bend = 56;
        const tail = 20;
        const d =
          `M ${x1.toFixed(1)} ${y1.toFixed(1)}` +
          ` C ${(x1 + (onLeft ? -bend : bend)).toFixed(1)} ${y1.toFixed(1)},` +
          ` ${(x2 + (onLeft ? tail : -tail)).toFixed(1)} ${y2.toFixed(1)},` +
          ` ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('class', 'leader-line');
        p.setAttribute('data-target', targetId);
        svg.appendChild(p);
      });
    };

    const setActive = (targetId: string, on: boolean) => {
      const p = svg.querySelector(`.leader-line[data-target="${targetId}"]`);
      if (p) p.classList.toggle('is-active', on);
      const card = document.getElementById(targetId);
      if (card) card.classList.toggle('is-linked', on);
    };
    setActiveRef.current = setActive;

    draw();
    let rafId = 0;
    const onResize = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const linkEvents = (targetId: string) => ({
    onMouseEnter: () => setActiveRef.current(targetId, true),
    onMouseLeave: () => setActiveRef.current(targetId, false),
    onFocus: () => setActiveRef.current(targetId, true),
    onBlur: () => setActiveRef.current(targetId, false),
  });

  return (
    <div className="app" data-booting={settled ? undefined : ''}>
      <Sidebar />
      <div className="main">
        <Topbar crumbs="概览 · 设备总览" />

        <main className="canvas canvas--compact">
          <FitScale>
          <div className="page-head">
            <div className="page-head__text">
              <h1 className="page-title">概览</h1>
              <p className="page-desc">点击耳机上的热区，直达对应功能设置。</p>
            </div>
            <div className="page-head__actions">
              <span className="pill">
                <Hash size={16} strokeWidth={1.5} />
                <span className="mono">
                  {info?.vid != null && info?.pid != null
                    ? `${info.vid.toString(16).toUpperCase().padStart(4, '0')}:${info.pid
                        .toString(16)
                        .toUpperCase()
                        .padStart(4, '0')}`
                    : '—'}
                </span>
              </span>
              <span className={`pill${status === 'connected' ? ' pill--ok' : ' pill--warn'}`}>
                {status === 'connected' ? <CircleCheck size={16} strokeWidth={1.5} /> : <CircleAlert size={16} strokeWidth={1.5} />}
                <span>{info?.name ?? (status === 'connected' ? '已连接' : '未检测到设备')}</span>
              </span>
            </div>
          </div>

          {/* 本页仅在 DeviceContext.status === 'connected'（真实检出设备）时由路由门禁放行 */}

          {/* 设备实物热区图（已连接态） */}
          <section className="hero hero--map" data-hotspot-map ref={heroRef} aria-label="朱雀耳机实物热区图" style={{ minHeight: 226, paddingTop: 0, paddingBottom: 0 }}>
            <svg className="leader-lines" data-leader-svg ref={svgRef} aria-hidden="true" focusable="false" />

            <div className="hero__cards hero__cards--left">
              <Link className="hotspot-card" id="card-mic" to="/mic" {...linkEvents('card-mic')}>
                <Mic size={20} strokeWidth={1.5} />
                <div>
                  <p className="hotspot-card__t">麦克风</p>
                  <p className="hotspot-card__d">麦克风降噪 · Xear 魔幻音效</p>
                </div>
              </Link>
            </div>

            <div className="hero__stage">
              <div className="device-wrap">
                <div className="device-visual">
                  <figure className="hero__figure">
                    <DeviceLineArt ariaLabel="朱雀 CM002X1 头戴式耳机线稿占位图（待接入原版实物图），标注 4 个功能热区" />
                  </figure>
                </div>
                {HOTSPOTS.map((h) => (
                  <button
                    key={h.target}
                    type="button"
                    className="hotspot"
                    data-target={h.target}
                    aria-label={h.label}
                    style={h.style}
                    {...linkEvents(h.target)}
                    onClick={() => navigate(h.to)}
                  >
                    <span className="hotspot__dot" />
                  </button>
                ))}
              </div>
            </div>

            <div className="hero__cards hero__cards--right">
              <Link className="hotspot-card" id="card-sound" to="/sound" {...linkEvents('card-sound')}>
                <SlidersHorizontal size={20} strokeWidth={1.5} />
                <div>
                  <p className="hotspot-card__t">音效控制</p>
                  <p className="hotspot-card__d">均衡器 · Xear 动态低频 · Xear 7.1环绕</p>
                </div>
              </Link>
            </div>
          </section>

          {/* 快捷控制：对齐原版 EndpointControl —— 音量/平衡/静音直接写入系统音频端点（真实生效） */}
          <section className="quick" style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
            <h2 className="quick__title">快捷控制</h2>
            <div className="work work--even work--stretch">
              {/* 播放端点（自音效控制页迁入，便于日常调节） */}
              <EndpointPanel capture={false} title="耳机（播放端点）" />

              <section className="panel" aria-label="录制控制">
                <div className="panel__head">
                  <h2 className="panel__title">录音装置</h2>
                  <Link className="btn btn--ghost" to="/mic" style={{ marginLeft: 'auto' }}>
                    麦克风详细设置
                  </Link>
                </div>
                <SliderRow
                  label="麦克风音量"
                  icon={Mic}
                  value={micVolume}
                  onChange={onMicVolumeChange}
                  ariaLabel="麦克风音量"
                  hint={mic?.device ? `当前录音设备：${mic.device}` : '直接作用于系统默认录音设备（真实生效）'}
                />
                <hr className="divider" />
                <SwitchRow label="麦克风静音" icon={MicOff} checked={mic.muted} onChange={onMicMuteChange} />
                <hr className="divider" />
                <div className="field">
                  <div className="field__row">
                    <span className="field__label">输入电平</span>
                    <span className="field__hint" style={{ margin: 0 }}>
                      实时采样当前录音设备
                    </span>
                  </div>
                  <MicMeter />
                </div>
              </section>
            </div>
          </section>
          </FitScale>
        </main>
      </div>
      {/* 操作反馈浮层：fixed 定位不占布局。
          原先提示条塞在这张卡里，拖麦克风音量时卡片会忽高忽低 → 整页跟着缩一下。 */}
      {micNote && (
        <div
          className={`toast is-visible${micNote.includes('失败') ? ' toast--warn' : ''}`}
          role="status"
          aria-live="polite"
        >
          {micNote}
        </div>
      )}
    </div>
  );
}
