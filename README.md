# 竹林鸟朱雀 Hub（zhulinniao-hub）

竹林鸟朱雀 ZG3 / CM002X1 原版驱动面板（C-Media Xear 方案 WPF 应用）的**现代化桌面重构版**。

> **范围锁定**：只重置 UI 与布局，**不新增、不删减功能**，功能可用性力求与原版 1:1。
> 功能映射见 [`功能对照表.md`](./功能对照表.md)，整体流程见 [`完整制作步骤.md`](./完整制作步骤.md)。

技术栈：Tauri v2（Rust）+ React 18 + TypeScript + Vite，目标平台 Windows。

## 功能范围

原版驱动的 28 个模块按页面重新编排为 8 个页面：概览、音效（均衡器 / 各增强效果）、空间音频、麦克风、听力保护、灯效、设备与设置。

## 目录结构

```
.
├── app/                       # 可运行的 Tauri 应用
│   ├── src/                   # React 前端（页面 / 组件 / 设备桥接 / 状态）
│   └── src-tauri/             # Rust 后端（音频端点、APO 属性存储、HID、命令层）
├── prototype/                 # 早期纯 HTML/CSS/JS 可点击原型（无构建，双击即可看）
├── design/                    # Design Token（A1/A2/B/C 四层）+ 页面规格
├── docs/
│   ├── decisions/             # ADR-001..005（技术选型与取舍）
│   ├── contracts/             # 前后端命令契约、本地存储、验证清单
│   ├── schemas/               # 原版配置 JSON Schema
│   ├── 通道全景图.md          # 各功能对应的读写通道与注册表位置
│   └── 原版对齐规格.md        # 逐页与原版的取值/交互对齐依据
├── 功能对照表.md
└── 完整制作步骤.md
```

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 22.x | 前端构建 |
| Rust | stable + MSVC 工具链 | Tauri 核心 |
| WebView2 Runtime | Win11 自带 | 渲染层 |
| 竹林鸟朱雀原版驱动 | — | 功能通道依赖其安装的 APO 与设备节点 |

## 本地运行

```bash
cd app
npm install

# 仅前端（浏览器里看 UI，设备相关功能不可用）
npm run dev

# 完整桌面应用
npx tauri dev
```

## 构建

```bash
cd app
npm run build          # 前端产物 → app/dist
npx tauri build        # 打包 exe / 安装包
```

## 实现要点（踩坑记录）

- **音量/静音**走 Core Audio `IAudioEndpointVolume`，必须按设备名称命中耳机端点，不能直接用默认端点。
- **音效参数**写入 `HKLM\...\MMDevices\Audio\Render\{端点}\FxProperties\{CAPX上下文}\User`。裸写注册表不会实时生效（厂商 APO 只在流初始化时读一次），需经官方属性存储 `IAudioSystemEffectsPropertyStore` 写入并 `Commit()`。
- **Tauri v2 的 `frontendDist` 在编译期内嵌进 exe**，只跑 `vite build` 不会改变已构建应用的行为，必须重新 `cargo build`。
- **WebView2 在 Administrator 账户下沙箱初始化失败**会导致窗口空白，需 `additionalBrowserArgs` 加 `--no-sandbox`（已固化在 `tauri.conf.json`）。

## 状态

早期阶段：UI 重构与原版对齐已落地主要页面，后端通道部分功能已实测可用，部分效果参数范围仍需用原版界面标定。详见 `docs/原版对齐规格.md`。

## 说明

本项目为个人学习性质的界面重构实现，不包含原版驱动的任何二进制文件或厂商资源，运行时依赖用户自行安装的官方驱动。
