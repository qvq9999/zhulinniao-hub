import { useEffect, useRef, useState } from 'react';

interface Props {
  /** 显示刻度下限（dBFS，默认 -60） */
  floorDb?: number;
}

/**
 * 实时输入电平表 — 真实数据来源：
 * navigator.mediaDevices.getUserMedia + WebAudio AnalyserNode 实时采样 RMS，
 * 换算为 dBFS 显示。未授权 / 无输入设备时显示真实原因，不显示任何假数值。
 *
 * 紧凑横条形态：高度约 10px，与 dBFS 读数同行，避免在面板里占掉大块纵向空间。
 */
export default function MicMeter({ floorDb = -60 }: Props) {
  const [pct, setPct] = useState(0);
  const [peakPct, setPeakPct] = useState(0);
  const [db, setDb] = useState<number | null>(null);
  const [err, setErr] = useState<string>('');

  const rafRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peakHold = useRef(0);
  const peakAt = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr('当前环境不支持音频采集');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          // 显示真实 dBFS（数字静音记 -100）；仅进度条宽度按 floorDb 截断
          const dbfs = rms > 0 ? 20 * Math.log10(rms) : -100;
          const display = Math.max(-100, Math.min(0, dbfs));
          setDb(display);
          const level = (Math.max(floorDb, display) - floorDb) / (0 - floorDb);
          setPct(Math.round(level * 100));

          // 峰值保持 1.2s 后回落
          const now = Date.now();
          if (level >= peakHold.current) {
            peakHold.current = level;
            peakAt.current = now;
          } else if (now - peakAt.current > 1200) {
            peakHold.current = Math.max(level, peakHold.current - 0.02);
          }
          setPeakPct(Math.round(peakHold.current * 100));

          rafRef.current = window.requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string }).name;
        setErr(
          name === 'NotAllowedError'
            ? '未授权麦克风，无法显示电平'
            : name === 'NotFoundError'
              ? '未找到录音设备'
              : '电平采集不可用',
        );
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close().catch(() => undefined);
    };
  }, [floorDb]);

  if (err) {
    return (
      <div className="micmeter">
        <span className="micmeter__err" title={err}>
          {err}
        </span>
      </div>
    );
  }

  return (
    <div className="micmeter" role="group" aria-label="实时输入电平">
      <div className="micmeter__track">
        <div className="micmeter__fill" style={{ width: `${pct}%` }} />
        <div className="micmeter__peak" style={{ left: `${peakPct}%` }} />
      </div>
      <span className="micmeter__val mono">{db === null ? '采样中…' : `${db.toFixed(1)} dBFS`}</span>
    </div>
  );
}
