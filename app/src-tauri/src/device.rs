//! 设备检测 — Tier2 真实硬件通道（ADR-002 / ADR-004）。
//!
//! 枚举实现用 hidapi crate（Windows 后端即 hid.dll 封装）。说明：ADR-002 排除的是
//! hidapi-rs 的 feature report 路径（Windows 上有 DeviceIoControl 缺陷，issue #172）；
//! 本模块只做【设备枚举 + 打开句柄 + 读取字符串描述符】，不触碰 feature report，
//! 因此不引入该缺陷。后续读写 EQ/LED 时按 ADR 分别走 APO PropertyStore 与
//! windows crate 的 HidD_Get/SetFeature。

use serde::Serialize;

/// VID 白名单（C-Media 0x0D8C 及原版 INF 声明的关联厂商）
const VID_WHITELIST: [u16; 5] = [0x0D8C, 0x4C4A, 0x20F8, 0x0E6A, 0x046A];

/// PID 家族（原版 CM002X1.Inf 声明，均 MI_00）。
/// 非 0x0D8C 的 VID 必须同时命中配套 PID；0x0D8C 主 VID 只认 0x0334。
const PID_FAMILY: [(u16, u16); 6] = [
    (0x0D8C, 0x0334),
    (0x4C4A, 0x4255),
    (0x20F8, 0xA962),
    (0x20F8, 0xA963),
    (0x20F8, 0xA964),
    (0x0E6A, 0x0110),
    // (0x046A, 0x01ED) 见下方特判（同 VID 多设备厂商，需配合产品名过滤）
];

fn is_unicorn_pid(vid: u16, pid: u16) -> bool {
    vid == 0x046A && pid == 0x01ED
}

fn vid_in_whitelist(vid: u16) -> bool {
    VID_WHITELIST.contains(&vid)
}

fn pid_in_family(vid: u16, pid: u16) -> bool {
    PID_FAMILY.iter().any(|&(v, p)| v == vid && p == pid)
}

/// 主 VID：C-Media（朱雀 CM002X1 的音频方案厂商），命中即视为家族设备。
const PRIMARY_VID: u16 = 0x0D8C;

/// 判定是否朱雀 CM002X1 家族设备。
/// 规则（防误判）：主 VID 0x0D8C 命中 PID 家族即通过；
/// 关联 VID 必须【同时】命中 (VID,PID) 家族【且】产品名含朱雀家族关键字，
/// 避免同名厂商的键盘/鼠标等无关设备被误判为耳机。
pub fn is_unicorn(vid: u16, pid: u16, product: Option<&str>) -> bool {
    if !vid_in_whitelist(vid) {
        return false;
    }
    let pid_match = pid_in_family(vid, pid) || is_unicorn_pid(vid, pid);
    if !pid_match {
        return false;
    }
    if vid == PRIMARY_VID {
        return true;
    }
    // 非主 VID：必须产品名能对上，否则判为无关设备
    product.map(name_matches).unwrap_or(false)
}

/// 产品名关键字匹配（大小写不敏感）：朱雀 / 竹林鸟 / CM002X1 / C-Media / ZHUAUDIO。
pub fn name_matches(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("cm002x1")
        || n.contains("c-media")
        || n.contains("cmedia")
        || n.contains("zhuaudio")
        || name.contains("朱雀")
        || name.contains("竹林鸟")
}

#[derive(Serialize, Clone)]
pub struct HidDeviceFound {
    pub vid: u16,
    pub pid: u16,
    pub name: String,
    pub serial: Option<String>,
}

/// 枚举系统 HID 总线，返回命中的朱雀设备列表（真实硬件探测，无任何假定）。
pub fn scan_unicorn_devices() -> Vec<HidDeviceFound> {
    let api = match hidapi::HidApi::new() {
        Ok(api) => api,
        Err(_) => return Vec::new(), // hid.dll 初始化失败按「未找到」处理，前端保持未连接
    };
    let mut found = Vec::new();
    for info in api.device_list() {
        let vid = info.vendor_id();
        let pid = info.product_id();
        let product = info.product_string();
        if !is_unicorn(vid, pid, product) {
            continue;
        }
        let name = product
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("CM002X1 ({vid:04X}:{pid:04X})"));
        found.push(HidDeviceFound {
            vid,
            pid,
            name,
            serial: info.serial_number().map(|s| s.to_string()),
        });
    }
    found
}
