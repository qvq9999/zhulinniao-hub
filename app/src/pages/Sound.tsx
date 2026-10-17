import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Waves,
  Sun,
  Orbit,
  AudioLines,
  Volume2,
  Radio,
  SlidersHorizontal,
  Save,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import EqFaders from '../components/EqFaders';
import SliderRow from '../components/SliderRow';
import Segmented from '../components/Segmented';
import FitScale from '../components/FitScale';
import {
  EQ_BAND_LABELS,
  EQ_PRESETS,
  matchCustomState,
  matchPresetName,
} from '../data/eqPresets';
import { useSettingPatch } from '../state/settings';
import { errText, isAvail, tauriEqRead, tauriEqWrite, tauriFieldWrite, tauriFieldsRead } from '../device/tauriBridge';

/**
 * 音效控制页 — **严格对齐原版对 ZG3 提供的 7 项耳机效果**（原版按 license 过滤后的集合）。
 * 顺序沿用原版主窗口：均衡器 / 7.1环绕 / 音频明亮化 / 动态低频 / 智能音量 / 人声清晰化 / 环绕扩增。
 * 每项的地址、量程、选项集均取自 docs/原版对齐规格.md，全部走注册表 FxProperties 真实读写。
 */

type FxKey = 'eq' | 'surround71' | 'brilliant' | 'bass' | 'smartvol' | 'clarity' | 'surroundmax';

interface FxDef {
  key: FxKey;
  /** 原版列表短名（Effect_ShortName_*） */
  short: string;
  /** 原版完整名（ToolTip_CLC_*） */
  full: string;
  Icon: LucideIcon;
  /** 开关对应的属性字段名；均衡器走 EQ 通道，故为空 */
  enableField?: string;
}

const EFFECTS: FxDef[] = [
  { key: 'eq', short: '均衡器', full: '均衡器', Icon: SlidersHorizontal },
  { key: 'surround71', short: '7.1环绕', full: 'Xear 7.1环绕', Icon: Orbit, enableField: 'surround71_enabled' },
  { key: 'brilliant', short: '音频明亮化', full: 'Xear 音频明亮化', Icon: Sun, enableField: 'brilliant_enabled' },
  { key: 'bass', short: '动态低频', full: 'Xear 动态低频', Icon: Waves, enableField: 'bass_enabled' },
  { key: 'smartvol', short: '智能音量', full: 'Xear 智能音量', Icon: Volume2, enableField: 'smartvol_enabled' },
  { key: 'clarity', short: '人声清晰化', full: 'Xear 人声清晰化', Icon: AudioLines, enableField: 'clarity_enabled' },
  { key: 'surroundmax', short: '环绕扩增', full: 'Xear 环绕扩增', Icon: Radio, enableField: 'surroundmax_enabled' },
];

/** 7.1环绕：环绕模式（CONLAB_HPSPK_MODE）— 0=音乐/游戏，1=电影 */
const SURROUND_MODES = ['音乐 / 游戏', '电影'];
/** 7.1环绕：房间大小（CONLAB_HPSPK_ROOMSIZE）— 取值反直觉：0=大 1=中 2=小 */
const ROOM_SIZES: { value: string; label: string; raw: number }[] = [
  { value: '0', label: '大房间', raw: 0 },
  { value: '1', label: '中房间', raw: 1 },
  { value: '2', label: '小房间', raw: 2 },
];
/** 智能音量：模式（ADAPTIVEVOLUME_MODE）— 0=音乐模式，1=演说模式 */
const SMARTVOL_MODES = ['音乐模式', '演说模式'];
/** 7.1环绕声道测试（原版 8 个试听开关；试听通道待接入，先保留形态并禁用） */
const SPK_TEST = ['L', 'R', 'C', 'W', 'LS', 'RS', 'LB', 'RB'];

/** 用户自定义 EQ 预设 — 与原版旧视图 JsonEQCustomOld 一致：只存 10 段增益 */
export interface CustomEqPreset {
  name: string;
  gains: number[];
  savedAt: number;
}

interface SoundPersist {
  /** 用户自定义 EQ 预设（本地配置） */
  custom: CustomEqPreset[];
}

const DEFAULT_SOUND: SoundPersist = { custom: [] };

export default function Sound() {
  const [persist, patch] = useSettingPatch<SoundPersist>('sound', DEFAULT_SOUND);
  const customList = persist.custom ?? [];

  const [active, setActive] = useState<FxKey>('eq');
  const [fields, setFields] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // EQ 状态（真机回读为准）—— 原版旧视图只有 10 段增益，频率/Q/滤波不在此面板
  const [eqEnabled, setEqEnabled] = useState(true);
  const [gains, setGains] = useState<number[]>(EQ_PRESETS[0].gains.slice());
  const [newName, setNewName] = useState('');
  const writeTimer = useRef<number>(0);

  /**
   * 参数面板高度锁定：以「均衡器」面板的实测高度为基准，
   * 之后切到其它效果页签时面板高度保持不变，整页不会忽大忽小。
   *
   * ⚠️ 不能只在挂载时量一次：真机回读后若该效果为「未启用」，面板顶部会多出
   * 一条提示条（约 38px），一次性测量会锁定成偏小的值 → 均衡器页签比其它页签高出一截，
   * 切页签时整页缩一下（用户投诉过的「忽大忽小」）。故每次进入均衡器页签都复测，只允许向上更新。
   */
  const paramRef = useRef<HTMLElement | null>(null);
  const [paramMinH, setParamMinH] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [f, eq] = await Promise.all([tauriFieldsRead(), tauriEqRead()]);
      setFields(f);
      setEqEnabled(eq.enabled);
      setGains(eq.sliders ?? EQ_PRESETS[0].gains.slice());
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

  /** 每次进入「均衡器」页签复测面板高度（见上：只增不减，避免锁成偏小值）。
      依赖只取 active/ready：ready 与「未启用提示条」在同一次渲染中落定，够用。 */
  useEffect(() => {
    if (active !== 'eq' || !ready) return;
    const raf = window.requestAnimationFrame(() => {
      const el = paramRef.current;
      if (!el) return;
      const innerEl = document.querySelector<HTMLElement>('.fit__inner');
      const z = Number.parseFloat(innerEl?.style.zoom || '1') || 1;
      const h = Math.ceil(el.getBoundingClientRect().height / z); // 去掉 zoom 影响，得到布局高度
      if (h > 0) setParamMinH((prev) => (prev === undefined || h > prev + 1 ? h : prev));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [active, ready]);

  /** 写单个属性字段，回读全量并以真值为准 */
  const writeField = async (field: string, value: number, label: string) => {
    try {
      const next = await tauriFieldWrite(field, value);
      setFields(next);
      const v = next[field];
      setNote(isAvail(v) ? `已写入真机：${label} = ${v}（回读校验通过）` : `已写入 ${label}，但真机未提供回读值`);
    } catch (e) {
      setNote(`写入失败：${errText(e)}`);
    }
  };

  /** EQ 写入（防抖 260ms），回读结果覆盖界面。频率/Q/滤波不传（原版旧视图不碰它们） */
  const pushEq = (patch: { enabled?: boolean; gains?: number[] }) => {
    window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(async () => {
      try {
        const snap = await tauriEqWrite(
          patch.enabled ?? null,
          patch.gains ? patch.gains.map((g) => Math.round(Math.max(-20, Math.min(20, g)))) : null,
          null,
          null,
          null,
        );
        setEqEnabled(snap.enabled);
        setGains(snap.sliders);
        setNote('已写入真机 EQ（回读一致）');
      } catch (e) {
        setNote(`写入失败：${errText(e)}`);
      }
    }, 260);
  };

  const onGainsChange = (next: number[]) => {
    setGains(next);
    pushEq({ gains: next });
  };

  /**
   * 应用预置：与原版 `EQViewModelOld.SelectedPreset` setter 完全一致 ——
   * **只写回 10 段增益**（EQ_Slider1..10），不触碰频率 / Q / 滤波。
   * 数据取自 eqPresets（= 原版实际加载的 UI/Configs/EQPreset.json）。
   */
  const applyPreset = (idx: number) => {
    const g = EQ_PRESETS[idx].gains.slice();
    setGains(g);
    pushEq({ gains: g });
  };

  const resetEq = () => applyPreset(0);

  const saveCustom = () => {
    const name = newName.trim();
    if (!name) return setNote('请先输入预设名称再保存。');
    if (EQ_PRESETS.some((p) => p.name === name)) return setNote(`「${name}」与预置预设同名，请换一个名字。`);
    if (customList.some((p) => p.name === name)) return setNote(`「${name}」已存在，请换一个名字。`);
    patch({
      custom: [...customList, { name, gains: gains.slice(), savedAt: Date.now() }],
    });
    setNewName('');
    setNote(`已保存自定义预设「${name}」。`);
  };

  /** 应用自定义预设：与原版 SelectedProfile setter 一致 —— 同样只写 10 段增益 */
  const applyCustom = (item: CustomEqPreset) => {
    const g = item.gains.slice();
    setGains(g);
    pushEq({ gains: g });
  };

  const deleteCustom = (name: string) => {
    patch({ custom: customList.filter((p) => p.name !== name) });
    setNote(`已删除自定义预设「${name}」。`);
  };

  const current = EFFECTS.find((e) => e.key === active) ?? EFFECTS[0];
  const on = active === 'eq' ? eqEnabled : fields[`${active}_enabled`] === 1;
  const lockCls = on ? '' : ' is-disabled';
  // 与原版旧视图一致：**只比 10 段增益**；先匹配 12 组预置，未命中再匹配用户自定义
  const presetName = matchPresetName(gains);
  const customHit = presetName ? -1 : matchCustomState(customList, gains);
  const matchLabel = presetName ?? (customHit >= 0 ? customList[customHit].name : '自定义');
  const missing = (f: string) => !isAvail(fields[f]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar crumbs="音效控制 · 耳机效果" />

        <main className="canvas">
          <FitScale>
          <div className="page-head">
            <div className="page-head__text">
              <h1 className="page-title">音效控制</h1>
              <p className="page-desc">
                耳机 7 项效果（原版 ZG3 license 内）· 逐项开启后调参数 · 全部读写驱动属性区。
              </p>
            </div>
            <div className="page-head__actions">
              <button type="button" className="btn btn--ghost" onClick={() => void load()}>
                <RotateCcw size={16} strokeWidth={1.5} />
                重新读取
              </button>
            </div>
          </div>

          <div className="work work--6-5 work--stretch" style={{ marginTop: 'var(--space-4)' }}>
            {/* 效果列表：每项独立开关（原版 CheckBox_EffectListSwitch） */}
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">效果列表</h2>
                <span className="pill" style={{ marginLeft: 'auto' }}>
                  逐项开关
                </span>
              </div>
              <div className="fx-list">
                {EFFECTS.map(({ key, short, full, Icon, enableField }) => {
                  const enabledNow = key === 'eq' ? eqEnabled : fields[`${key}_enabled`] === 1;
                  const unavailable = key !== 'eq' && !isAvail(fields[`${key}_enabled`]);
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
                            const v = e.target.checked;
                            setActive(key);
                            if (key === 'eq') {
                              setEqEnabled(v);
                              pushEq({ enabled: v, gains });
                            } else if (enableField) {
                              void writeField(enableField, v ? 1 : 0, full);
                            }
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
                  共 7 项，与原版 ZG3 实际提供的一致（名称取自 zh-CN\SoundEffect\SoundEffectSwitch.xaml）。
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

            {/* 参数面板：高度锁定为「均衡器」面板的高度，切换效果页签时整页尺寸不变 */}
            <section className="panel" ref={paramRef} style={{ minHeight: paramMinH }}>
              <div className="panel__head">
                <h2 className="panel__title">{current.full}</h2>
                <span className={`pill${on ? ' pill--ok' : ''}`} style={{ marginLeft: 'auto' }}>
                  {ready ? (on ? '已启用' : '未启用') : '读取中'}
                </span>
              </div>

              {!on && (
                <div className="inline-status inline-status--warn" style={{ marginBottom: 'var(--space-4)' }}>
                  当前未启用「{current.short}」：参数可调，开启后生效（与原版一致）。
                </div>
              )}

              {/* ---------- 均衡器 ---------- */}
              {active === 'eq' && (
                <div>
                  {/* 预置：原版是 12 个单选按钮（EQ.xaml RadioButton_00..11），此处同样平铺成按钮 */}
                  <div className="eq-preset-head">
                    <span className="eq-inputs-head__t">预置</span>
                    <span className="eq-inputs-head__u">
                      {presetName || customHit >= 0 ? `当前匹配：${matchLabel}` : '当前匹配：自定义'}
                    </span>
                  </div>
                  <div className="eq-presets" role="group" aria-label="均衡预置">
                    {EQ_PRESETS.map((p, i) => (
                      <button
                        key={p.name}
                        type="button"
                        className={`eq-preset${presetName === p.name ? ' is-active' : ''}`}
                        aria-pressed={presetName === p.name ? 'true' : 'false'}
                        onClick={() => applyPreset(i)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>

                  <EqFaders labels={EQ_BAND_LABELS} gains={gains} onChange={onGainsChange} height={240} />

                  <p className="field__hint">
                    每段一根推子，上下拖动单独调整该段增益（±20 dB，1 dB 步进）；键盘 ↑/↓ 微调、Shift 5 dB、Home 归零。
                    12 组预设取自原版 cmediaEQPresetGain，应用预设会像原版一样同时写回增益 / 频率 / Q / 滤波四个数组。
                  </p>

                  <hr className="divider" />

                  <div className="custom-eq">
                    <div className="custom-eq__head">
                      <span className="custom-eq__title">用户自定义</span>
                      <div className="custom-eq__save">
                        <input
                          type="text"
                          value={newName}
                          placeholder="给当前曲线起个名字"
                          aria-label="自定义预设名称"
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveCustom();
                          }}
                        />
                        <button type="button" className="btn btn--secondary" onClick={saveCustom}>
                          <Save size={16} strokeWidth={1.5} />
                          保存当前曲线
                        </button>
                      </div>
                    </div>
                    {customList.length === 0 ? (
                      <p className="field__hint">还没有自定义预设。调好曲线后在上方输入名称并点「保存当前曲线」。</p>
                    ) : (
                      <ul className="custom-eq__list">
                        {customList.map((item, idx) => (
                          <li key={item.name}>
                            <button
                              type="button"
                              className={`custom-eq__item${customHit === idx ? ' is-active' : ''}`}
                              onClick={() => applyCustom(item)}
                              aria-label={`应用自定义预设 ${item.name}`}
                            >
                              <span className="custom-eq__name">{item.name}</span>
                              <span className="custom-eq__vals mono">[{item.gains.join(', ')}]</span>
                            </button>
                            <button
                              type="button"
                              className="custom-eq__del"
                              onClick={() => deleteCustom(item.name)}
                              aria-label={`删除自定义预设 ${item.name}`}
                            >
                              <Trash2 size={16} strokeWidth={1.5} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
                    <button type="button" className="btn btn--ghost" onClick={resetEq}>
                      <RotateCcw size={16} strokeWidth={1.5} />
                      恢复默认（全 0）
                    </button>
                  </div>
                </div>
              )}

              {/* ---------- 7.1环绕 ---------- */}
              {active === 'surround71' && (
                <div className={lockCls}>
                  <div className="field">
                    <div className="field__row">
                      <span className="field__label">环绕模式</span>
                      <span className="field__val mono">CONLAB_HPSPK_MODE</span>
                    </div>
                    <Segmented
                      ariaLabel="环绕模式"
                      options={SURROUND_MODES}
                      value={SURROUND_MODES[isAvail(fields.surround71_mode) ? fields.surround71_mode : 0] ?? SURROUND_MODES[0]}
                      onChange={(v) => writeField('surround71_mode', SURROUND_MODES.indexOf(v), '环绕模式')}
                      disabled={!on}
                    />
                  </div>
                  <hr className="divider" />
                  <div className="field">
                    <div className="field__row">
                      <span className="field__label">房间大小</span>
                      <span className="field__val mono">CONLAB_HPSPK_ROOMSIZE</span>
                    </div>
                    <Segmented
                      ariaLabel="房间大小"
                      options={ROOM_SIZES.map((r) => r.label)}
                      value={ROOM_SIZES.find((r) => r.raw === fields.surround71_roomsize)?.label ?? '小房间'}
                      onChange={(v) => {
                        const hit = ROOM_SIZES.find((r) => r.label === v);
                        if (hit) void writeField('surround71_roomsize', hit.raw, '房间大小');
                      }}
                      disabled={!on}
                    />
                    <p className="field__hint">取值取自原版控件 switch（0=大房间 / 1=中房间 / 2=小房间）。</p>
                  </div>
                  <hr className="divider" />
                  <div className="field">
                    <div className="field__row">
                      <span className="field__label">声道测试</span>
                      <span className="field__val mono">8 声道</span>
                    </div>
                    <div className="spk-test">
                      {SPK_TEST.map((s) => (
                        <button key={s} type="button" className="spk-test__btn" disabled aria-label={`试听 ${s} 声道`}>
                          {s}
                        </button>
                      ))}
                    </div>
                    <p className="field__hint">
                      原版试听走 XearSDK CmPlayAudio；该通道在本机不可用（SDK 枚举不到端点），故先保留形态并禁用，
                      不假装可播放。
                    </p>
                  </div>
                </div>
              )}

              {/* ---------- 音频明亮化 ---------- */}
              {active === 'brilliant' && (
                <div className={lockCls}>
                  <SliderRow
                    label="明亮等级"
                    value={isAvail(fields.brilliant_level) ? fields.brilliant_level : 3}
                    min={0}
                    max={10}
                    onChange={(v) => void writeField('brilliant_level', v, '明亮等级')}
                    disabled={!on || missing('brilliant_level')}
                    hint={missing('brilliant_level') ? '该设备未提供明亮等级键（真机读取为缺失），无法调整。' : '原版量程 0–10，默认 3。'}
                  />
                </div>
              )}

              {/* ---------- 动态低频 ---------- */}
              {active === 'bass' && (
                <div className={lockCls}>
                  <SliderRow
                    label="低频等级"
                    value={isAvail(fields.bass_level) ? fields.bass_level : 5}
                    min={0}
                    max={10}
                    onChange={(v) => void writeField('bass_level', v, '低频等级')}
                    disabled={!on || missing('bass_level')}
                    hint={missing('bass_level') ? '该设备未提供该键。' : '原版量程 0–10，真机现值 5。'}
                  />
                  <hr className="divider" />
                  <SliderRow
                    label="低音频段截取"
                    value={isAvail(fields.bass_cutoff) ? fields.bass_cutoff : 200}
                    min={100}
                    max={400}
                    onChange={(v) => void writeField('bass_cutoff', v, '低音频段截取频率')}
                    suffix=" Hz"
                    disabled={!on || missing('bass_cutoff')}
                    hint={missing('bass_cutoff') ? '该设备未提供该键。' : '原版量程 100–400 Hz，默认 200。'}
                  />
                </div>
              )}

              {/* ---------- 智能音量 ---------- */}
              {active === 'smartvol' && (
                <div className={lockCls}>
                  <SliderRow
                    label="等级"
                    value={isAvail(fields.smartvol_level) ? fields.smartvol_level : 50}
                    min={0}
                    max={100}
                    onChange={(v) => void writeField('smartvol_level', v, '智能音量等级')}
                    disabled={!on || missing('smartvol_level')}
                    hint={missing('smartvol_level') ? '该设备未提供该键。' : '原版量程 0–100，默认 50。'}
                  />
                  <hr className="divider" />
                  <div className="field">
                    <div className="field__row">
                      <span className="field__label">模式</span>
                      <span className="field__val mono">0=音乐模式（高动态）· 1=演说模式（低动态）</span>
                    </div>
                    <Segmented
                      ariaLabel="智能音量模式"
                      options={SMARTVOL_MODES}
                      value={SMARTVOL_MODES[isAvail(fields.smartvol_mode) ? fields.smartvol_mode : 0] ?? SMARTVOL_MODES[0]}
                      onChange={(v) => writeField('smartvol_mode', SMARTVOL_MODES.indexOf(v), '智能音量模式')}
                      disabled={!on}
                    />
                  </div>
                </div>
              )}

              {/* ---------- 人声清晰化 ---------- */}
              {active === 'clarity' && (
                <div className={lockCls}>
                  <SliderRow
                    label="清晰化等级"
                    value={isAvail(fields.clarity_level) ? fields.clarity_level : 3}
                    min={0}
                    max={10}
                    onChange={(v) => void writeField('clarity_level', v, '清晰化等级')}
                    disabled={!on || missing('clarity_level')}
                    hint={missing('clarity_level') ? '该设备未提供该键。' : '原版量程 0–10，默认 3。'}
                  />
                  <hr className="divider" />
                  <SliderRow
                    label="通话噪音抑制"
                    value={isAvail(fields.clarity_ns) ? fields.clarity_ns : 0}
                    min={0}
                    max={20}
                    onChange={(v) => void writeField('clarity_ns', v, '通话噪音抑制')}
                    disabled={!on || missing('clarity_ns')}
                    hint={missing('clarity_ns') ? '该设备未提供该键。' : '原版量程 0–20。'}
                  />
                </div>
              )}

              {/* ---------- 环绕扩增 ---------- */}
              {active === 'surroundmax' && (
                <p className="field__hint">
                  环绕扩增无额外参数：仅一个启用开关（Enable_Channel_COPY_LFX）。开启后把立体声扩展到环绕声道。
                </p>
              )}
            </section>
          </div>
          </FitScale>
        </main>
      </div>
    </div>
  );
}
