//! 装置信息（原版「装置设置及信息」窗口的**装置信息**区块）。
//!
//! 取证依据（反编译原版 + 本机注册表实测，非推测）：
//!   XearONE.UI.ControlWindow.Content/JackSetting.xaml.cs:41-46
//!     Label_DeviceName  = devInfo.controllerDisplayName   （装置名称）
//!     Label_FirmwareVer = devInfo.usbRevisionNumber       （固件版本 = USB REV，原版格式化 X4）
//!     Label_DriverVer   = devInfo.driverVersion           （硬件驱动版本）
//!   JackSetting.xaml 只有 3 行 → 语言文件里的「编解码器名称」是**未使用的残留**，原版并不显示。
//!
//! 原版这三项来自厂商 SDK（CmXearSDK：ControllerDisplayName / USBRevisionNumber / DriverVersion），
//! 而本机的 CmXearSDK 枚举不到音频端点（见 docs/原版对齐规格.md「通道能力总结」）。
//! 因此这里改走**等价的 Windows 真实来源**（结果与原版同源，但不依赖厂商 DLL）：
//!   - 装置名称   ：Core Audio 端点友善名
//!   - 硬件驱动版本：Enum\USB\<vid>&<pid>&MI_xx → Driver → Control\Class\... 的 DriverVersion
//!   - 固件版本   ：Enum\USB 硬件 ID 里的 REV_xxxx（原版即 USBRevisionNumber）

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct DeviceDetails {
    /// 装置名称（Core Audio 端点友善名）
    pub name: String,
    /// 硬件驱动版本（如 11.1.3.2）；读不到为空串
    pub driver_version: String,
    /// 驱动描述（如 USB Gaming Headset）
    pub driver_desc: String,
    /// 驱动提供方（如 C-Media）
    pub provider: String,
    /// 固件版本（原版 = USBRevisionNumber，取自硬件 ID 的 REV_xxxx）
    pub firmware_version: String,
    /// USB 设备实例 ID（排障用）
    pub instance_id: String,
    /// 端点当前格式：采样率 / 位深 / 声道数（Core Audio GetMixFormat 真实读取）
    pub sample_rate: u32,
    pub bits_per_sample: u32,
    pub channels: u32,
    /// 是否为默认装置 / 默认通讯装置（Core Audio 默认端点比对）
    pub is_default: bool,
    pub is_default_communication: bool,
}

#[cfg(windows)]
mod imp {
    use super::DeviceDetails;
    use windows::core::GUID;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

    const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    /// 判定端点名是否为朱雀耳机（与 audio.rs / device.rs 同一套关键字）
    fn is_headset(name: &str) -> bool {
        let n = name.to_ascii_lowercase();
        n.contains("zhuaudio")
            || n.contains("zg3")
            || n.contains("cm002x1")
            || n.contains("c-media")
            || n.contains("cmedia")
            || name.contains("朱雀")
            || name.contains("竹林鸟")
    }

    /// 定位耳机播放端点并读回友善名 / 端点 ID（用于默认装置比对）
    pub unsafe fn resolve_headset() -> Option<(windows::Win32::Media::Audio::IMMDevice, String, String)> {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE).ok()?;
        let count = collection.GetCount().unwrap_or(0);
        for i in 0..count {
            let dev = collection.Item(i).ok()?;
            let store = dev.OpenPropertyStore(STGM_READ).ok()?;
            let value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME).ok()?;
            let pw = PropVariantToStringAlloc(&value).ok()?;
            let name = pw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(pw.0 as *const core::ffi::c_void));
            if is_headset(&name) {
                let id = dev.GetId().ok()?.to_string().unwrap_or_default();
                return Some((dev, name, id));
            }
        }
        None
    }

    /// 读端点当前混音格式（IAudioClient::GetMixFormat）——原版「装置格式」区块的真实取值来源。
    unsafe fn mix_format(
        dev: &windows::Win32::Media::Audio::IMMDevice,
    ) -> (u32, u32, u32) {
        use windows::Win32::Media::Audio::IAudioClient;
        let client: IAudioClient = match dev.Activate(CLSCTX_ALL, None) {
            Ok(c) => c,
            Err(_) => return (0, 0, 0),
        };
        let ptr = match client.GetMixFormat() {
            Ok(p) => p,
            Err(_) => return (0, 0, 0),
        };
        if ptr.is_null() {
            return (0, 0, 0);
        }
        let wfx = *ptr;
        let (rate, bits, ch) = (wfx.nSamplesPerSec, u32::from(wfx.wBitsPerSample), u32::from(wfx.nChannels));
        CoTaskMemFree(Some(ptr as *const core::ffi::c_void));
        (rate, bits, ch)
    }

    /// 比对耳机端点是否为系统默认（多媒体 / 通讯）端点
    unsafe fn default_flags(headset_id: &str) -> (bool, bool) {
        let enumerator: IMMDeviceEnumerator = match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        {
            Ok(e) => e,
            Err(_) => return (false, false),
        };
        let console = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .and_then(|d| d.GetId())
            .map(|p| p.to_string().unwrap_or_default())
            .unwrap_or_default();
        let comm = enumerator
            .GetDefaultAudioEndpoint(eRender, eCommunications)
            .and_then(|d| d.GetId())
            .map(|p| p.to_string().unwrap_or_default())
            .unwrap_or_default();
        (
            !headset_id.is_empty() && console == headset_id,
            !headset_id.is_empty() && comm == headset_id,
        )
    }

    /// 从 Enum\USB 找朱雀音频接口设备（VID_0D8C&PID_0334&MI_00）并解析驱动版本与 REV。
    fn usb_driver_info() -> (String, String, String, String, String) {
        // (driver_version, driver_desc, provider, firmware_rev, instance_id)
        let mut out = (String::new(), String::new(), String::new(), String::new(), String::new());
        let hklm = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE);
        let usb = match hklm.open_subkey(r"SYSTEM\CurrentControlSet\Enum\USB") {
            Ok(k) => k,
            Err(_) => return out,
        };
        for vidpid in usb.enum_keys() {
            let vp = match vidpid {
                Ok(v) => v,
                Err(_) => continue,
            };
            let up = vp.to_ascii_uppercase();
            // 只要朱雀：VID_0D8C&PID_0334（含 &MI_xx 的音频接口优先）
            if !(up.contains("VID_0D8C") && up.contains("PID_0334")) {
                continue;
            }
            let dev_key = match usb.open_subkey(&vp) {
                Ok(k) => k,
                Err(_) => continue,
            };
            for inst in dev_key.enum_keys() {
                let inst = match inst {
                    Ok(i) => i,
                    Err(_) => continue,
                };
                let ik = match dev_key.open_subkey(&inst) {
                    Ok(k) => k,
                    Err(_) => continue,
                };
                let desc: String = ik.get_value("DeviceDesc").unwrap_or_default();
                let driver: String = ik.get_value("Driver").unwrap_or_default();
                let hwid: Vec<String> = ik.get_value("HardwareID").unwrap_or_default();
                // 原版「固件版本」= USBRevisionNumber；本机硬件 ID 的 REV_xxxx 即该值
                let mut rev = String::new();
                for h in &hwid {
                    if let Some(pos) = h.to_ascii_uppercase().find("REV_") {
                        rev = h[pos + 4..pos + 8].to_string();
                        break;
                    }
                }
                // 优先取音频接口（MI_00，驱动提供方 C-Media）
                let is_audio = desc.to_ascii_lowercase().contains("headset")
                    || desc.to_ascii_lowercase().contains("audio")
                    || up.contains("MI_00");
                if !is_audio && !out.0.is_empty() {
                    continue;
                }
                let mut version = String::new();
                let mut ddesc = String::new();
                let mut provider = String::new();
                if !driver.is_empty() {
                    if let Ok(ck) = hklm.open_subkey(format!(
                        r"SYSTEM\CurrentControlSet\Control\Class\{}",
                        driver
                    )) {
                        version = ck.get_value("DriverVersion").unwrap_or_default();
                        ddesc = ck.get_value("DriverDesc").unwrap_or_default();
                        provider = ck.get_value("ProviderName").unwrap_or_default();
                    }
                }
                // 描述带 @inf,%...%; 前缀时取分号后的可读部分
                let clean = |s: &String| -> String {
                    match s.split_once("%;") {
                        Some((_, tail)) => tail.trim().to_string(),
                        None => s.clone(),
                    }
                };
                out = (
                    version,
                    if ddesc.is_empty() { clean(&desc) } else { ddesc },
                    provider,
                    rev,
                    format!(r"{}\{}", vp, inst),
                );
                if is_audio {
                    return out;
                }
            }
        }
        out
    }

    pub fn details() -> Result<DeviceDetails, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let (dev, name, id) = unsafe { resolve_headset() }
            .ok_or_else(|| "未找到朱雀耳机音频端点".to_string())?;
        let (sample_rate, bits, channels) = unsafe { mix_format(&dev) };
        let (is_default, is_default_communication) = unsafe { default_flags(&id) };
        let (driver_version, driver_desc, provider, firmware_version, instance_id) = usb_driver_info();
        Ok(DeviceDetails {
            name,
            driver_version,
            driver_desc,
            provider,
            firmware_version,
            instance_id,
            sample_rate,
            bits_per_sample: bits,
            channels,
            is_default,
            is_default_communication,
        })
    }

    /// 列出当前活动的播放/录音端点（原版「音频装置列表」的真实枚举来源）
    pub fn endpoint_list(capture: bool) -> Result<Vec<(String, String)>, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let flow = if capture { eCapture } else { eRender };
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("音频子系统初始化失败：{e}"))?;
            let collection = enumerator
                .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
                .map_err(|e| format!("枚举端点失败：{e}"))?;
            let count = collection.GetCount().unwrap_or(0);
            let mut list = Vec::new();
            for i in 0..count {
                let dev = match collection.Item(i) {
                    Ok(d) => d,
                    Err(_) => continue,
                };
                let store = match dev.OpenPropertyStore(STGM_READ) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let value = match store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let pw = match PropVariantToStringAlloc(&value) {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let name = pw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(pw.0 as *const core::ffi::c_void));
                let id = dev.GetId().map(|p| p.to_string().unwrap_or_default()).unwrap_or_default();
                list.push((id, name));
            }
            Ok(list)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::DeviceDetails;

    pub fn details() -> Result<DeviceDetails, String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn endpoint_list(_capture: bool) -> Result<Vec<(String, String)>, String> {
        Err("仅支持 Windows".to_string())
    }
}

/// 默认装置设置：把耳机端点设为默认（多媒体）或默认通讯装置。
///
/// 走 Windows 未公开的 IPolicyConfig（与原版效果一致的唯一可行通道；
/// 原版由厂商 SDK 内部调用同一接口）。失败时如实报错，不假装成功。
#[cfg(windows)]
pub fn set_default(communication: bool) -> Result<(), String> {
    use windows::core::{GUID, HRESULT, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::core::IUnknown;
    use windows::core::Interface;

    // IPolicyConfig：CLSID {870af99c-171d-4f9e-af0d-e63df40c2bc9}
    // vtable 布局（含 IUnknown 3 个槽）：
    //   3 GetMixFormat / 4 GetDeviceFormat / 5 ResetDeviceFormat / 6 SetDeviceFormat
    //   7 GetProcessingPeriod / 8 SetProcessingPeriod / 9 GetShareMode / 10 SetShareMode
    //   11 GetPropertyValue / 12 SetPropertyValue / 13 SetDefaultEndpoint / 14 SetEndpointVisibility
    const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    const SLOT_SET_DEFAULT_ENDPOINT: usize = 13;

    type SetDefaultEndpointFn = unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, i32) -> HRESULT;
    type QueryInterfaceFn =
        unsafe extern "system" fn(*mut core::ffi::c_void, *const GUID, *mut *mut core::ffi::c_void) -> HRESULT;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let (_, _, id) = imp::resolve_headset().ok_or_else(|| "未找到朱雀耳机音频端点".to_string())?;
        let unknown: IUnknown = CoCreateInstance(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL)
            .map_err(|e| format!("默认装置接口不可用：{e}"))?;
        let raw = unknown.as_raw();
        // QueryInterface（vtable 槽 0）校验接口布局，避免版本不符时越界调用
        let vt = *(raw as *const *const *const core::ffi::c_void);
        let qi: QueryInterfaceFn =
            std::mem::transmute::<*const core::ffi::c_void, QueryInterfaceFn>(*vt.add(0));
        let mut cfg: *mut core::ffi::c_void = std::ptr::null_mut();
        let hr = qi(raw, &IID_POLICY_CONFIG, &mut cfg);
        if hr.is_err() || cfg.is_null() {
            return Err(format!("默认装置接口版本不匹配：{hr:?}"));
        }
        let vt = *(cfg as *const *const *const core::ffi::c_void);
        let call: SetDefaultEndpointFn =
            std::mem::transmute::<*const core::ffi::c_void, SetDefaultEndpointFn>(
                *vt.add(SLOT_SET_DEFAULT_ENDPOINT),
            );
        let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
        // ERole：0=eConsole（多媒体默认） 2=eCommunications（通讯默认）
        let role: i32 = if communication { 2 } else { 0 };
        let hr = call(cfg, PCWSTR(wide.as_ptr()), role);
        // 释放 QueryInterface 得到的引用
        let release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32 =
            std::mem::transmute(*vt.add(2));
        release(cfg);
        if hr.is_err() {
            return Err(format!("设为默认装置失败：{hr:?}"));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn set_default(_communication: bool) -> Result<(), String> {
    Err("仅支持 Windows".to_string())
}

/// 读取装置信息（真实来源：Core Audio + 系统设备注册表）
#[tauri::command]
pub fn device_details() -> Result<DeviceDetails, String> {
    imp::details()
}

/// 音频装置列表：[(端点ID, 名称)]
#[tauri::command]
pub fn audio_endpoint_list(capture: bool) -> Result<Vec<(String, String)>, String> {
    imp::endpoint_list(capture)
}

/// 设为默认装置（communication=false → 默认装置；true → 默认通讯装置）
#[tauri::command]
pub fn audio_set_default(communication: bool) -> Result<(), String> {
    set_default(communication)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真机读取：装置名称 / 驱动版本 / 固件版本(REV) / 端点格式 / 默认装置标记
    #[test]
    fn device_details_reads_real_values() {
        match imp::details() {
            Ok(d) => {
                println!(
                    "装置名称={} 驱动={} ({}/{}) 固件(REV)={} 实例={} 格式={}Hz/{}bit/{}ch 默认={} 通讯默认={}",
                    d.name, d.driver_version, d.driver_desc, d.provider, d.firmware_version,
                    d.instance_id, d.sample_rate, d.bits_per_sample, d.channels,
                    d.is_default, d.is_default_communication
                );
                assert!(!d.name.is_empty(), "装置名称不应为空");
            }
            Err(e) => println!("跳过：{e}"),
        }
    }

    #[test]
    fn endpoint_list_enumerates_real_devices() {
        match imp::endpoint_list(false) {
            Ok(l) => {
                println!("播放端点 {} 个：", l.len());
                for (id, name) in l.iter().take(10) {
                    println!("  {} {}", &id[..id.len().min(40)], name);
                }
                assert!(!l.is_empty(), "播放端点列表不应为空");
            }
            Err(e) => println!("跳过：{e}"),
        }
    }
}
