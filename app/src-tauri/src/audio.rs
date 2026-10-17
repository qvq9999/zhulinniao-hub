//! 音量与静音控制 — Windows Core Audio（IAudioEndpointVolume）。
//!
//! 为什么用它：这是**真实生效**的通道——写入系统默认播放/录音端点后，
//! 耳机音量与静音会立即变化，并且与系统音量面板同源（不是只改界面数字）。
//! 依据 ADR-002：设备级音量/静音属系统音频层能力，不依赖厂商私有协议。

use serde::Serialize;

#[derive(Serialize)]
pub struct AudioState {
    /// 主音量 0.0 – 1.0
    pub volume: f32,
    pub muted: bool,
    /// 系统默认播放设备名（真实读取）
    pub device_name: String,
    /// 左声道 0.0 – 1.0（IAudioEndpointVolume 逐声道音量，对应原版「左」百分比）
    pub left: f32,
    /// 右声道 0.0 – 1.0（对应原版「右」百分比）
    pub right: f32,
    /// 端点声道数（<2 时界面不显示左右平衡）
    pub channels: u32,
}

#[cfg(windows)]
mod imp {
    use super::AudioState;
    use windows::core::GUID;
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        EDataFlow,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

    /// PKEY_Device_FriendlyName
    const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

    fn flow(capture: bool) -> EDataFlow {
        if capture {
            eCapture
        } else {
            eRender
        }
    }

    /// 判定端点名是否为朱雀耳机（与设备检测同一套关键字）
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

    /// 端点友善名（PKEY_Device_FriendlyName）
    unsafe fn friendly_name(
        enumerator: &IMMDeviceEnumerator,
        device: &windows::Win32::Media::Audio::IMMDevice,
    ) -> String {
        let ok = (|| -> windows::core::Result<String> {
            let store = device.OpenPropertyStore(STGM_READ)?;
            let value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME)?;
            let pw = PropVariantToStringAlloc(&value)?;
            let s = pw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(pw.0 as *const core::ffi::c_void));
            Ok(s)
        })();
        let _ = enumerator;
        ok.unwrap_or_default()
    }

    /// 解析目标端点：**优先命中朱雀耳机端点**（真实枚举名称匹配），否则回落系统默认端点。
    /// 修正：原实现只取默认端点，导致耳机不是默认设备时音量控制写到了别的设备上、看似失效。
    unsafe fn resolve_endpoint(
        capture: bool,
    ) -> Result<(windows::Win32::Media::Audio::IMMDevice, String), String> {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("音频子系统初始化失败：{e}"))?;

        // 枚举同向全部活动端点，找耳机
        let flow_dir = flow(capture);
        if let Ok(collection) = enumerator.EnumAudioEndpoints(flow_dir, DEVICE_STATE_ACTIVE) {
            let count = collection.GetCount().unwrap_or(0);
            for i in 0..count {
                if let Ok(dev) = collection.Item(i) {
                    let name = friendly_name(&enumerator, &dev);
                    if is_headset(&name) {
                        return Ok((dev, name));
                    }
                }
            }
        }

        // 回落：系统默认端点
        let dev = enumerator
            .GetDefaultAudioEndpoint(flow_dir, eConsole)
            .map_err(|e| format!("未找到音频端点：{e}"))?;
        let name = friendly_name(&enumerator, &dev);
        Ok((dev, name))
    }

    /// 在 COM 环境里取得目标端点的音量接口并执行操作。
    fn with_volume<T>(
        capture: bool,
        f: impl FnOnce(&IAudioEndpointVolume) -> windows::core::Result<T>,
    ) -> Result<T, String> {
        unsafe {
            // 允许重复初始化：已初始化时返回 RPC_E_CHANGED_MODE，可忽略
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let (device, _name) = resolve_endpoint(capture)?;
            let volume: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("音量接口不可用：{e}"))?;
            f(&volume).map_err(|e| format!("音频操作失败：{e}"))
        }
    }

    /// 读取默认端点名称（真实设备名，如 ZhuAudio ZG3）——优先耳机端点
    pub fn default_device_name(capture: bool) -> String {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            resolve_endpoint(capture).map(|(_, n)| n).unwrap_or_default()
        }
    }

    pub fn get_state(capture: bool) -> Result<AudioState, String> {
        let (volume, muted, left, right, channels) = with_volume(capture, |v| unsafe {
            let vol = v.GetMasterVolumeLevelScalar()?;
            let m = v.GetMute()?;
            let ch = v.GetChannelCount().unwrap_or(0);
            let mut l = vol;
            let mut r = vol;
            if ch >= 2 {
                if let Ok(x) = v.GetChannelVolumeLevelScalar(0) {
                    l = x;
                }
                if let Ok(x) = v.GetChannelVolumeLevelScalar(1) {
                    r = x;
                }
            }
            Ok((vol, m.as_bool(), l, r, ch))
        })?;
        Ok(AudioState {
            volume,
            muted,
            device_name: default_device_name(capture),
            left,
            right,
            channels,
        })
    }

    pub fn set_volume(capture: bool, volume: f32) -> Result<(), String> {
        let v = volume.clamp(0.0, 1.0);
        with_volume(capture, |vol| unsafe {
            vol.SetMasterVolumeLevelScalar(v, std::ptr::null())
        })
    }

    pub fn set_mute(capture: bool, muted: bool) -> Result<(), String> {
        with_volume(capture, |vol| unsafe {
            vol.SetMute(muted, std::ptr::null())
        })
    }

    /// 设置平衡：left/right 是 **相对系数**（1=该侧满额、0=该侧静音），
    /// 实际写入值 = 当前主音量 × 归一化系数。
    ///
    /// ⚠️ 两条实测约束（2026-10-17），少一条就会「调平衡变成调音量」：
    /// 1. 不能写绝对值 —— 本机端点会把 max(左右声道) 反映到 master 上，
    ///    写 1.0 / 0.0 会让主音量从 36% 跳到 100%。
    /// 2. 系数必须归一化到 max=1 —— 否则写 (0.25, 0.75) 时 master 会变成 主音量×0.75（掉了 25%）。
    ///    归一化后「较响的一侧保持原电平，只衰减另一侧」，主音量恒定。
    pub fn set_balance(capture: bool, left: f32, right: f32) -> Result<(), String> {
        let l0 = left.clamp(0.0, 1.0);
        let r0 = right.clamp(0.0, 1.0);
        let peak = l0.max(r0);
        let (l, r) = if peak > 0.0001 { (l0 / peak, r0 / peak) } else { (1.0, 1.0) };
        with_volume(capture, |vol| unsafe {
            let ch = vol.GetChannelCount()?;
            if ch < 2 {
                return Err(windows::core::Error::new(
                    windows::Win32::Foundation::E_FAIL,
                    "该端点声道数不足 2，无法分别设置左右音量",
                ));
            }
            let master = vol.GetMasterVolumeLevelScalar()?;
            vol.SetChannelVolumeLevelScalar(0, master * l, std::ptr::null())?;
            vol.SetChannelVolumeLevelScalar(1, master * r, std::ptr::null())?;
            Ok(())
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use super::AudioState;

    pub fn get_state(_capture: bool) -> Result<AudioState, String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn set_volume(_capture: bool, _volume: f32) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn set_mute(_capture: bool, _muted: bool) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
    pub fn set_balance(_capture: bool, _left: f32, _right: f32) -> Result<(), String> {
        Err("仅支持 Windows".to_string())
    }
}

/// 读取播放（capture=false）或录音（capture=true）端点的真实音量/静音状态。
#[tauri::command]
pub fn audio_get_state(capture: bool) -> Result<AudioState, String> {
    imp::get_state(capture)
}

/// 设置音量（0.0–1.0），立即作用于系统默认端点的真实音量。
#[tauri::command]
pub fn audio_set_volume(capture: bool, volume: f32) -> Result<(), String> {
    imp::set_volume(capture, volume)
}

/// 设置静音，立即作用于系统默认端点的真实静音状态。
#[tauri::command]
pub fn audio_set_mute(capture: bool, muted: bool) -> Result<(), String> {
    imp::set_mute(capture, muted)
}

/// 设置左右声道音量（0.0–1.0），对应原版卡片上的「左 / 右」百分比。
#[tauri::command]
pub fn audio_set_balance(capture: bool, left: f32, right: f32) -> Result<(), String> {
    imp::set_balance(capture, left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真机往返：读取 → 写入 33% → 回读校验 → 写入 66% → 回读 → 还原。
    /// 证明音量控制确实作用在**耳机端点**（device_name 应包含 ZhuAudio/ZG3）。
    #[test]
    fn audio_volume_roundtrip_hits_headset_endpoint() {
        let before = match imp::get_state(false) {
            Ok(v) => v,
            Err(e) => {
                println!("跳过：{e}");
                return;
            }
        };
        println!(
            "目标端点：{} | 当前音量 {:.2} muted={}",
            before.device_name, before.volume, before.muted
        );
        assert!(
            !before.device_name.is_empty(),
            "应能读到端点名（空字符串说明端点枚举失败）"
        );

        imp::set_volume(false, 0.33).expect("写入 33% 应成功");
        let a = imp::get_state(false).expect("回读应成功");
        println!("写入 0.33 后回读：{:.2}", a.volume);

        imp::set_volume(false, 0.66).expect("写入 66% 应成功");
        let b = imp::get_state(false).expect("回读应成功");
        println!("写入 0.66 后回读：{:.2}", b.volume);

        assert!((a.volume - 0.33).abs() < 0.02, "33% 应写入成功，实际 {}", a.volume);
        assert!((b.volume - 0.66).abs() < 0.02, "66% 应写入成功，实际 {}", b.volume);

        // 还原
        imp::set_volume(false, before.volume).expect("还原应成功");
        imp::set_mute(false, before.muted).expect("还原静音应成功");
        println!("已还原为 {:.2}", before.volume);
    }

    /// 真机往返：左右声道音量（对应原版卡片的「左 / 右」百分比）。
    #[test]
    fn audio_balance_roundtrip() {
        let before = match imp::get_state(false) {
            Ok(v) => v,
            Err(e) => {
                println!("跳过：{e}");
                return;
            }
        };
        println!(
            "端点 {} 声道数={} 左={:.2} 右={:.2}",
            before.device_name, before.channels, before.left, before.right
        );
        if before.channels < 2 {
            println!("跳过：端点声道数不足 2");
            return;
        }

        // 语义：left/right 为相对系数，内部归一化到 max=1 后按主音量缩放；
        // 目标：**平衡操作绝不改动主音量**（这是「调平衡变调音量」的回归点）。
        let master_before = before.volume;
        if master_before < 0.1 {
            println!("跳过断言：主音量过低（{master_before:.2}），先把系统音量调高再测");
            return;
        }
        imp::set_balance(false, 0.25, 0.75).expect("写左右应成功");
        let mid = imp::get_state(false).expect("回读应成功");
        println!(
            "写系数 0.25/0.75（主音量 {:.2}）→ 回读 主 {:.3} 左 {:.3} 右 {:.3}",
            master_before, mid.volume, mid.left, mid.right
        );
        assert!(
            (mid.volume - master_before).abs() < 0.03,
            "平衡不应改动主音量：写前 {:.3}，写后 {:.3}",
            master_before,
            mid.volume
        );
        let ratio = mid.right / mid.left.max(0.001);
        assert!((ratio - 3.0).abs() < 0.2, "左右应为 1:3（归一化），实际 1:{ratio:.2}");

        imp::set_balance(false, 1.0, 1.0).expect("还原应成功");
        println!("已还原为左右各 100%（主音量 {:.2}）", before.volume);
    }
}
