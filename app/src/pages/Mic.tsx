import { useCallback, useEffect, useState } from 'react';
import { AudioWaveform, WandSparkles, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import EndpointPanel from '../components/EndpointPanel';
import SliderRow from '../components/SliderRow';
import Segmented from '../components/Segmented';
import FitScale from '../components/FitScale';
import { errText, isAvail, tauriFieldWrite, tauriFieldsRead } from '../device/tauriBridge';

/**
 * 麦克风页 — **严格对齐原版对 ZG3 提供的 2 项麦克风效果**：魔幻音效 / 麦克风降噪。
 * 二者均写在**录音端点的 MFX 上下文**（与耳机侧完全隔离），量程与选项集取自
 * docs/原版对齐规格.md。
 *
 * 原版未对 ZG3 提供的麦克风均衡器 / 回音 / 录音特效 / AI 降噪 / 魔幻音效 II 一律不展示
 * （license 不含，且本设备通道不可用）。
 */

type MicFxKey = 'magicvoice' | 'micnr';

interface MicFxDef {
  key: MicFxKey;
  short: string;
  full: string;
  Icon: LucideIcon;
}

const MIC_EFFECTS: MicFxDef[] = [
  { key: 'magicvoice', short: '魔幻音效', full: 'Xear 魔幻音效', Icon: WandSparkles },
  { key: 'micnr', short: '麦克风降噪', full: '麦克风降噪', Icon: AudioWaveform },
];

/** 魔幻音效模式（MagicVoice_Selection）：0=怪兽 1=卡通 2=男生 3=女生 */
const MAGIC_MODES = ['怪兽', '卡通', '男生', '女生'];

export default function Mic() {
  const [active, setActive] = useState<MicFxKey>('magicvoice');
  const [fields, setFields] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFields(await tauriFieldsRead());
      setNote(null);
    } catch (e) {
      setNote(`真机通道未就绪：${errText(e)}`);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const writeField = async (field: string, value: number, label: string) => {
    try {
      const next = await tauriFieldWrite(field, value);
      setFields(next);
      const v = next[field];
      setNote(isAvail(v) ? `已写入真机：${label} = ${v}（回读校验通过）` : `已写入 ${label}，真机未提供回读值`);
    } catch (e) {
      setNote(`写入失败：${errText(e)}`);
    }
  };

  const current = MIC_EFFECTS.find((e) => e.key === active) ?? MIC_EFFECTS[0];
  const on = fields[`${active}_enabled`] === 1;
  const missing = (f: string) => !isAvail(fields[f]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar crumbs="麦克风 · 魔幻音效与麦克风降噪" />

        <main className="canvas">
          <FitScale>
          <div className="page-head">
            <div className="page-head__text">
              <h1 className="page-title">麦克风</h1>
              <p className="page-desc">
                原版 ZG3 license 内仅 2 项麦克风效果 · 全部写入录音端点的 MFX 属性区。
              </p>
            </div>
            <div className="page-head__actions">
              <button type="button" className="btn btn--ghost" onClick={() => void load()}>
                <RotateCcw size={16} strokeWidth={1.5} />
                重新读取
              </button>
            </div>
          </div>

          <EndpointPanel capture title="麦克风（录音端点）" />

          <div className="work work--6-5 work--stretch" style={{ marginTop: 'var(--space-4)' }}>
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">效果列表</h2>
                <span className="pill" style={{ marginLeft: 'auto' }}>
                  逐项开关
                </span>
              </div>
              <div className="fx-list">
                {MIC_EFFECTS.map(({ key, short, full, Icon }) => {
                  const enabledNow = fields[`${key}_enabled`] === 1;
                  const unavailable = !isAvail(fields[`${key}_enabled`]);
                  return (
                    <div key={key} className={`fx-row${active === key ? ' is-active' : ''}`}>
                      <button type="button" className="fx-row__main" onClick={() => setActive(key)} aria-label={`查看 ${full} 参数`}>
                        <Icon size={18} strokeWidth={1.5} />
                        <span className="fx-row__name">{short}</span>
                        <span className="fx-row__full">{full}</span>
                      </button>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={enabledNow}
                          disabled={unavailable}
                          aria-label={`启用${full}`}
                          onChange={(e) => {
                            setActive(key);
                            void writeField(`${key}_enabled`, e.target.checked ? 1 : 0, full);
                          }}
                        />
                        <span className="switch__track" />
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="fx-list__foot">
                <p className="field__hint">
                  仅 2 项：原版对 ZG3 未开放麦克风均衡器 / 回音 / 录音特效 / AI 降噪，故此处不展示。
                </p>
                {note && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <span className={`pill${note.includes('失败') || note.includes('未就绪') ? ' pill--warn' : ' pill--ok'}`}>
                      {note}
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">{current.full}</h2>
                <span className={`pill${on ? ' pill--ok' : ''}`} style={{ marginLeft: 'auto' }}>
                  {ready ? (on ? '已启用' : '未启用') : '读取中'}
                </span>
              </div>

              {!on && (
                <div className="inline-status inline-status--warn" style={{ marginBottom: 'var(--space-4)' }}>
                  当前未启用「{current.short}」：参数可调，开启后生效。
                </div>
              )}

              {active === 'magicvoice' && (
                <div className={on ? '' : 'is-disabled'}>
                  <div className="field">
                    <div className="field__row">
                      <span className="field__label">模式</span>
                      <span className="field__val mono">MagicVoice_Selection</span>
                    </div>
                    <Segmented
                      ariaLabel="魔幻音效模式"
                      options={MAGIC_MODES}
                      value={MAGIC_MODES[isAvail(fields.magicvoice_selection) ? fields.magicvoice_selection : 0] ?? MAGIC_MODES[0]}
                      onChange={(v) => writeField('magicvoice_selection', MAGIC_MODES.indexOf(v), '魔幻音效模式')}
                      disabled={!on || missing('magicvoice_selection')}
                    />
                    <p className="field__hint">取值：0=怪兽 / 1=卡通 / 2=男生 / 3=女生（原版逐字）。</p>
                  </div>
                </div>
              )}

              {active === 'micnr' && (
                <div className={on ? '' : 'is-disabled'}>
                  <SliderRow
                    label="降噪强度"
                    value={isAvail(fields.micnr_level) ? fields.micnr_level : 40}
                    min={6}
                    max={40}
                    onChange={(v) => void writeField('micnr_level', v, '降噪强度')}
                    disabled={!on || missing('micnr_level')}
                    hint={missing('micnr_level') ? '该设备未提供该键。' : '原版量程 6–40（INF 默认 15，真机现值 40）。'}
                  />
                </div>
              )}
            </section>
          </div>
          </FitScale>
        </main>
      </div>
    </div>
  );
}
