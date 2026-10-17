//! 窗口行为 — 点 × 时的「最小化到后台 / 关闭程序」。
//!
//! 设计要点：
//!   1. 三种策略由用户设置，持久化在前端 settings.json（`closeAction`），
//!      前端变更时调用 `window_set_close_action` 同步到本模块的运行时状态。
//!   2. `CloseRequested` 一律先拦下，再按策略决定：放行 / 隐藏到托盘 / 通知前端弹窗。
//!   3. 「最小化到后台」= 隐藏主窗口并**惰性**创建托盘图标（从左键点或菜单恢复）；
//!      恢复后立即移除托盘图标——不用托盘的用户不会看到多余图标。
//!
//! 注意：托盘依赖 tauri 的 `tray-icon` feature（见 Cargo.toml）。

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

/// 主窗口标签（与 tauri.conf.json 的 windows[0].label 一致）
const MAIN_WINDOW: &str = "main";
/// 托盘图标 id
const TRAY_ID: &str = "zhub-tray";

/// 关闭窗口时的行为（前端设置项的取值）
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseAction {
    /// 每次询问
    Ask,
    /// 最小化到后台（隐藏 + 托盘）
    Minimize,
    /// 直接关闭程序
    Exit,
}

impl CloseAction {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ask" => Some(Self::Ask),
            "minimize" => Some(Self::Minimize),
            "exit" => Some(Self::Exit),
            _ => None,
        }
    }
}

/// 运行时状态：当前策略（前端设置变更时写入）
pub struct CloseActionState(pub Mutex<CloseAction>);

impl Default for CloseActionState {
    fn default() -> Self {
        // 默认「每次询问」：宁可多问一次，也不要用户点 × 后程序无声消失
        Self(Mutex::new(CloseAction::Ask))
    }
}

impl CloseActionState {
    pub fn get(&self) -> CloseAction {
        self.0.lock().map(|g| *g).unwrap_or(CloseAction::Ask)
    }
}

/// 拦截 CloseRequested，按策略处理（非关闭事件直接忽略）
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let app = window.app_handle();
    let action = app
        .try_state::<CloseActionState>()
        .map(|s| s.get())
        .unwrap_or(CloseAction::Ask);

    match action {
        // 直接关闭：放行，交由 Tauri 正常退出
        CloseAction::Exit => {}
        CloseAction::Minimize => {
            api.prevent_close();
            if let Err(e) = hide_to_tray(app) {
                crate::commands::append_frontend_log(&format!("window | 最小化到后台失败: {e}"));
                let _ = window.show();
            }
        }
        CloseAction::Ask => {
            api.prevent_close();
            // 窗口可能已最小化：先恢复，保证弹窗可见
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            if let Err(e) = app.emit("hub://window/close-requested", ()) {
                crate::commands::append_frontend_log(&format!("window | 关闭询问事件发送失败: {e}"));
            }
        }
    }
}

/// 隐藏主窗口到托盘
pub fn hide_to_tray(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "主窗口不存在".to_string())?;
    ensure_tray(app).map_err(|e| format!("创建托盘图标失败：{e}"))?;
    win.hide().map_err(|e| format!("隐藏窗口失败：{e}"))?;
    Ok(())
}

/// 显示主窗口并移除托盘图标
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// 惰性创建托盘图标（已存在则跳过）
fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let show_item = MenuItemBuilder::with_id("show", "打开主界面").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("朱雀耳机 Hub")
        .menu(&menu)
        // Windows 惯例：左键单击直接唤出主界面，右键才出菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

// ---------- 命令 ----------

/// 同步「关闭窗口时」策略到运行时（前端设置变更 / 启动完成后调用）
#[tauri::command]
pub fn window_set_close_action(
    action: String,
    state: tauri::State<'_, CloseActionState>,
) -> Result<(), String> {
    let parsed = CloseAction::parse(&action).ok_or_else(|| format!("未知关闭策略：{action}"))?;
    *state.0.lock().map_err(|_| "关闭策略状态锁失败".to_string())? = parsed;
    Ok(())
}

/// 执行用户在关闭询问弹窗里的选择
#[tauri::command]
pub fn window_action(action: String, app: AppHandle) -> Result<(), String> {
    match action.as_str() {
        "minimize" => hide_to_tray(&app),
        "exit" => {
            app.exit(0);
            Ok(())
        }
        // 取消：弹窗由前端自行关闭，这里无需动作
        "cancel" => Ok(()),
        other => Err(format!("未知窗口动作：{other}")),
    }
}
