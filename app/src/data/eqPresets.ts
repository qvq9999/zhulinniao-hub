/**
 * EQ 预设数据 — 取自**原版实际使用的那份配置**，非推测。
 *
 * ⚠️ 关键取证结论（2026-10-17 修正，修正了此前用错文件的错误）：
 * 原版 `EffectControl.RebuildEffectPanel` 对 `CLC_Equalizer10Bands` **固定使用旧视图**
 * `new EQControlOld(...)` → `EQViewModelOld` → 加载
 * **`UI/Configs/EQPreset.json`**（字段 `EQValues`，**只有 10 段增益**）。
 *
 * 新视图 `EQControl` / `EQViewModel` 才用 `EQ2Preset.json`（含频率/Q/滤波），
 * 但那条代码路径在本产品里**不会被走到**。两份文件数值不同：
 *   例如第 0 组：EQPreset.json = [0,1,1,2,2,3,2,1,0,-1]；EQ2Preset.json = 全 0。
 * 真机注册表里出现的正是 EQPreset.json 的行（曾读到第 4 行 [-4,-3,-2,0,1,2,3,4,2,1]、
 * 第 0 行 [0,1,1,2,2,3,2,1,0,-1]），可交叉印证原版用的就是这份。
 *
 * 旧视图只写 `EQ_Slider1..10`（增益），**不碰频率 / Q / 滤波**；
 * 预设命中判定 `CheckEQValueIsModed` 也是**只比 10 段增益**。
 * 因此这里同样只存/只比增益，应用预设时也只写增益，不覆盖其它三个数组。
 */

export interface EqPreset {
  name: string;
  /** 10 段增益 dB（原版量程 -20..20，0 dB 居中） */
  gains: number[];
}

/** 10 段频点（原版旧均衡器面板刻印：31Hz…16kHz） */
export const EQ_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_BAND_LABELS = ['31Hz', '63Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];

/**
 * 12 组预设 —— 逐字取自 `UI/Configs/EQPreset.json`（与原版
 * `EQViewModelOld.cmediaEQPresetValue` 首次生成的兜底表同源同值）。
 * 名称顺序取自 zh-CN\SoundEffect\EQ.xaml 的 ToolTip_RadioButton_00..11。
 */
export const EQ_PRESETS: EqPreset[] = [
  { name: '3A通用', gains: [0, 1, 1, 2, 2, 3, 2, 1, 0, -1] },
  { name: '无畏契约', gains: [-4, -3, -2, 0, 2, 4, 5, 3, 1, 0] },
  { name: '三角洲烽火', gains: [-3, -2, 0, 3, 2, 4, 5, 3, 1, 0] },
  { name: '三角洲全面', gains: [-3, -2, -1, 4, 3, 5, 6, 4, 2, 0] },
  { name: 'PUBG', gains: [-4, -3, -2, 0, 1, 2, 3, 4, 2, 1] },
  { name: 'CS2', gains: [-3, -2, 0, 1, 3, 5, 5, 4, 2, 0] },
  { name: 'CF', gains: [-5, -4, -3, 0, 5, 6, 5, 3, 1, 0] },
  { name: 'APEX', gains: [-4, -3, 0, 3, 2, 5, 5, 3, 1, 0] },
  { name: '和平精英', gains: [-3, -2, 2, 0, 0, 3, 3, 2, -1, -4] },
  { name: '暗区突围', gains: [-2, 0, 1, 3, 2, 4, 3, 2, 0, -1] },
  { name: '永劫无间', gains: [-4, -4, 0, 2, 3, 4, 5, 4, 2, 0] },
  { name: '守望先锋', gains: [-4, -3, 0, 4, 3, 5, 6, 4, 2, 0] },
];

const sameGains = (a: number[] | undefined, b: number[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** 与原版 `CheckEQValueIsModed` 一致：只比 10 段增益，全等才算命中 */
export function matchPresetName(gains: number[]): string | null {
  const hit = EQ_PRESETS.find((p) => sameGains(p.gains, gains));
  return hit ? hit.name : null;
}

/** 与原版 `CheckEQValueIsCustom` 一致：自定义预设同样只比增益，返回命中的下标 */
export function matchCustomState(list: { gains: number[] }[], gains: number[]): number {
  return list.findIndex((c) => sameGains(c.gains, gains));
}
