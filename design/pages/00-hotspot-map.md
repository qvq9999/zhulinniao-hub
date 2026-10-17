# 设备实物热区图方案（Overview Device Hotspot Map）

> 概览首屏的主角是「朱雀耳机实物图 + 功能热区」。本文件定义图片来源/占位策略、热区点位规范、引线卡片规范。

## 1. 实物图来源与占位策略

**优先级**：
1. **首选 — 原版驱动资源**：原版 Xear UI 的 `UI\Resources\Skin` 目录下的耳机实物图（.png）。若架构师/团队已拷入项目 `assets/`，直接引用。
   - 本机未检索到该资源（`find *xear*` / `*Resources/Skin*` 均无结果），故**尚未落盘原图**，需 team-lead 确认原版安装路径后拷贝。
2. **兜底 — 冷静占位 SVG**：`assets/device-silhouette.svg` —— 朱雀耳机线稿轮廓（单色 `--fg-2`，1.5px 描边，与 Lucide 风格一致）。**非 emoji、非抽象 3D 图形**，仅作版式占位，接入真图后替换。
3. **图片规格**：透明底 PNG，最长边 ≥1024px，导出 WebP/AVIF；`loading="lazy"`；预留固定宽高比（4:3 或 1:1）避免 CLS。

> 结论：**本轮先以线稿 SVG 占位**，并在交付清单标注「待接入原版实物图」，不假造图片、不留空洞 alt。

## 2. 热区点位规范

- **实现**：容器 `<figure>` + 绝对定位的 `<button class="hotspot">`（键盘可达，配 `aria-label`）。
- **点位尺寸**：视觉 12px 圆点，命中区 44×44px（透明 padding）。
- **点位配色**：默认 `--accent`（12px 实心圆）+ 1px `--surface` 描边环；悬停/聚焦时叠加 `--hotspot-halo` 光晕（radius 18px）。
- **点位数量**：每屏 2–4 个，避免认知过载（工作记忆 ≤4）。

| 点位 | 位置 | aria-label | 目标页 |
|---|---|---|---|
| EQ / 音效 | 头梁右侧 | 音效设置 | `/sound` |
| 麦克风 | 左耳罩杆 | 麦克风设置 | `/mic` |
| 空间音频 | 右耳罩 | 空间音频设置 | `/spatial` |
| LED 灯效 | Logo 处 | 灯光设置 | `/lighting` |

## 3. 引线卡片规范（Leader Line）

- **布局**：设备图居中，卡片左右分布；桌面用 SVG `<path>` 引线连接点位→卡片侧边中点。
- **引线样式**：1px `--hotspot-line`（朱砂红 45% 透明）；曲线贝塞尔，非直角折线；悬停对应点位时引线 `stroke-width` 增至 2px + 端点圆点放大。
- **卡片内容**：Lucide 图标(20px) + 标题(`--text-sm` 500) + 一行说明(`--text-xs` `--muted`)；1px `--border`，`--radius-md`，`--surface` 底；hover 边框转 `--accent`，不位移、不发光。
- **移动端 <768px**：取消引线（避免溢出），热区卡片改为纵向列表，按 `border-t` 分隔；点位图上仍可点。
- **动效**：已连接态下卡片 + 引线**依次淡入**（stagger 60ms）；`prefers-reduced-motion` 下直接显示。
- **图片替代文本**：`alt="朱雀 CM002X1 头戴式耳机实物图，标注 4 个功能热区"`。
