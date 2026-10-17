# 图标系统 · Lucide 语义映射表

> 全项目锁定 **Lucide** 一套图标库。描边 `1.5px`（`stroke-width="1.5"`），尺寸 **16 / 20 / 24px**。
> 禁止 emoji 作为功能图标。图标禁止出现在 UGC 之外的自定义装饰用途。

## 全局配置

```js
import { createIcons, icons } from 'lucide';
createIcons({
  icons,
  attrs: { 'stroke-width': 1.5, 'aria-hidden': 'true' },
});
```

```html
<!-- 行内 16px -->
<svg class="icon icon--16" aria-hidden="true"><use href="#i-sliders"/></svg>
<!-- 按钮内 20px -->
<svg class="icon icon--20" aria-hidden="true"><use href="#i-sliders"/></svg>
<!-- 独立 24px -->
<svg class="icon icon--24" aria-hidden="true"><use href="#i-sliders"/></svg>
```

尺寸规范：**16px 行内** / **20px 按钮内** / **24px 独立或侧栏导航**。颜色继承 `currentColor`，强调色使用同 `--accent` 预算。

## 语义映射

### 一级导航（7 组）

| 导航项 | 页面 | Lucide 图标 | 名称 |
|---|---|---|---|
| 概览 | 首屏 | `layout-dashboard` | 仪表盘 |
| 音效 | EQ / 低音 / 环绕 | `sliders-horizontal` | 横向滑杆 |
| 空间音频 | 头动追踪 / 7.1 | `move-3d` | 3D 移动 |
| 麦克风 | 麦克风 EQ / 降噪 | `mic` | 麦克风 |
| 助听 | HyperHear | `ear` | 耳朵 |
| 灯光 | LED | `lightbulb` | 灯泡 |
| 设备与设置 | 信息 / 固件 | `settings-2` | 设置 |

### 功能与动作图标

| 语义 | Lucide 图标 | 使用场景 |
|---|---|---|
| 均衡器 EQ | `sliders-horizontal` | 音效页标题、EQ 段控 |
| 动态低音 | `waves` | 低音增强滑杆 |
| 环绕声 | `orbit` | 环绕模式开关 |
| 人声清晰度 | `audio-lines` | 人声段控 |
| 智能音量 | `volume-2` | 音量自适应 |
| 环境音效 | `blocks` | 场景预设 |
| 头动追踪 | `move-3d` | 空间音频开关 |
| 7.1 声道 | `speaker` | 虚拟扬声器 |
| 虚拟扬声器 | `layout-grid` | 扬声器布局 |
| 麦克风 | `mic` | 麦克风页 |
| 降噪 | `audio-waveform` | 降噪开关 |
| AI 降噪 | `sparkles`* | AI 降噪开关（为 SVG 矢量图标，非 emoji Unicode） |
| 魔音变声 | `wand-2` | 变声预设 |
| 录音音效 | `mic-vocal` | 录音模式 |
| 助听 HyperHear | `ear` | 助听页 |
| 灯光 LED | `lightbulb` | 灯光页 |
| 亮度 | `sun` / `moon` | 灯光亮度滑杆 |
| 固件升级 | `download` | 固件卡片 |
| 设备信息 | `info` | 设备信息 |
| 插孔设置 | `plug` | 插孔检测 |
| 自动切换 | `refresh-cw` | 自动切换开关 |
| 配置档 | `folder-cog` | 全局配置档 |
| 通用设置 | `settings-2` | 通用设置 |
| 电量 | `battery-medium` | 电量显示 |
| 连接方式 | `usb` / `bluetooth` | 有线/无线 |
| 重置 | `rotate-ccw` | 恢复默认 |
| 保存 | `check` | 保存配置 |
| 更多 | `ellipsis-vertical` | 溢出菜单 |
| 折叠 | `chevron-down` | 下拉/折叠 |
| 关闭 | `x` | Modal 关闭 |
| 警告 | `triangle-alert` | 错误提示 |
| 成功 | `circle-check` | 成功提示 |
| 空状态 | `search-x` | 无数据 |

> *`sparkles` 是 Lucide 的矢量图标名，**不是** emoji；渲染为 SVG path，符合 P0-1。

## 尺寸与对齐规则

- 图标与文字垂直居中对齐（`align-items: center`）。
- 图标与相邻文字间距 `--space-2`(8px)。
- 侧栏导航图标 24px，文字 `--text-sm`(14px)。
- 按钮内图标 20px，独立操作区图标 24px，行内状态图标 16px。
- 图标按钮命中区最小 44×44px（图标视觉 20px + padding）。

## 禁止项

- 禁止：以 Unicode 表情（如火箭/火焰/灯泡/闪光/耳机等 emoji 码位）作为功能图标。
- 禁止：混用其他图标库（Heroicons / Material / Font Awesome）。
- 禁止：线性图标与填充图标混用。
- 禁止：描边宽度不统一（必须全为 1.5px）。
