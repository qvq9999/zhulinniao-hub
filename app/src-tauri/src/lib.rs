//! 竹林鸟朱雀 Hub — 命令层 + 桌面壳入口。
//! 命令契约见 docs/contracts/tauri-commands.md；设备检测见 device.rs / device_monitor.rs。

mod apo;
mod audio;
mod commands;
mod device;
mod device_info;
mod device_monitor;
mod window;

use device_monitor::DeviceMonitor;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 后台设备监视器：独立线程 + 超时枚举，命令层只读缓存（避免 IPC 阻塞致界面空白）
    let monitor = DeviceMonitor::new();

    tauri::Builder::default()
        .manage(monitor)
        .manage(window::CloseActionState::default())
        // 点 × 的拦截：按「每次询问 / 最小化到后台 / 直接退出」策略处理
        .on_window_event(|win, event| {
            window::on_window_event(win, event);
        })
        .setup(|app| {
            // Rust 侧看门狗：每 3s 主动执行页面探针并写盘（Rust 侧状态 + JS 侧 DOM 双通道）。
            // 页面 JS 定时器一旦不执行（线程卡死/渲染器异常），JS 通道缺失即可定位。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut iter: u32 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    iter += 1;
                    // 首轮把 HID 命中清单写盘（排查误判用）
                    if iter == 1 {
                        // EQ 自检（提权验证用）：ZHUB_EQ_SELFTEST=1 时做真机往返并写日志
                        if std::env::var("ZHUB_EQ_SELFTEST").ok().as_deref() == Some("1") {
                            std::thread::spawn(|| {
                                commands::append_frontend_log("eq-selftest | 开始");
                                match apo::apo_eq_read() {
                                    Ok(before) => commands::append_frontend_log(&format!(
                                        "eq-selftest | 读取成功 enabled={} sliders={:?} path={}",
                                        before.enabled, before.sliders, before.store_path
                                    )),
                                    Err(e) => commands::append_frontend_log(&format!("eq-selftest | 读取失败 {e}")),
                                }
                                let probe = [10, -10, 5, -5, 3, -3, 2, -2, 1, -1];
                                match apo::apo_eq_write(Some(true), Some(probe.to_vec()), None, None, None) {
                                    Ok(after) => commands::append_frontend_log(&format!(
                                        "eq-selftest | 写入成功 回读enabled={} sliders={:?} 一致={}",
                                        after.enabled, after.sliders, after.sliders == probe
                                    )),
                                    Err(e) => commands::append_frontend_log(&format!("eq-selftest | 写入失败 {e}")),
                                }
                                // 还原为全 0 / 关闭
                                match apo::apo_eq_write(Some(false), Some([0i32; 10].to_vec()), None, None, None) {
                                    Ok(r) => commands::append_frontend_log(&format!(
                                        "eq-selftest | 已还原 enabled={} sliders={:?}",
                                        r.enabled, r.sliders
                                    )),
                                    Err(e) => commands::append_frontend_log(&format!("eq-selftest | 还原失败 {e}")),
                                }
                            });
                        }
                        if let Some(mon) = tauri::Manager::try_state::<Arc<DeviceMonitor>>(&handle) {
                            let snap = mon.snapshot();
                            let list = snap
                                .devices
                                .iter()
                                .map(|d| format!("{}({:04X}:{:04X})", d.name, d.vid, d.pid))
                                .collect::<Vec<_>>()
                                .join(", ");
                            commands::append_frontend_log(&format!(
                                "hid-scan | connected={} | settled={} | devices=[{}]",
                                snap.connected, snap.settled, list
                            ));
                        }
                    }
                    match tauri::Manager::get_webview_window(&handle, "main") {
                        Some(win) => {
                            let url = win.url().map(|u| u.to_string()).unwrap_or_default();
                            commands::append_frontend_log(&format!(
                                "wd-rs | iter={iter} | winFound=true | url={url}"
                            ));
                            let _ = win.eval(
                                "try{window.__reportBoot && window.__reportBoot('wd-js | hash=' \
                                 + location.hash + ' | scrollH=' + document.documentElement.scrollHeight \
                                 + ' | innerH=' + window.innerHeight \
                                 + ' | rootKids=' + (document.getElementById('root')||{}).childElementCount \
                                 + ' | text=' + (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,120));}catch(e){window.__reportBoot && window.__reportBoot('wd-js-err | '+e.message);}",
                            );
                        }
                        None => {
                            commands::append_frontend_log(&format!("wd-rs | iter={iter} | winFound=FALSE"));
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_connection_state,
            commands::get_device_info,
            commands::scan_devices,
            commands::report_frontend_error,
            commands::get_autostart,
            commands::set_autostart,
            commands::settings_load,
            commands::settings_save,
            audio::audio_get_state,
            audio::audio_set_volume,
            audio::audio_set_mute,
            audio::audio_set_balance,
            device_info::device_details,
            device_info::audio_endpoint_list,
            device_info::audio_set_default,
            apo::apo_eq_read,
            apo::apo_eq_write,
            apo::apo_fields_read,
            apo::apo_field_write,
            apo::relaunch_elevated,
            window::window_set_close_action,
            window::window_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
