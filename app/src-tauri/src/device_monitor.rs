//! 设备监视器 — 把 HID 枚举从命令线程剥离，杜绝 IPC 阻塞导致前端卡死在扫描态。
//!
//! 背景：hidapi 的枚举在部分设备/驱动组合下会长时间阻塞。若在 #[tauri::command]
//! 内同步枚举，Tauri 命令线程被占死，前端所有后续 invoke 全部排队不返回，
//! 界面表现为长时间空白（黑/白屏）。故改为：
//!   后台线程（3s 周期）→ 子线程枚举 + 2.5s 超时 → 写入缓存
//!   命令层只读缓存，瞬时返回，永不阻塞。

use crate::device::{scan_unicorn_devices, HidDeviceFound};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone, Default)]
pub struct Snapshot {
    pub connected: bool,
    pub name: Option<String>,
    pub devices: Vec<HidDeviceFound>,
    /// 是否已完成过至少一轮成功枚举（false = 首次尚未出结果）
    pub settled: bool,
}

pub struct DeviceMonitor {
    inner: Mutex<Snapshot>,
}

impl DeviceMonitor {
    pub fn new() -> Arc<Self> {
        let monitor = Arc::new(Self {
            inner: Mutex::new(Snapshot::default()),
        });
        let me = Arc::clone(&monitor);
        thread::spawn(move || loop {
            if let Some(next) = scan_with_timeout(Duration::from_millis(2500)) {
                if let Ok(mut guard) = me.inner.lock() {
                    *guard = next;
                }
            }
            // 枚举超时/失败：保留上一轮结果，不打断界面
            thread::sleep(Duration::from_secs(3));
        });
        monitor
    }

    pub fn snapshot(&self) -> Snapshot {
        self.inner
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

/// 在独立线程里枚举并带超时；超时返回 None（调用方保留旧值）。
fn scan_with_timeout(timeout: Duration) -> Option<Snapshot> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        // 双保险：即使 hidapi 内部 panic，也不会带崩应用
        let devices = std::panic::catch_unwind(scan_unicorn_devices).unwrap_or_default();
        let _ = tx.send(devices);
    });
    match rx.recv_timeout(timeout) {
        Ok(devices) => Some(Snapshot {
            connected: !devices.is_empty(),
            name: devices.first().map(|d| d.name.clone()),
            devices,
            settled: true,
        }),
        Err(_) => None,
    }
}
