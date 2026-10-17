# 竹林鸟朱雀 Hub（zhulinniao-hub）

竹林鸟朱雀 ZG3 / CM002X1 原版驱动面板（C-Media Xear 方案 WPF 应用）的**现代化桌面重构版**。

> **范围锁定**：只重置 UI 与布局，**不新增、不删减功能**，功能可用性力求与原版 1:1。
> 功能映射见 [`功能对照表.md`](./功能对照表.md)，整体流程见 [`完整制作步骤.md`](./完整制作步骤.md)。

技术栈：Tauri v2（Rust）+ React 18 + TypeScript + Vite，目标平台 Windows。

## 功能范围

按本设备（0D8C:0334）实际可用的通道收敛为 4 个页面：**概览 / 音效控制（耳机 7 项）/ 麦克风（2 项）/ 设置**。
原版未对 ZG3 开放的空间音频、超感听觉、LED 等页面已整页下架（本设备无对应通道，不做假界面）。

设置页包含：装置信息、默认装置设置、通用设置（语言 / 主题 / 开机自启动 / **关闭窗口时**），以及版本与仓库地址。
点窗口 × 时可选择「每次询问 / 最小化到后台 / 直接退出」；最小化到后台会隐藏窗口并在任务栏托盘保留图标。

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
| 竹林鸟朱雀原版驱动 | — | **无需单独安装**：安装包已内置 C-Media 驱动三件套（基础驱动 / APO 组件 / 扩展 INF） |

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

v1.0.0：UI 重构与原版对齐已落地；9 项效果、音量/静音/平衡、装置信息均实测可用；
安装包内置驱动组件，目标为「只装本软件即可使用全部功能」。部分效果参数范围仍需用原版界面标定。详见 `docs/原版对齐规格.md`。

## 说明

本项目为个人学习性质的界面重构实现。应用本体为独立实现；**安装包内随附 C-Media 的签名驱动组件**
（`CM002X1.Inf` / `CM002X1_APO.inf` / `CM002X1_Ext.inf` 及其 CAT/SYS/DLL），版权归 C-Media Electronics Inc. 所有，
仅用于让本设备在没有单独安装官方驱动的情况下正常工作。**第三方对外分发前需自行取得厂商授权。**

若驱动未就绪（例如被系统更新或卸载工具移除，或出现过「开关能开但没效果」），
可右键以管理员身份运行安装根目录的 [`修复音效.cmd`](./app/src-tauri/resources/repair/Repair-Audio-Effects.cmd)
（仓库内为 [`一键修复音效.cmd`](./一键修复音效.cmd)），它会清掉旧的安装记录并重新注册 APO；也可以在重新运行安装包时自动完成。

> 注意：**卸载原厂驱动后**，Windows 往往还记着「扩展已安装」，此时单纯重装驱动包不会真正执行 APO 注册，
> 必须像上面的脚本那样先清记录（`pnputil /delete-driver <oemNN> /uninstall /force`）再重装，
> 必要时还要 `remove-device` + `scan-devices` 强制整设备重装。
