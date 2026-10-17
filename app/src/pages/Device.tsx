import { useCallback, useEffect, useState } from 'react';
import {
  Languages,
  SunMoon,
  Power,
  Info,
  Copy,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import SwitchRow from '../components/SwitchRow';
import Segmented from '../components/Segmented';
import FitScale from '../components/FitScale';
import { useDevice } from '../device/DeviceContext';
import {
  errText,
  tauriDeviceDetails,
  tauriGetAutostart,
  tauriSetAutostart,
  tauriSetDefault,
  type DeviceDetailsDto,
} from '../device/tauriBridge';

/**
 * 信息页 — 对齐原版「装置设置及信息」（JackSetting）+「信息」（Information）窗口：
 *   - 装置信息：装置名称 / 固件版本 / 硬件驱动版本（真实读取）
 *     ⚠️ 语言文件里的「编解码器名称」在原版 XAML 中**没有对应的值标签**（JackSetting.xaml 只有 3 行），
 *        属未使用残留，故此处同样不展示，避免显示不存在的信息。
 *   - 装置格式：IAudioClient::GetMixFormat 真实读取（只读，原版支持切换但我们无写入通道）
 *   - 默认装置设置：默认装置 / 默认通讯装置（真实可写）
 *   - 音频装置列表：播放 / 录音端点真实枚举
 *   - 通用设置：语言 / 主题 / 开机自启动
 */

type ThemeVal = 'light' | 'dark' | 'system';

const fmtFormat = (d: DeviceDetailsDto | null): string => {
  if (!d || !d.sample_rate) return '未提供';
  return `${d.sample_rate} Hz · ${d.bits_per_sample} bit · ${d.channels} 声道`;
};

export default function Device() {
  const { info } = useDevice();
  const [details, setDetails] = useState<DeviceDetailsDto | null>(null);
  const [detailsNote, setDetailsNote] = useState<string | null>(null);
  const [language, setLanguage] = useState('简体中文');
  const [theme, setTheme] = useState<ThemeVal>('light');
  const [autorun, setAutorun] = useState(false);
  const [autostartNote, setAutostartNote] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const loadDetails = useCallback(async () => {
    try {
      setDetails(await tauriDeviceDetails());
      setDetailsNote(null);
    } catch (e) {
      setDetailsNote(`读取失败：${errText(e)}`);
    }
  }, []);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await tauriGetAutostart();
        if (!cancelled) setAutorun(v);
      } catch {
        if (!cancelled) setAutostartNote('仅桌面版可用（当前为浏览器预览）');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onAutostartChange = async (next: boolean) => {
    try {
      await tauriSetAutostart(next);
      const real = await tauriGetAutostart();
      setAutorun(real);
      setAutostartNote(real ? '已写入系统启动项（真实生效）' : '已移除系统启动项（真实生效）');
    } catch (e) {
      setAutostartNote(`设置失败：${errText(e)}`);
    }
  };

  const onSetDefault = async (communication: boolean) => {
    try {
      await tauriSetDefault(communication);
      await loadDetails();
      setDetailsNote(communication ? '已设为默认通讯装置' : '已设为默认装置');
    } catch (e) {
      setDetailsNote(`设置失败：${errText(e)}`);
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else if (theme === 'light') root.removeAttribute('data-theme');
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }, [theme]);

  const copySerial = () => {
    if (info?.serial && navigator.clipboard) navigator.clipboard.writeText(info.serial).catch(() => {});
    setToastVisible(true);
    window.setTimeout(() => setToastVisible(false), 2000);
  };

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar crumbs="信息 · 装置设置及信息" />

        <main className="canvas">
          <FitScale>
          <div className="page-head">
            <div className="page-head__text">
              <h1 className="page-title">信息</h1>
              <p className="page-desc">装置设置及信息、默认装置与通用设置。</p>
            </div>
            <div className="page-head__actions">
              <button type="button" className="btn btn--ghost" onClick={() => void loadDetails()}>
                <RefreshCw size={16} strokeWidth={1.5} />
                重新读取
              </button>
            </div>
          </div>

          {/* 装置信息（原版 Label_DeviceName / Label_FirmwareVer / Label_DriverVer） */}
          <section className="panel" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="panel__head">
              <h2 className="panel__title">装置信息</h2>
              <span className="pill" style={{ marginLeft: 'auto' }}>
                真实读取
              </span>
            </div>
            <dl className="info-grid">
              <div>
                <dt>装置名称</dt>
                <dd>{details?.name || info?.name || '未提供'}</dd>
              </div>
              <div>
                <dt>固件版本</dt>
                <dd className="mono">{details?.firmware_version || '未提供'}</dd>
              </div>
              <div>
                <dt>硬件驱动版本</dt>
                <dd className="mono">{details?.driver_version || '未提供'}</dd>
              </div>
              <div>
                <dt>驱动描述</dt>
                <dd>{details?.driver_desc ? `${details.driver_desc}${details.provider ? `（${details.provider}）` : ''}` : '未提供'}</dd>
              </div>
              <div>
                <dt>装置格式</dt>
                <dd className="mono">{fmtFormat(details)}</dd>
              </div>
              <div>
                <dt>序列号</dt>
                <dd className="copy-row">
                  <span className="mono">{info?.serial ?? '设备未上报'}</span>
                  {info?.serial && (
                    <button type="button" aria-label="复制序列号" onClick={copySerial}>
                      <Copy size={16} strokeWidth={1.5} />
                    </button>
                  )}
                </dd>
              </div>
            </dl>
            <p className="field__hint">
              固件版本 = 原版 USBRevisionNumber（硬件 ID 的 REV_xxxx）；硬件驱动版本取自系统设备注册表
              Control\Class 的 DriverVersion。原版由厂商 SDK 提供，本机 SDK 枚举不到端点，故改走等价的
              Windows 真实来源。原版 UI 并不显示「编解码器名称」（语言文件残留），此处同样不展示。
            </p>
            {detailsNote && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <span className={`pill${detailsNote.includes('失败') ? ' pill--warn' : ' pill--ok'}`}>
                  {detailsNote}
                </span>
              </div>
            )}
          </section>

          {/* 默认装置设置（通栏，两行并排） */}
          <section className="panel" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="panel__head">
              <h2 className="panel__title">默认装置设置</h2>
              <span className="pill" style={{ marginLeft: 'auto' }}>
                系统默认端点
              </span>
            </div>
            <div className="radio-list radio-list--row">
              <label className="radio-row">
                <input
                  type="radio"
                  name="default-device"
                  checked={!!details?.is_default}
                  onChange={() => void onSetDefault(false)}
                />
                <span className="radio-row__name">默认装置</span>
                <span className="radio-row__scene">设为系统默认播放装置</span>
              </label>
              <label className="radio-row">
                <input
                  type="radio"
                  name="default-device"
                  checked={!!details?.is_default_communication}
                  onChange={() => void onSetDefault(true)}
                />
                <span className="radio-row__name">默认通讯装置</span>
                <span className="radio-row__scene">设为系统默认通讯装置</span>
              </label>
            </div>
            <p className="field__hint">调用系统默认端点设置接口后立即回读核对（不乐观更新）。</p>
          </section>

          {/* 通用设置（通栏四格） */}
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">通用设置</h2>
            </div>
            <div className="settings-row">
              <div className="settings-cell">
                <div className="field__row">
                  <Languages size={16} strokeWidth={1.5} />
                  <span className="field__label">语言</span>
                </div>
                <div className="select" style={{ maxWidth: 200 }}>
                    <select aria-label="界面语言" value={language} onChange={(e) => setLanguage(e.target.value)}>
                      <option>简体中文</option>
                    </select>
                    <ChevronDown size={16} strokeWidth={1.5} />
                  </div>
                  <p className="field__hint">原版含 16 种语言资源；当前仅提供简体中文。</p>
                </div>

                <div className="settings-cell">
                  <div className="field__row">
                    <SunMoon size={16} strokeWidth={1.5} />
                    <span className="field__label">主题</span>
                  </div>
                  <Segmented
                    ariaLabel="界面主题"
                    options={[
                      { value: 'light', label: '浅色' },
                      { value: 'dark', label: '深色' },
                      { value: 'system', label: '跟随系统' },
                    ]}
                    value={theme}
                    onChange={(v) => setTheme(v as ThemeVal)}
                  />
                  <p className="field__hint">仅切换界面配色，不影响音频效果。</p>
                </div>

                <div className="settings-cell">
                  <SwitchRow
                    label="开机自启动"
                    icon={Power}
                    checked={autorun}
                    onChange={onAutostartChange}
                    hint={autostartNote ?? '写入系统启动项（注册表 Run），开机后自动启动本软件。'}
                  />
                </div>

                <div className="settings-cell">
                  <div className="field__row">
                    <Info size={18} strokeWidth={1.5} style={{ color: 'var(--muted)' }} />
                    <span className="field__label">关于朱雀耳机 Hub</span>
                  </div>
                  <p className="field__hint">版本 0.1.0 · UI 重置版（功能与选项集严格对齐原版 ZG3）</p>
                </div>
            </div>
          </section>
          </FitScale>
        </main>
      </div>
      {toastVisible && <div className="toast is-visible">已复制序列号</div>}
    </div>
  );
}
