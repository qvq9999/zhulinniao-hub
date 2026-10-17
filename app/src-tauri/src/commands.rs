//! 命令定义 — 与 docs/contracts/tauri-commands.md 一一对应。
//! 独立模块避免 tauri::command 宏与 generate_handler! 在同一模块的宏重导入冲突（E0255）。
//!
//! 重要：设备状态一律读 DeviceMonitor 缓存（后台线程带超时刷新），
//! 命令内**禁止**同步枚举 HID——否则 IPC 线程被阻塞，前端会卡死在扫描态（见 device_monitor.rs）。

use crate::device_monitor::DeviceMonitor;
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
pub struct ConnectionState {
    pub connected: bool,
    pub name: Option<String>,
    /// hid = 真实硬件探测；stub = 通道未落地
    pub source: String,
    /// 已完成至少一轮枚举（前端据此区分「首次进行中」与「确认未找到」）
    pub settled: bool,
}

#[derive(Serialize)]
pub struct DeviceInfo {
    pub vid: u16,
    pub pid: u16,
    pub name: String,
}

/// 查询连接状态（前端门禁唯一数据源）。读缓存，瞬时返回。
#[tauri::command]
pub fn get_connection_state(monitor: tauri::State<'_, Arc<DeviceMonitor>>) -> ConnectionState {
    let snap = monitor.snapshot();
    ConnectionState {
        connected: snap.connected,
        name: snap.name,
        source: "hid".to_string(),
        settled: snap.settled,
    }
}

/// 设备详细信息（界面展示用，全部来自真实 HID 枚举）。
#[derive(Serialize)]
pub struct DeviceFullInfo {
    pub connected: bool,
    pub name: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub serial: Option<String>,
    /// 命中的 HID 接口数量（同一耳机通常多个 collection）
    pub interfaces: usize,
}

/// 查询设备详细信息（型号 / VID:PID / 序列号），全部为真实硬件数据。
#[tauri::command]
pub fn get_device_info(monitor: tauri::State<'_, Arc<DeviceMonitor>>) -> DeviceFullInfo {
    let snap = monitor.snapshot();
    let first = snap.devices.first();
    DeviceFullInfo {
        connected: snap.connected,
        name: first.map(|d| d.name.clone()),
        vid: first.map(|d| d.vid),
        pid: first.map(|d| d.pid),
        serial: first.and_then(|d| d.serial.clone()),
        interfaces: snap.devices.len(),
    }
}

/// 扫描音频/HID 总线上的朱雀设备（返回最近一轮真实枚举结果）。
#[tauri::command]
pub fn scan_devices(monitor: tauri::State<'_, Arc<DeviceMonitor>>) -> Vec<DeviceInfo> {
    monitor
        .snapshot()
        .devices
        .into_iter()
        .map(|d| DeviceInfo {
            vid: d.vid,
            pid: d.pid,
            name: d.name,
        })
        .collect()
}

/// Rust 侧直接写前端诊断日志（看门狗/watchdog 用，不经 IPC）。
pub fn append_frontend_log(msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("zhulinniao-frontend.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{msg}]");
    }
}

// ---------- 本地配置持久化（对齐 ADR-005：本地 JSON 配置） ----------
//
// 背景：原版把各项设置存在配置文件里，重开/切换页面都保留。
// 新版将界面设置统一序列化为 JSON 存到 appConfigDir/settings.json。

fn settings_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
    Ok(dir.join("settings.json"))
}

/// 读取全部界面设置（不存在时返回空对象）
#[tauri::command]
pub fn settings_load(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_file(&app)?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取配置失败：{e}"))
}

/// 保存全部界面设置（原子写：先写临时文件再替换）
#[tauri::command]
pub fn settings_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    // 校验 JSON 合法，避免写入坏数据
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("配置不是合法 JSON：{e}"))?;
    let path = settings_file(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("写入临时配置失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换配置文件失败：{e}"))?;
    Ok(())
}

// ---------- 开机自启动（真实生效：HKCU\...\Run 注册表项） ----------

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "ZhulinniaoHub";

/// 读取当前开机自启动状态（真实注册表查询）。
#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey(RUN_KEY) {
        Ok(key) => match key.get_value::<String, _>(RUN_VALUE) {
            Ok(v) => Ok(!v.trim().is_empty()),
            Err(_) => Ok(false),
        },
        Err(_) => Ok(false),
    }
}

/// 设置开机自启动：写入/删除 HKCU Run 项，指向当前 exe（真实生效，重启后有效）。
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .create_subkey(RUN_KEY)
        .map(|(k, _)| k)
        .map_err(|e| format!("无法打开注册表项：{e}"))?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径：{e}"))?;
        let value = format!("\"{}\"", exe.display());
        key.set_value(RUN_VALUE, &value)
            .map_err(|e| format!("写入注册表失败：{e}"))?;
        append_frontend_log(&format!("autostart | enabled=true | path={value}"));
        Ok(true)
    } else {
        // 值可能不存在：忽略删除错误，随后回读校验真实状态
        let _ = key.delete_value(RUN_VALUE);
        append_frontend_log("autostart | enabled=false");
        Ok(false)
    }
}

/// 前端诊断上报：把 WebView 内的挂载状态/异常写入磁盘日志，便于无调试器排障。
/// 日志路径：%TEMP%\zhulinniao-frontend.log（追加写）。
#[tauri::command]
pub fn report_frontend_error(message: String) -> Result<(), String> {
    use std::io::Write;
    let path = std::env::temp_dir().join("zhulinniao-frontend.log");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "[{stamp}] {message}").map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真机测试：真实写入 HKCU Run → 回读 → 删除 → 回读，验证开机自启动功能可用。
    #[test]
    fn autostart_roundtrip_writes_real_registry() {
        let before = get_autostart().unwrap_or(false);

        // 开启
        assert_eq!(set_autostart(true).unwrap(), true);
        assert_eq!(get_autostart().unwrap(), true, "写入后回读应为 true");

        // 校验写入内容确实指向本可执行文件
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.open_subkey(RUN_KEY).expect("Run 键应可打开");
        let v: String = key.get_value(RUN_VALUE).expect("Run 值应存在");
        assert!(v.starts_with('"') && v.ends_with('"'), "路径应加引号");
        assert!(v.to_ascii_lowercase().contains(".exe"), "应指向 exe");

        // 关闭
        assert_eq!(set_autostart(false).unwrap(), false);
        assert_eq!(get_autostart().unwrap(), false, "删除后回读应为 false");

        // 还原测试前状态，避免影响用户设置
        let _ = set_autostart(before);
    }
}
