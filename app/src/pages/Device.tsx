import { useCallback, useEffect, useState } from 'react';
import {
  Languages,
  SunMoon,
  Power,
  X,
  Copy,
  RefreshCw,
  ChevronDown,
  Github,
  DownloadCloud,
  CheckCircle2,
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import SwitchRow from '../components/SwitchRow';
import Segmented from '../components/Segmented';
import FitScale from '../components/FitScale';
import { useDevice } from '../device/DeviceContext';
import { useSetting } from '../state/settings';
import { useSettle } from '../state/useSettle';
import { THEME_FALLBACK, THEME_KEY, type ThemeVal } from '../state/theme';
import {
  errText,
  onUpdateProgress,
  tauriAppVersion,
  tauriDeviceDetails,
  tauriGetAutostart,
  tauriSetAutostart,
  tauriSetDefault,
  tauriUpdateCheck,
  tauriUpdateDownload,
  tauriUpdateInstall,
  type CloseAction,
  type DeviceDetailsDto,
  type UpdateInfo,
} from '../device/tauriBridge';

/**
 * 设置页（原「信息」页，按用户要求改名）—
 * 对齐原版「装置设置及信息」（JackSetting）+「信息」（Information）窗口，并承载本产品自身的窗口行为设置：
 *   - 装置信息：装置名称 / 固件版本 / 硬件驱动版本（真实读取）
 *     ⚠️ 语言文件里的「编解码器名称」在原版 XAML 中**没有对应的值标签**（JackSetting.xaml 只有 3 行），
 *        属未使用残留，故此处同样不展示，避免显示不存在的信息。
 *   - 装置格式：IAudioClient::GetMixFormat 真实读取（只读，原版支持切换但我们无写入通道）
 *   - 默认装置设置：默认装置 / 默认通讯装置（真实可写）
 *   - 通用设置：语言 / 主题 / 开机自启动 / 关闭窗口时（点 × 的行为）
 *
 * 说明：关闭策略在本页只改设置值，实际同步给后端由常驻的 CloseConfirm 组件统一完成，
 * 避免两处各写一份导致状态漂移。主题同理：本页只负责设置值，
 * 真正的 data-theme 应用由常驻的 ThemeSync 完成（见 state/theme.tsx）。
 */

const fmtFormat = (d: DeviceDetailsDto | null): string => {
  if (!d || !d.sample_rate) return '未提供';
  return `${d.sample_rate} Hz · ${d.bits_per_sample} bit · ${d.channels} 声道`;
};

export default function Device() {
  const { info } = useDevice();
  const [details, setDetails] = useState<DeviceDetailsDto | null>(null);
  const [detailsNote, setDetailsNote] = useState<string | null>(null);
  const [language, setLanguage] = useState('简体中文');
  const [theme, setTheme] = useSetting<ThemeVal>(THEME_KEY, THEME_FALLBACK);
  const [autorun, setAutorun] = useState(false);
  const [autostartNote, setAutostartNote] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [closeAction, setCloseAction] = useSetting<CloseAction>('closeAction', 'ask');
  const [ready, setReady] = useState(false);
  /** 首帧静止守卫：开机自启默认为关，被真机值覆盖时不播开关过渡 */
  const settled = useSettle(ready);

  // ---- 软件更新 ----
  type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'installing' | 'error';
  const [version, setVersion] = useState('—');
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateMsg, setUpdateMsg] = useState('点「检查更新」获取 GitHub 上的最新版本与更新说明。');
  const [percent, setPercent] = useState(-1);

  useEffect(() => {
    void tauriAppVersion()
      .then(setVersion)
      .catch(() => setVersion('—'));
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onUpdateProgress((p) => {
      setPercent(p.percent);
      if (p.percent >= 0) setUpdateMsg(`正在下载更新包… ${p.percent.toFixed(0)}%`);
    }).then((fn) => {
      off = fn;
    });
    return () => off?.();
  }, []);

  const checkUpdate = async () => {
    setPhase('checking');
    setPercent(-1);
    setUpdateMsg('正在查询 GitHub 最新版本…');
    try {
      const info = await tauriUpdateCheck();
      setUpdateInfo(info);
      setVersion(info.current);
      if (info.newer) {
        setPhase('available');
        const mb = info.assetSize ? `${(info.assetSize / 1024 / 1024).toFixed(1)} MB` : '';
        setUpdateMsg(`发现新版本 ${info.latest}（当前 ${info.current}，更新包 ${mb}）`);
      } else {
        setPhase('latest');
        setUpdateMsg(`已是最新版本 ${info.current}（GitHub 最新为 ${info.latest}）`);
      }
    } catch (e) {
      setPhase('error');
      setUpdateMsg(`检查更新失败：${errText(e)}`);
    }
  };

  const runUpdate = async () => {
    if (!updateInfo) return;
    setPhase('downloading');
    setPercent(-1);
    setUpdateMsg('正在下载更新包…');
    try {
      const path = await tauriUpdateDownload(updateInfo.assetUrl, updateInfo.assetName, updateInfo.assetSize);
      setPhase('installing');
      setPercent(100);
      setUpdateMsg(
        '下载完成，正在启动安装：请在弹出的 UAC 窗口点「是」。程序会自动关闭，安装完成后自动重新打开，安装包随后自动删除。',
      );
      // 给界面一帧时间把状态渲染出来，再真正启动安装
      await new Promise((r) => setTimeout(r, 600));
      await tauriUpdateInstall(path);
    } catch (e) {
      setPhase('error');
      setUpdateMsg(`更新失败：${errText(e)}`);
    }
  };

  const updateBusy = phase === 'checking' || phase === 'downloading' || phase === 'installing';

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
      } finally {
        if (!cancelled) setReady(true);
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

  const toast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2000);
  };

  const copyText = (text: string, ok: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast(ok);
  };

  const copySerial = () => {
    if (info?.serial) copyText(info.serial, '已复制序列号');
  };

  return (
    <div className="app" data-booting={settled ? undefined : ''}>
      <Sidebar />
      <div className="main">
        <Topbar crumbs="设置 · 装置设置及信息" />

        <main className="canvas">
          <FitScale scroll>
          <div className="page-head">
            <div className="page-head__text">
              <h1 className="page-title">设置</h1>
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

          {/* 通用设置（通栏四格：语言 / 主题 / 开机自启动 / 关闭窗口时） */}
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
                  <X size={16} strokeWidth={1.5} />
                  <span className="field__label">关闭窗口时</span>
                </div>
                <Segmented
                  ariaLabel="关闭窗口时的行为"
                  options={[
                    { value: 'ask', label: '每次询问' },
                    { value: 'minimize', label: '最小化' },
                    { value: 'exit', label: '直接退出' },
                  ]}
                  value={closeAction}
                  onChange={(v) => setCloseAction(v as CloseAction)}
                />
                <p className="field__hint">
                  「最小化」= 隐藏窗口并在任务栏托盘保留图标，点图标即可恢复；「直接退出」= 立即关闭程序。
                </p>
              </div>
            </div>
          </section>

          {/* 关于与更新（版本 + 开源仓库 + 应用内更新） */}
          <section className="panel" style={{ marginTop: 'var(--space-5)' }}>
            <div className="panel__head">
              <h2 className="panel__title">关于与更新</h2>
              <span className="pill" style={{ marginLeft: 'auto' }}>
                {version} · UI 重置版
              </span>
            </div>

            <div className="about-row">
              <div className="about-row__text">
                <div className="about-row__name">朱雀耳机 Hub</div>
                <p className="field__hint" style={{ margin: 0 }}>
                  功能与选项集严格对齐原版 ZG3；已内置 C-Media 音频驱动组件，无需单独安装原版驱动。
                </p>
              </div>
              <div className="about-row__repo">
                <Github size={16} strokeWidth={1.5} />
                <span className="about-row__url mono">github.com/qvq9999/zhulinniao-hub</span>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => copyText('https://github.com/qvq9999/zhulinniao-hub', '已复制仓库地址')}
                >
                  <Copy size={16} strokeWidth={1.5} />
                  复制地址
                </button>
              </div>
            </div>

            <hr className="divider" />

            <div className="update-row">
              <div className="update-row__text">
                <div className="about-row__name">
                  软件更新
                  {phase === 'latest' && <CheckCircle2 size={15} strokeWidth={1.6} className="update-ok" />}
                </div>
                <p className="field__hint" style={{ margin: 0 }}>
                  {updateMsg}
                </p>
              </div>
              <div className="update-row__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={updateBusy}
                  onClick={() => void checkUpdate()}
                >
                  <RefreshCw
                    size={16}
                    strokeWidth={1.5}
                    style={phase === 'checking' ? { animation: 'spin 900ms linear infinite' } : undefined}
                  />
                  检查更新
                </button>
                {phase === 'available' && (
                  <button type="button" className="btn btn--primary" onClick={() => void runUpdate()}>
                    <DownloadCloud size={16} strokeWidth={1.5} />
                    下载并安装
                  </button>
                )}
              </div>
            </div>

            {phase === 'downloading' && (
              <div className="update-bar">
                <div
                  className="update-bar__fill"
                  style={{ width: `${percent < 0 ? 35 : Math.max(2, Math.min(100, percent))}%` }}
                />
              </div>
            )}

            <div className="update-notes">
              {updateInfo?.notes ? (
                <pre className="update-notes__text">{updateInfo.notes}</pre>
              ) : (
                <p className="field__hint" style={{ margin: 0 }}>
                  更新说明会显示在这里（来自 GitHub Release 的正文）。
                </p>
              )}
            </div>
          </section>
          </FitScale>
        </main>
      </div>
      {toastMsg && <div className="toast is-visible">{toastMsg}</div>}
    </div>
  );
}
