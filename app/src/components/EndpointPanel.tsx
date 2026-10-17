import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Mic, MicOff } from 'lucide-react';
import SliderRow from './SliderRow';
import SwitchRow from './SwitchRow';
import {
  errText,
  tauriGetAudioState,
  tauriSetAudioBalance,
  tauriSetAudioMute,
  tauriSetAudioVolume,
} from '../device/tauriBridge';

/**
 * 端点控制条 — 对齐原版每张装置卡片的通用控件（EndpointControl.xaml）：
 * 音量滑杆 + 平衡滑杆（左 / 右）+ 静音开关。
 * 取值与写入全部走 Core Audio（真实作用于耳机/麦克风端点），不落本地缓存。
 *
 * 平衡映射（与 Windows 音量混合器一致）：滑杆 0..100，50 = 居中
 *   左声道 = x <= 0.5 ? 1 : 1 - (x-0.5)*2
 *   右声道 = x >= 0.5 ? 1 : x*2
 * 反解时按左右声道较小的那一路还原滑杆位置。
 */
export interface EndpointPanelProps {
  /** true = 录音端点（麦克风），false = 播放端点（耳机） */
  capture: boolean;
  title: string;
}

const balanceToChannels = (p: number): [number, number] => {
  const x = p / 100;
  const left = x <= 0.5 ? 1 : 1 - (x - 0.5) * 2;
  const right = x >= 0.5 ? 1 : x * 2;
  return [Math.round(left * 100) / 100, Math.round(right * 100) / 100];
};

const channelsToBalance = (left: number, right: number): number => {
  if (left <= 0 && right <= 0) return 50;
  if (Math.abs(left - right) < 0.02) return 50;
  return right < left ? Math.round(50 + (1 - right / Math.max(left, 0.01)) * 50) : Math.round((left / Math.max(right, 0.01)) * 50);
};

export default function EndpointPanel({ capture, title }: EndpointPanelProps) {
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [balance, setBalance] = useState(50);
  const [channels, setChannels] = useState(0);
  const [device, setDevice] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const interacting = useRef(0);

  const refresh = async () => {
    try {
      const st = await tauriGetAudioState(capture);
      setVolume(Math.round(st.volume * 100));
      setMuted(st.muted);
      setChannels(st.channels);
      setDevice(st.device_name);
      if (st.channels >= 2) setBalance(channelsToBalance(st.left, st.right));
    } catch {
      setNote('浏览器预览：音量/平衡仅在桌面版生效');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (Date.now() - interacting.current < 1200) return;
      void refresh();
    }, 1500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);

  const write = async (fn: () => Promise<void>, okText: string) => {
    interacting.current = Date.now();
    try {
      await fn();
      setNote(okText);
    } catch (e) {
      setNote(`写入失败：${errText(e)}`);
    }
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">{title}</h2>
        <span className="pill" style={{ marginLeft: 'auto' }}>
          {device || (capture ? '录音端点' : '播放端点')}
        </span>
      </div>

      <SliderRow
        label="音量"
        icon={capture ? Mic : Volume2}
        value={volume}
        onChange={(v) => {
          setVolume(v);
          void write(() => tauriSetAudioVolume(capture, v / 100), '已写入真实音量');
        }}
        suffix="%"
        ariaLabel={capture ? '麦克风音量' : '播放音量'}
        hint={note ?? '直接作用于端点音量（与系统音量面板同源）'}
      />

      <hr className="divider" />

      {channels >= 2 ? (
        <SliderRow
          label="平衡"
          value={balance}
          min={0}
          max={100}
          onChange={(v) => {
            setBalance(v);
            const [l, r] = balanceToChannels(v);
            void write(() => tauriSetAudioBalance(capture, l, r), `已写入平衡 左${Math.round(l * 100)}% / 右${Math.round(r * 100)}%`);
          }}
          formatValue={(v) => (v === 50 ? '居中' : `左 ${100 - v}% · 右 ${v}%`)}
          ariaLabel="左右声道平衡"
        />
      ) : (
        <p className="field__hint">当前端点声道数不足 2，不提供左右平衡。</p>
      )}

      <hr className="divider" />

      <SwitchRow
        label="静音"
        icon={capture ? MicOff : VolumeX}
        checked={muted}
        onChange={(v) => {
          setMuted(v);
          void write(() => tauriSetAudioMute(capture, v), v ? '已静音' : '已取消静音');
        }}
      />
    </section>
  );
}
