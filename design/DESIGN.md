# 朱雀耳机 Hub 设计规范 (Zhuque Headphone Hub)

> 品牌：竹林鸟 朱雀 CM002X1 · 方向：候选 B《朱雀·竹林鸟品牌化》
> 寄存器：Product（设计服务产品）· 平台：web + Tauri 桌面
> 图标：Lucide（1.5px 描边，16/20/24px）· 网格：4px
> 设计刻度：DESIGN_VARIANCE = 4 · MOTION_INTENSITY = 4 · VISUAL_DENSITY = 3

---

## 1. Visual Theme & Atmosphere

**视觉主题关键词**：竹雅、克制、通透、实物导向

- 浅色留白为主体骨架，界面像一张摊在竹案上的说明书，而非堆叠的卡片墙。
- 朱砂红（#C33B2E）只做「确认与当前」的信号，竹青（#3F7A5A）做「正常/正向」的语义承接。
- 中央是设备实物热区图，功能面板围绕实物展开——用户看的是一副耳机，而不是一堆抽象滑块。
- 无渐变主视觉、无发光边框、无毛玻璃三件套；层次靠 1px 描边与亮度递进。

---

## 2. Color Palette & Roles

### A1-identity
| Token | Value | Role |
|---|---|---|
| `--bg` | `#F6F7F8` | 页面背景 |
| `--surface` | `#FFFFFF` | 卡片/容器背景 |
| `--fg` | `#1A1D1F` | 主文本 |
| `--muted` | `#767C82` | 副文本/标签 |
| `--accent` | `#C33B2E` | 朱雀朱砂红（**每屏 ≤2 处可见使用**） |
| `--accent-2` | `#3F7A5A` | 竹青，次强调/正向语义 |
| `--border` | `#E2E5E8` | 默认边框 |
| `--font-display / --font-body` | `Inter, Noto Sans SC, ...` | 字体 |

### A2 语义色
| Token | Light | Role |
|---|---|---|
| `--success` | `#2E7D4F` | 连接成功、固件最新、设备正常 |
| `--warn` | `#C98A16` | 电量偏低、需校准 |
| `--danger` | `#B4322A` | 连接失败、升级风险 |
| `--info` | `#3F7A5A` | 提示性信息（复用竹青） |

### B-slot 别名
`--surface-2`（凹陷面/滑杆轨道）、`--fg-2`（次级文本）、`--meta`（元数据/禁用文本）、`--border-soft`（行内分隔）。

### 用法约束
- 单屏可见 `--accent` 使用 ≤2 处（如：当前导航项 + 主 CTA 或一个开关开启态）。
- 开关「开」态、EQ 曲线中轴、热区引线——三者只选其一用朱砂红，其余走竹青或中性。

---

## 3. Typography Rules

**字体栈**
- `--font-display`: `Inter, "Noto Sans SC", -apple-system, "Segoe UI", sans-serif`
- `--font-body`: `Inter, "Noto Sans SC", -apple-system, "Segoe UI", sans-serif`
- `--font-mono`: `"JetBrains Mono", "Fira Code", ui-monospace, monospace`（所有 EQ 频点、dB、Hz、电量百分比、固件版本号）

**字号层级（8 级）**：`--text-xs` 12 / `--text-sm` 14 / `--text-base` 16 / `--text-lg` 18 / `--text-xl` 20 / `--text-2xl` 24 / `--text-3xl` 32 / `--text-4xl` 40px。正文基准 14–16px。

**字距**
| 场景 | 值 |
|---|---|
| 正文（14–18px） | `0` |
| 小字/标签（11–13px） | `0.01em` |
| ALL CAPS（状态胶囊、段控标签） | `0.06–0.08em`（`--tracking-caps`） |
| 标题 ≥32px | `-0.01em ~ -0.02em`（`--tracking-display`） |

**字重**：Read 400 / Emphasize 500 / Announce 600。标题 `--leading-tight` 1.2，正文 `--leading-body` 1.6。

---

## 4. Component Stylings

### 按钮
| 类型 | 背景 | 文字 | 边框 | 圆角 | 内边距 |
|---|---|---|---|---|---|
| Primary | `--accent` | `--accent-on` | 无 | `--radius-sm` | 0 16px / h40 |
| Secondary | 透明 | `--accent` | 1px `--border` | `--radius-sm` | 0 16px / h40 |
| Ghost | 透明 | `--fg` | 无 | `--radius-sm` | 0 12px / h36 |
| Pill | `--surface-2` | `--fg-2` | 无 | `--radius-pill` | 0 12px / h28 |

### 卡片
`--surface` 背景 + 1px `--border` + `--radius-md`(12px) + 无默认阴影；hover 仅边框变 `--accent`，不位移、不发光。禁止「圆角卡片 + 彩色左边框」。

### 输入框
`--surface` 背景 + 1px `--border` + `--radius-sm`；`:focus-visible` 用 `--focus-ring`；`aria-invalid` 边框转 `--danger`，错误信息紧贴字段下方。

### 核心控件（本产品特有）
- **滑杆 Slider**：轨道 `--surface-2`，填充/滑块 `--accent` 或 `--accent-2`，圆形滑块 16px，h40 触摸区，键盘 ←/→ 可调；数值用等宽字体实时显示。
- **开关 Switch**：轨道 40×24，开启 `--accent-2`（正向）或 `--accent`（品牌动作），关闭 `--surface-2`；过渡 `--motion-fast`。
- **段控 Segmented**：`--surface-2` 容器 + 选中项 `--surface` + 1px 描边，标签 ALL CAPS 0.06em。
- **下拉 Select**：同输入框规格，右侧 Lucide `chevron-down` 16px。
- **EQ 曲线**：SVG 折线，网格 `--equ-grid`，中轴 `--equ-mid`，曲线 `--accent`，10 段频点可拖拽；每点显示 `JetBrains Mono` 的 dB 值。
- **热区引线卡片**：1px `--border` 卡片被 `--hotspot-line` 引线连到实物点位，悬停时点位 `--hotspot-halo` 光晕 + 引线加粗。

---

## 5. Layout Principles

- 栅格：桌面 12 列 / 平板 8 列 / 手机 4 列；沟槽 24 / 16 / 12px。
- 全局骨架：左侧 `--sidebar-width`(220px) 分类导航 + 顶部 `--topbar-height`(56px) 工具栏 + 中央内容区（`--container-max` 1120px，浅色留白）。
- 节区节奏 `--section-y`：桌面 48 / 平板 32 / 手机 24px。
- Hero（概览首屏）：高度 40–60vh，内容顶部偏移、不垂直居中；中央为设备实物热区图，非口号 + 抽象图形。

---

## 6. Depth & Elevation

| 层级 | Token | 用法 |
|---|---|---|
| flat | `--elev-flat` | 平铺内容、表格 |
| ring | `--elev-ring` | 卡片/输入默认覆盖 |
| raised | `--elev-raised` | 浮起：下拉菜单、Modal、Toast |

**深色模式**：以亮度递进表达层级（bg `#141617` → surface `#1D2022` → surface-2 `#262A2C`），不使用强烈投影；边框改用 `rgba(255,255,255,0.06~0.10)`。

---

## 7. Do's and Don'ts

**允许（Do）**
- 用 Token 引用的中性色骨架 + 一个品牌强调色。
- 设备实物热区图作为首屏主角。
- 1px 描边 + 亮度递进表达层次。
- 等宽字体呈现所有数值。

**禁止（Don't — 出现即重写）**
1. 紫→粉渐变（`#7C3AED #A855F7 #9333EA #EC4899` 任意组合）。
2. emoji 作为功能图标（图标一律来自 Lucide）。
3. 空洞占位（"Welcome to" / "Lorem ipsum" / "开始探索"）。
4. 硬编码颜色（除 `#fff`/`#000`）——必须走 Token。
5. 千篇一律 Hero（大标题 + 副标题 + 居中 CTA + 抽象 3D）。
6. 卡片左侧彩色条纹、渐变文字、默认毛玻璃、幽灵卡片（1px 边框 + 大模糊阴影并存）。
7. 卡片圆角 ≥24px（本产品卡片圆角上限 16px）。
8. 每节顶部都放小型大写追踪标签（"ABOUT""PROCESS"）或 `01/02/03` 编号脚手架。
9. 虚构指标（"10000+ 用户""99.9% 稳定"）。

---

## 8. Responsive Behavior

| 断点 | 宽度 | 布局 |
|---|---|---|
| xs | <640px | 单列，底部 TabBar（≤5），侧栏收起为抽屉 |
| md | ≥768px | 双列，侧栏可折叠 |
| lg | ≥1024px | 左侧 Sidebar 常驻 + 顶部工具栏 |
| xl | ≥1280px | 完整布局，中央留白最充裕 |

- 触摸目标 ≥44×44px，按钮间距 ≥8px。
- 移动端开关/滑杆加大命中区；热区引线在窄屏改为纵向列表卡片直接对应点位。
- `DESIGN_VARIANCE=4` 的偏移布局在 <768px 一律回退单列。

---

## 9. Agent Prompt Guide

给前端 Agent 的实现提示：

1. **先引 Token**：`import tokens from './design-tokens.json'`，并通过 `design-tokens.css` 建立 CSS 变量；任何颜色/间距/圆角/阴影都引用变量，不写裸值。
2. **图标**：统一使用 Lucide，描边 1.5，尺寸 16/20/24；禁止 emoji。语义映射见 `design/pages/README-icons.md`。
3. **字体**：`Inter + Noto Sans SC` 正文，数值一律 `--font-mono`；标题负字距，状态标签用 0.06–0.08em。
4. **状态覆盖**：每个有状态组件至少覆盖 Loading / Empty / Error / Populated（+ Edge）。
5. **动效**：默认 `--motion-base` 180ms，`--ease-standard`；必须支持 `prefers-reduced-motion`。
6. **强调色预算**：每屏 `--accent` 可见使用 ≤2 处。
7. **无障碍**：`:focus-visible` 焦点环齐全，键盘可达，图标按钮配 `aria-label`，正文对比度 ≥4.5:1。
8. **反 AI 模板自检**：提交前用正则扫描 emoji、搜索紫粉渐变、确认无空洞文案、确认无裸 hex。

### Master + Overrides
- 全局源：`design/DESIGN.md`（本文件）
- 页面级覆盖：`design/pages/<page>.md`（仅写差异字段）
- 检索顺序：先读 DESIGN.md，再检查 `pages/<page>.md` 是否覆盖对应字段；MASTER 已存在时只追加/修正条目，不整篇重写。
