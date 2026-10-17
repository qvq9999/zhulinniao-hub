//! EQ 真机通道 — 走与原版驱动相同的 APO PropertyStore 路径（ADR-002 双通道之音频通道）。
//!
//! 依据（均逐字取自原版 INF，非推测）：
//!   ApoDriver/Apo/01_EXTENSION/CM002X1_Ext.inf:502-521
//!   写入位置：HKR,FX\0\%CAPXMFX_PROPERTYSTORE_CONTEXT%\User
//!   CAPXMFX_PROPERTYSTORE_CONTEXT = {4C6C316B-C24F-421C-A266-690540CABD11}
//!   PKEY_Endpoint_Enable_EQ_GFX   = {BD341FFB-9FD1-4ED4-8159-7999D546EA8A},0
//!   PKEY_Endpoint_EQ_Slider1..10  = {BD341FFB-...},1 .. {BD341FFB-...},10
//!   PKEY_RENDER_EQ_BandFreq1..10  = {BD341FFB-...},11 .. {BD341FFB-...},20
//!
//! Windows 上该 FX 属性区落在端点注册表键下：
//!   HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\{端点GUID}\FxProperties
//! 因此本模块：取默认播放端点 GUID → 定位 FxProperties → 读写上述 DWORD 值。

use serde::{Deserialize, Serialize};

/// EQ 属性键的 GUID（原版 INF 定义）
pub const EQ_PKEY_GUID: &str = "BD341FFB-9FD1-4ED4-8159-7999D546EA8A";

/// 各字段对应的 PID（原版 INF 定义，逐条对应 PKEY_RENDER_EQ_*）
pub const PID_ENABLE: u32 = 0;
pub const PID_SLIDER1: u32 = 1; // 1..10  = EQ_Slider1..10    增益（-20..20，原版 SetBand 钳位）
pub const PID_BANDFREQ1: u32 = 11; // 11..20 = EQ_BandFreq1..10  频率 Hz
pub const PID_BANDQ1: u32 = 21; // 21..30 = EQ_BandQ1..10     Q×100（默认 14）
pub const PID_FILTERTYPE1: u32 = 31; // 31..40 = EQ_BandFilterType1..10（0..5）

/// EQ 增益量程（原版 EQViewModel.SetBand 硬钳位 ±20，非推测）
pub const EQ_GAIN_MIN: i32 = -20;
pub const EQ_GAIN_MAX: i32 = 20;

/// EQ 段 Q 值量程（原版 EQViewModel.SetQValue 硬钳位 5..100，非推测）
pub const Q_MIN: i32 = 5;
pub const Q_MAX: i32 = 100;

/// 滤波类型编号 → 名称（原版 EQ.xaml 语言文件逐条）
pub const EQ_FILTER_NAMES: [(&str, &str); 6] = [
    ("0", "Peaking (峰值)"),
    ("1", "LowPass (低通)"),
    ("2", "HighPass (高通)"),
    ("3", "Notch (陷波)"),
    ("4", "LowShelving (低搁架)"),
    ("5", "HighShelving (高搁架)"),
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct EqSnapshot {
    /// PKEY_Endpoint_Enable_EQ_GFX（0/1）
    pub enabled: bool,
    /// PKEY_Endpoint_EQ_Slider1..10 的原始值（-20..20）
    pub sliders: [i32; 10],
    /// PKEY_RENDER_EQ_BandFreq1..10（Hz）
    pub freqs: [i32; 10],
    /// PKEY_RENDER_EQ_BandQ1..10（Q×100）
    pub qs: [i32; 10],
    /// PKEY_RENDER_EQ_BandFilterType1..10（0..5）
    pub filters: [i32; 10],
    /// 实际写入/读取所在注册表路径（排障与取证用）
    pub store_path: String,
}

/// 其余效果属性键的 GUID（原版 INF:487-498 定义）
pub const FX_PKEY_GUID: &str = "5E96E4D9-FF2C-4D84-9BD6-FE10CF815009";

// ---------- 全字段映射表（原版 ZG3 实际可用的 9 项功能） ----------
//
// 每行对应原版 INF 的一条 HKR 行，格式：
//   (字段名, 是否录音端点, CAPX 上下文 GUID, 属性键 GUID, PID)
//
// 上下文归属见 docs/原版对齐规格.md「上下文归属总表」——写错上下文等于不生效。
// 这里**只列原版对 ZG3 实际提供的功能**（原版按 license 过滤后的 9 项 + 其子参数）。

pub const CTX_MFX_GUID: &str = "{4C6C316B-C24F-421C-A266-690540CABD11}";
pub const CTX_SFX_GUID: &str = "{C31A35A5-22EC-425E-9B74-B64700F067DA}";
pub const CTX_EFX_GUID: &str = "{9C97FB8F-7C45-4EF3-A5A8-67D0AC630E8F}";

/// 7.1环绕（CONLAB，播放 EFX）
pub const CONLAB_GUID: &str = "C020CDBF-756F-4B6D-9031-BE6E20CF1C9F";
/// 环绕扩增（Channel_COPY，播放 EFX）
pub const CHANNEL_COPY_GUID: &str = "31AF2432-4E37-47C5-9785-9D9529E07129";
/// 麦克风降噪（录音 MFX）
pub const MICNR_GUID: &str = "B1132012-70C8-49CF-B860-E34ADA163170";
/// 魔幻音效 / 麦克风回声（录音 MFX）
pub const MAGICVOICE_GUID: &str = "3BC6329A-2397-4FF3-92F5-2CD9894BB889";

/// 字段表：(字段名, capture, 上下文, 属性键 GUID, PID)
pub static FIELD_SPECS: &[(&str, bool, &str, &str, u32)] = &[
    // ---- 播放侧：7.1环绕（EFX / CONLAB）----
    ("surround71_enabled", false, CTX_EFX_GUID, CONLAB_GUID, 0),
    ("surround71_usehp", false, CTX_EFX_GUID, CONLAB_GUID, 1),
    ("surround71_roomsize", false, CTX_EFX_GUID, CONLAB_GUID, 2),
    ("surround71_mode", false, CTX_EFX_GUID, CONLAB_GUID, 5),
    // ---- 播放侧：音频明亮化（SFX）----
    ("brilliant_enabled", false, CTX_SFX_GUID, FX_PKEY_GUID, 0),
    ("brilliant_level", false, CTX_SFX_GUID, FX_PKEY_GUID, 1),
    // ---- 播放侧：人声清晰化（SFX）----
    ("clarity_enabled", false, CTX_SFX_GUID, FX_PKEY_GUID, 2),
    ("clarity_level", false, CTX_SFX_GUID, FX_PKEY_GUID, 3),
    ("clarity_ns", false, CTX_SFX_GUID, FX_PKEY_GUID, 4),
    // ---- 播放侧：动态低频（SFX）----
    ("bass_enabled", false, CTX_SFX_GUID, FX_PKEY_GUID, 5),
    ("bass_mode", false, CTX_SFX_GUID, FX_PKEY_GUID, 6),
    ("bass_level", false, CTX_SFX_GUID, FX_PKEY_GUID, 7),
    ("bass_cutoff", false, CTX_SFX_GUID, FX_PKEY_GUID, 8),
    ("bass_hpf_cutoff", false, CTX_SFX_GUID, FX_PKEY_GUID, 12),
    // ---- 播放侧：智能音量（⚠️ MFX，不是 SFX）----
    ("smartvol_enabled", false, CTX_MFX_GUID, FX_PKEY_GUID, 9),
    ("smartvol_level", false, CTX_MFX_GUID, FX_PKEY_GUID, 10),
    ("smartvol_mode", false, CTX_MFX_GUID, FX_PKEY_GUID, 11),
    // ---- 播放侧：环绕扩增（EFX）----
    ("surroundmax_enabled", false, CTX_EFX_GUID, CHANNEL_COPY_GUID, 0),
    // ---- 录音侧：麦克风降噪（MFX）----
    ("micnr_enabled", true, CTX_MFX_GUID, MICNR_GUID, 0),
    ("micnr_level", true, CTX_MFX_GUID, MICNR_GUID, 1),
    // ---- 录音侧：魔幻音效（MFX）----
    ("magicvoice_enabled", true, CTX_MFX_GUID, MAGICVOICE_GUID, 2),
    ("magicvoice_selection", true, CTX_MFX_GUID, MAGICVOICE_GUID, 3),
];

/// 查字段规格；未登记字段返回 None（调用方需报错而非静默吞掉）
pub fn field_spec(field: &str) -> Option<(bool, &'static str, &'static str, u32)> {
    FIELD_SPECS
        .iter()
        .find(|(name, _, _, _, _)| *name == field)
        .map(|(_, cap, ctx, guid, pid)| (*cap, *ctx, *guid, *pid))
}

/// 官方效果属性存储通道 —— Windows 11 `IAudioSystemEffectsPropertyStore`。
///
/// **为什么必须有这条通道**：直接写注册表虽然值能落盘，但音频引擎不会收到变更通知，
/// APO 只在流初始化时读一次，于是「调了参数但听不出变化」；而本接口的 `Commit()`
/// 会把变更推给音频引擎，APO 立即重读 → **实时生效**（与原版 SDK 的体感一致）。
///
/// 激活姿势（Microsoft «Windows 11 APIs for Audio Processing Objects»）：
/// `IMMDevice::Activate` 必须带一个 **VT_CLSID 的 PROPVARIANT**，值为该 APO 的
/// 属性存储上下文 GUID（MFX/SFX/EFX）；传空指针会得到 E_INVALIDARG（此前踩过的坑）。
#[cfg(windows)]
pub mod fx_store {
    use core::mem::MaybeUninit;
    use windows::core::{GUID, PROPVARIANT};
    use windows::Win32::Media::Audio::{
        eCapture, eRender, IAudioSystemEffectsPropertyStore, IMMDevice, IMMDeviceEnumerator,
        MMDeviceEnumerator, DEVICE_STATE_ACTIVE, EDataFlow,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
        STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PROPERTYKEY};

    #[link(name = "propsys")]
    extern "system" {
        fn InitPropVariantFromCLSID(clsid: *const GUID, ppropvar: *mut MaybeUninit<PROPVARIANT>) -> i32;
    }

    /// 解析 "{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" / 无花括号 / 无连字符 三种写法
    pub fn parse_guid(s: &str) -> Result<GUID, String> {
        let h: String = s
            .trim()
            .trim_start_matches('{')
            .trim_end_matches('}')
            .chars()
            .filter(|c| *c != '-')
            .collect();
        if h.len() != 32 {
            return Err(format!("GUID 格式不正确：{s}"));
        }
        let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).map_err(|e| e.to_string());
        let word = |i: usize| u16::from_str_radix(&h[i..i + 4], 16).map_err(|e| e.to_string());
        Ok(GUID {
            data1: u32::from_str_radix(&h[0..8], 16).map_err(|e| e.to_string())?,
            data2: word(8)?,
            data3: word(12)?,
            data4: [
                byte(16)?,
                byte(18)?,
                byte(20)?,
                byte(22)?,
                byte(24)?,
                byte(26)?,
                byte(28)?,
                byte(30)?,
            ],
        })
    }

    unsafe fn device(ep: &str, capture: bool) -> Result<IMMDevice, String> {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("音频子系统初始化失败：{e}"))?;
        let flow: EDataFlow = if capture { eCapture } else { eRender };
        let collection = enumerator
            .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
            .map_err(|e| format!("枚举端点失败：{e}"))?;
        for i in 0..collection.GetCount().unwrap_or(0) {
            if let Ok(dev) = collection.Item(i) {
                if let Ok(id) = dev.GetId() {
                    let s = id.to_string().unwrap_or_default();
                    let g = s.rsplit('.').next().unwrap_or(&s).to_string();
                    if g.eq_ignore_ascii_case(ep) {
                        return Ok(dev);
                    }
                }
            }
        }
        Err(format!("未找到端点 {ep}"))
    }

    fn open(ep: &str, capture: bool, context: &str) -> Result<IPropertyStore, String> {
        let ctx = parse_guid(context)?;
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let dev = device(ep, capture)?;
            let mut pv = MaybeUninit::<PROPVARIANT>::zeroed();
            let hr = InitPropVariantFromCLSID(&ctx, &mut pv);
            if hr < 0 {
                return Err(format!("InitPropVariantFromCLSID 失败：0x{:08X}", hr as u32));
            }
            let store: IAudioSystemEffectsPropertyStore = dev
                .Activate(CLSCTX_INPROC_SERVER, Some(pv.as_ptr()))
                .map_err(|e| format!("激活效果属性存储失败：{e}"))?;
            store
                .OpenUserPropertyStore(STGM_READWRITE.0)
                .map_err(|e| format!("打开用户属性存储失败：{e}"))
        }
    }

    /// 批量写入并 Commit（Commit 才是触发引擎重新读取的那一步）
    pub fn set_many(
        ep: &str,
        capture: bool,
        context: &str,
        pairs: &[(String, u32, i32)],
    ) -> Result<(), String> {
        let props = open(ep, capture, context)?;
        for (guid, pid, v) in pairs {
            let pk = PROPERTYKEY { fmtid: parse_guid(guid)?, pid: *pid };
            let pv = PROPVARIANT::from(*v as u32);
            unsafe {
                props
                    .SetValue(&pk, &pv)
                    .map_err(|e| format!("SetValue 失败：{e}"))?;
            }
        }
        unsafe { props.Commit().map_err(|e| format!("Commit 失败：{e}")) }
    }
}

/// 后端选择：唯一实现为 Windows 注册表「用户效果区」通道（本项目仅面向 Windows）。
#[cfg(windows)]
use fx_reg as backend;
#[cfg(not(windows))]
mod fx_reg {
    //! 非 Windows 平台占位：本项目只面向 Windows，这里保证跨平台 cargo check 不炸。
    pub fn eq_read() -> Result<super::EqSnapshot, String> {
        Err("仅支持 Windows".into())
    }
    pub fn eq_write(
        _e: Option<bool>,
        _s: Option<[i32; 10]>,
        _fr: Option<[i32; 10]>,
        _q: Option<[i32; 10]>,
        _f: Option<[i32; 10]>,
    ) -> Result<super::EqSnapshot, String> {
        Err("仅支持 Windows".into())
    }
    pub fn fields_read() -> Result<Vec<(String, i32)>, String> {
        Err("仅支持 Windows".into())
    }
    pub fn field_write(_field: &str, _v: i32) -> Result<Vec<(String, i32)>, String> {
        Err("仅支持 Windows".into())
    }
}
#[cfg(not(windows))]
use fx_reg as backend;

/// 真实生效通道 — 直接写原版 APO 使用的「用户效果区」注册表项。
///
/// 依据（全部实测，非推测）：
///   路径（原版 INF:96-125 `HKR,FX\0\%CAPX*_PROPERTYSTORE_CONTEXT%\User`）：
///     HKLM\...\MMDevices\Audio\{Render|Capture}\{端点GUID}\FxProperties\{CAPX上下文}\User
///     · MFX `{4C6C316B-…}`  EQ、智能音量、K歌、多声道EQ
///     · SFX `{C31A35A5-…}`  音频明亮化、动态低频、人声清晰化
///     · EFX `{9C97FB8F-…}`  7.1环绕(CONLAB)、环绕扩增、SS、VRMS
///   权限：以 `KEY_READ|KEY_SET_VALUE` 打开即可写（**实测免管理员**）；
///         `KEY_WRITE` 被 ACL 拒绝。端点通过枚举+名称命中耳机，避免写到别的设备。
#[cfg(windows)]
pub mod fx_reg {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
    use winreg::RegKey;

    /// 均衡器所在的 MFX 上下文 GUID（原版 INF:471）
    pub const CTX_MFX: &str = "{4C6C316B-C24F-421C-A266-690540CABD11}";
    /// 其余音效所在的 SFX 上下文 GUID（原版 INF:472）
    pub const CTX_SFX: &str = "{C31A35A5-22EC-425E-9B74-B64700F067DA}";
    /// EFX 上下文 GUID（原版 INF:470）——环境仿真音效(CONLAB)、环绕(SS)、麦克风均衡器(MICEQ)
    pub const CTX_EFX: &str = "{9C97FB8F-7C45-4EF3-A5A8-67D0AC630E8F}";

    /// 录音侧与播放侧的键位集合（全部取自原版 INF 逐行）
    /// 环境仿真音效 CONLAB（播放 EFX）
    pub const CONLAB_GUID: &str = "C020CDBF-756F-4B6D-9031-BE6E20CF1C9F";
    pub const CONLAB_ENABLE: u32 = 0;
    pub const CONLAB_ROOMSIZE: u32 = 2;
    pub const CONLAB_MODE: u32 = 5;
    /// 环绕 SS（播放 EFX）
    pub const SS_GUID: &str = "F9736E6B-5342-4690-82B7-95E78DF992A0";
    pub const SS_ENABLE: u32 = 0;
    /// 麦克风降噪（录音 MFX）
    pub const MICNR_GUID: &str = "B1132012-70C8-49CF-B860-E34ADA163170";
    pub const MICNR_ENABLE: u32 = 0;
    pub const MICNR_LEVEL: u32 = 1;
    /// 麦克风均衡器（录音 EFX）
    pub const MICEQ_GUID: &str = "9306F425-13AE-4078-8147-1EA5CB55CBF1";
    pub const MICEQ_ENABLE: u32 = 0;
    pub const MICEQ_LPF_ENABLE: u32 = 1;
    pub const MICEQ_LPF_FC: u32 = 2;
    pub const MICEQ_HPF_ENABLE: u32 = 3;
    pub const MICEQ_HPF_FC: u32 = 4;
    pub const MICEQ_PREGAIN: u32 = 5;

    /// 端点是否真的带 CAPX 用户效果区（MFX 上下文 `\User` 存在）。
    ///
    /// 为什么必须判：驱动重装/设备重插后，系统里会同时留下多个**同名**端点
    /// （本机实测有两个以上 `ZhuAudio ZG3`），只有继承了扩展 INF 属性区的那个才有
    /// `FxProperties\{4C6C316B-…}\User`。按名字取第一个会拿到空壳端点，
    /// 表现为「开关点不动」「写入失败：系统找不到指定的文件」。
    fn has_user_fx_store(guid: &str, capture: bool) -> bool {
        use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let path = user_store_path_flow(guid, super::CTX_MFX_GUID, capture);
        hklm.open_subkey_with_flags(&path, KEY_READ).is_ok()
    }

    /// 命中耳机端点 GUID（capture=true 取录音方向；与音量通道同一套关键字）
    pub fn endpoint_guid(capture: bool) -> Result<String, String> {
        if capture {
            return capture_endpoint_guid();
        }
        headset_endpoint_guid()
    }

    fn capture_endpoint_guid() -> Result<String, String> {
        use windows::Win32::Media::Audio::{
            eCapture, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        };
        use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
        use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
        use windows::core::GUID;

        const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
            fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
            pid: 14,
        };

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("音频子系统初始化失败：{e}"))?;
            if let Ok(collection) = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE) {
                let count = collection.GetCount().unwrap_or(0);
                // 同名端点可能有多个：优先选真正带 CAPX 效果区的那个，其余留作回退
                let mut fallback: Option<String> = None;
                for i in 0..count {
                    if let Ok(dev) = collection.Item(i) {
                        let name = (|| -> windows::core::Result<String> {
                            let store = dev.OpenPropertyStore(STGM_READ)?;
                            let value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME)?;
                            let pw = PropVariantToStringAlloc(&value)?;
                            Ok(pw.to_string().unwrap_or_default())
                        })()
                        .unwrap_or_default();
                        let n = name.to_ascii_lowercase();
                        if n.contains("zhuaudio")
                            || n.contains("zg3")
                            || n.contains("cm002x1")
                            || n.contains("c-media")
                            || name.contains("朱雀")
                        {
                            if let Ok(id) = dev.GetId() {
                                if let Ok(g) = id.to_string() {
                                    let guid = g.rsplit('.').next().unwrap_or(&g).to_string();
                                    if has_user_fx_store(&guid, true) {
                                        return Ok(guid);
                                    }
                                    if fallback.is_none() {
                                        fallback = Some(guid);
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(g) = fallback {
                    return Ok(g);
                }
            }
            let dev = enumerator
                .GetDefaultAudioEndpoint(eCapture, eConsole)
                .map_err(|e| format!("未找到录音端点：{e}"))?;
            let id = dev.GetId().map_err(|e| format!("读取端点 ID 失败：{e}"))?;
            let g = id.to_string().map_err(|e| format!("端点 ID 解码失败：{e}"))?;
            Ok(g.rsplit('.').next().unwrap_or(&g).to_string())
        }
    }

    /// 命中耳机端点的 GUID（与音量通道同一套关键字），失败回落系统默认端点
    pub fn headset_endpoint_guid() -> Result<String, String> {
        use windows::Win32::Media::Audio::{
            eCapture, eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
            DEVICE_STATE_ACTIVE, EDataFlow,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
        };
        use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
        use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
        use windows::core::GUID;

        const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
            fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
            pid: 14,
        };

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

        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("音频子系统初始化失败：{e}"))?;

            if let Ok(collection) =
                enumerator.EnumAudioEndpoints(eRender as EDataFlow, DEVICE_STATE_ACTIVE)
            {
                let count = collection.GetCount().unwrap_or(0);
                // 同名端点可能有多个：优先选真正带 CAPX 效果区的那个，其余留作回退
                let mut fallback: Option<String> = None;
                for i in 0..count {
                    if let Ok(dev) = collection.Item(i) {
                        let name = (|| -> windows::core::Result<String> {
                            let store = dev.OpenPropertyStore(STGM_READ)?;
                            let value = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME)?;
                            let pw = PropVariantToStringAlloc(&value)?;
                            Ok(pw.to_string().unwrap_or_default())
                        })()
                        .unwrap_or_default();
                        if is_headset(&name) {
                            if let Ok(id) = dev.GetId() {
                                if let Ok(s) = id.to_string() {
                                    let guid = s.rsplit('.').next().unwrap_or(&s).to_string();
                                    if has_user_fx_store(&guid, false) {
                                        return Ok(guid);
                                    }
                                    if fallback.is_none() {
                                        fallback = Some(guid);
                                    }
                                }
                            }
                        }
                    }
                }
                if let Some(g) = fallback {
                    return Ok(g);
                }
            }

            let dev = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("未找到播放端点：{e}"))?;
            let id = dev.GetId().map_err(|e| format!("读取端点 ID 失败：{e}"))?;
            let s = id.to_string().map_err(|e| format!("端点 ID 解码失败：{e}"))?;
            let _ = eCapture; // 仅用于枚举同向端点
            Ok(s.rsplit('.').next().unwrap_or(&s).to_string())
        }
    }

    /// 用户效果区路径（capture=true 走 Capture 端点）
    pub fn user_store_path(guid: &str, context: &str) -> String {
        user_store_path_flow(guid, context, false)
    }

    pub fn user_store_path_flow(guid: &str, context: &str, capture: bool) -> String {
        let flow = if capture { "Capture" } else { "Render" };
        format!(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\{}\\{}\\FxProperties\\{}\\User",
            flow, guid, context
        )
    }

    fn read_dword_named(key: &RegKey, guid: &str, pid: u32) -> Option<i32> {
        key.get_value::<u32, _>(format!("{{{}}},{}", guid_lc(guid), pid))
            .ok()
            .map(|v| v as i32)
    }

    fn write_dword_named(key: &RegKey, guid: &str, pid: u32, v: i32) -> Result<(), String> {
        key.set_value(format!("{{{}}},{}", guid_lc(guid), pid), &(v as u32))
            .map_err(|e| format!("写入失败：{e}"))
    }

    /// 写入一组 {GUID,pid} 值（通用）。
    ///
    /// 优先走**官方效果属性存储**（`SetValue` + `Commit` → 音频引擎收到变更、立即重读，实时生效）；
    /// 该通道不可用时退回裸写注册表（值照样落盘，但要等下一次流初始化才被 APO 读到）。
    pub fn write_named(
        capture: bool,
        context: &str,
        pairs: &[(String, u32, i32)],
    ) -> Result<(), String> {
        let ep = endpoint_guid(capture)?;
        if super::fx_store::set_many(&ep, capture, context, pairs).is_ok() {
            return Ok(());
        }
        let path = user_store_path_flow(&ep, context, capture);
        let key = open_for_write(&path)?;
        for (g, pid, v) in pairs {
            write_dword_named(&key, g, *pid, *v)?;
        }
        Ok(())
    }

    /// 读取 FIELD_SPECS 全部字段的真机值。
    ///
    /// 按 (capture, 上下文) 分组只开一次键；读不到的字段返回 i32::MIN（前端据此显示「未提供」）。
    /// 这是本项目**唯一的读取入口** —— 字段与 PID 的对应关系全部在 FIELD_SPECS 里，
    /// 杜绝散落各处的硬编码。
    pub fn fields_read() -> Result<Vec<(String, i32)>, String> {
        use std::collections::HashMap;

        let mut cache: HashMap<(bool, String), Option<RegKey>> = HashMap::new();
        let mut out: Vec<(String, i32)> = Vec::with_capacity(super::FIELD_SPECS.len());

        for (field, capture, ctx, guid, pid) in super::FIELD_SPECS {
            let k = (*capture, (*ctx).to_string());
            if !cache.contains_key(&k) {
                let entry = match endpoint_guid(*capture) {
                    Ok(ep) => {
                        let path = user_store_path_flow(&ep, ctx, *capture);
                        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
                        hklm.open_subkey_with_flags(&path, KEY_READ).ok()
                    }
                    Err(_) => None,
                };
                cache.insert(k.clone(), entry);
            }
            let v = cache
                .get(&k)
                .and_then(|o| o.as_ref())
                .and_then(|key| read_dword_named(key, guid, *pid))
                .unwrap_or(i32::MIN);
            out.push(((*field).to_string(), v));
        }
        Ok(out)
    }

    /// 写单个字段（字段名 → 规格查表，未知字段报错而非静默忽略），写后整体回读。
    pub fn field_write(field: &str, value: i32) -> Result<Vec<(String, i32)>, String> {
        let (capture, ctx, guid, pid) =
            super::field_spec(field).ok_or_else(|| format!("未知字段：{field}"))?;
        write_named(capture, ctx, &[(guid.to_string(), pid, value)])?;
        fields_read()
    }

    /// 效果区打不开时给出可执行的解释。
    ///
    /// 最常见原因不是权限，而是**厂商音频驱动没装/没生效**：设备回退到系统自带的
    /// `usbaudio`（UAC1 类驱动）后，注册表里根本不存在 `FxProperties\{CAPX}\User`，
    /// 表现为「所有效果开关灰掉 / 点不开」。此时裸的 os error 2 对用户毫无意义。
    fn store_open_err(path: &str, e: &std::io::Error) -> String {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!(
                "未找到厂商音频驱动效果区：设备可能正在使用系统自带的 USB Audio 驱动。\
                 请运行「竹林鸟朱雀 Hub」安装包（会一并安装 C-Media 音频驱动），装好后重开本程序。\
                 [路径] {path}"
            )
        } else {
            format!("打开用户效果区失败（{path}）：{e}")
        }
    }

    pub fn read_named(
        capture: bool,
        context: &str,
        pairs: &[(String, u32)],
    ) -> Result<Vec<i32>, String> {
        let ep = endpoint_guid(capture)?;
        let path = user_store_path_flow(&ep, context, capture);
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm
            .open_subkey_with_flags(&path, KEY_READ)
            .map_err(|e| store_open_err(&path, &e))?;
        Ok(pairs
            .iter()
            .map(|(g, pid)| read_dword_named(&key, g, *pid).unwrap_or(i32::MIN))
            .collect())
    }

    fn open_for_write(path: &str) -> Result<RegKey, String> {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        hklm.open_subkey_with_flags(path, KEY_READ | KEY_SET_VALUE)
            .map_err(|e| store_open_err(path, &e))
    }

    fn write_dword(key: &RegKey, pid_guid: &str, pid: u32, v: i32) -> Result<(), String> {
        key.set_value(format!("{{{}}},{}", pid_guid, pid), &(v as u32))
            .map_err(|e| format!("写入失败：{e}"))
    }

    fn read_dword(key: &RegKey, pid_guid: &str, pid: u32) -> Option<i32> {
        key.get_value::<u32, _>(format!("{{{}}},{}", pid_guid, pid))
            .ok()
            .map(|v| v as i32)
    }

    fn guid_lc(g: &str) -> String {
        g.to_lowercase()
    }

    /// 写 EQ：Enable + 10 段滑块（MFX 用户区）
    fn read_eq_arrays(key: &RegKey, g: &str) -> super::EqSnapshot {
        let mut sliders = [0i32; 10];
        let mut freqs = [30i32, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000];
        let mut qs = [14i32; 10];
        let mut filters = [0i32; 10];
        for i in 0..10u32 {
            if let Some(v) = read_dword(key, g, super::PID_SLIDER1 + i) {
                sliders[i as usize] = (v as u32 as i32).clamp(super::EQ_GAIN_MIN, super::EQ_GAIN_MAX);
            }
            if let Some(v) = read_dword(key, g, super::PID_BANDFREQ1 + i) {
                freqs[i as usize] = v;
            }
            if let Some(v) = read_dword(key, g, super::PID_BANDQ1 + i) {
                qs[i as usize] = v;
            }
            if let Some(v) = read_dword(key, g, super::PID_FILTERTYPE1 + i) {
                filters[i as usize] = v.clamp(0, 5);
            }
        }
        super::EqSnapshot {
            enabled: read_dword(key, g, super::PID_ENABLE).unwrap_or(0) != 0,
            sliders,
            freqs,
            qs,
            filters,
            store_path: String::new(),
        }
    }

    /// 写 EQ：Enable + 10 段增益 + 10 段滤波类型（MFX 用户区）
    ///
    /// 增益按原版 `SetBand` 的 ±20 钳位后再落盘，写入值必在设备可接受范围内。
    pub fn eq_write(
        enabled: Option<bool>,
        sliders: Option<[i32; 10]>,
        freqs: Option<[i32; 10]>,
        qs: Option<[i32; 10]>,
        filters: Option<[i32; 10]>,
    ) -> Result<super::EqSnapshot, String> {
        let ep = headset_endpoint_guid()?;

        // 收集本次要写的全部值，先尝试官方属性存储（Commit 后即时生效），失败再裸写注册表
        let mut pairs: Vec<(String, u32, i32)> = Vec::with_capacity(40);
        if let Some(on) = enabled {
            pairs.push((super::EQ_PKEY_GUID.to_string(), super::PID_ENABLE, if on { 1 } else { 0 }));
        }
        if let Some(s) = sliders {
            for i in 0..10usize {
                pairs.push((
                    super::EQ_PKEY_GUID.to_string(),
                    super::PID_SLIDER1 + i as u32,
                    s[i].clamp(super::EQ_GAIN_MIN, super::EQ_GAIN_MAX),
                ));
            }
        }
        if let Some(fr) = freqs {
            for i in 0..10usize {
                pairs.push((
                    super::EQ_PKEY_GUID.to_string(),
                    super::PID_BANDFREQ1 + i as u32,
                    fr[i].clamp(20, 20000),
                ));
            }
        }
        if let Some(q) = qs {
            // 原版 SetQValue 钳位 5..100（见 EQViewModel.cs:1124）
            for i in 0..10usize {
                pairs.push((
                    super::EQ_PKEY_GUID.to_string(),
                    super::PID_BANDQ1 + i as u32,
                    q[i].clamp(super::Q_MIN, super::Q_MAX),
                ));
            }
        }
        if let Some(f) = filters {
            for i in 0..10usize {
                pairs.push((
                    super::EQ_PKEY_GUID.to_string(),
                    super::PID_FILTERTYPE1 + i as u32,
                    f[i].clamp(0, 5),
                ));
            }
        }

        let path = user_store_path(&ep, CTX_MFX);
        if super::fx_store::set_many(&ep, false, CTX_MFX, &pairs).is_err() {
            // 回退：裸写注册表（值落盘，但要等下一次流初始化才被 APO 读到）
            let key = open_for_write(&path)?;
            let g = guid_lc(super::EQ_PKEY_GUID);
            for (_, pid, v) in &pairs {
                write_dword(&key, &g, *pid, *v)?;
            }
        }

        let key = open_for_write(&path)?;
        let g = guid_lc(super::EQ_PKEY_GUID);
        let mut snap = read_eq_arrays(&key, &g);
        snap.store_path = path;
        Ok(snap)
    }

    /// 读 EQ（MFX 用户区）
    pub fn eq_read() -> Result<super::EqSnapshot, String> {
        let ep = headset_endpoint_guid()?;
        let path = user_store_path(&ep, CTX_MFX);
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hklm
            .open_subkey_with_flags(&path, KEY_READ)
            .map_err(|e| store_open_err(&path, &e))?;
        let g = guid_lc(super::EQ_PKEY_GUID);
        let mut snap = read_eq_arrays(&key, &g);
        snap.store_path = path;
        Ok(snap)
    }

}

/// 端点 GUID → FxProperties 注册表路径（仅用于诊断输出）

/// 值名格式：{GUID},PID

/// 读取 EQ 状态（真实注册表）
#[tauri::command]
pub fn apo_eq_read() -> Result<EqSnapshot, String> {
    backend::eq_read()
}

/// 写入 EQ（Enabled / 10 段增益 / 频率 / Q / 滤波类型），返回写入后的真实回读结果。
/// 四项量程分别按原版 `SetBand`(±20)、`SetFreq`、`SetQValue`(5..100)、`SetFilter`(0..5) 钳位。
/// 传 `None` 表示不改该项（与原版「只写变更项」的行为一致）。
#[tauri::command]
pub fn apo_eq_write(
    enabled: Option<bool>,
    sliders: Option<Vec<i32>>,
    filters: Option<Vec<i32>>,
    freqs: Option<Vec<i32>>,
    qs: Option<Vec<i32>>,
) -> Result<EqSnapshot, String> {
    fn to_arr(v: Option<Vec<i32>>, what: &str) -> Result<Option<[i32; 10]>, String> {
        match v {
            Some(v) => {
                if v.len() != 10 {
                    return Err(format!("{what}需要 10 段数值"));
                }
                let mut a = [0i32; 10];
                a.copy_from_slice(&v);
                Ok(Some(a))
            }
            None => Ok(None),
        }
    }
    backend::eq_write(
        enabled,
        to_arr(sliders, "增益")?,
        to_arr(freqs, "频率")?,
        to_arr(qs, "Q 值")?,
        to_arr(filters, "滤波类型")?,
    )
}

/// 读取全部功能字段的真机值。
/// 返回 `[字段名, 值]` 列表；值 `i32::MIN` 表示该键在当前设备/端点上不存在。
#[tauri::command]
pub fn apo_fields_read() -> Result<Vec<(String, i32)>, String> {
    backend::fields_read()
}

/// 写单个功能字段（字段名见 `FIELD_SPECS`），写后返回全部字段的真实回读值。
#[tauri::command]
pub fn apo_field_write(field: String, value: i32) -> Result<Vec<(String, i32)>, String> {
    backend::field_write(&field, value)
}

/// 以管理员身份重新启动本程序。
/// 说明：当前注册表通道以 `KEY_READ|KEY_SET_VALUE` 打开即可写（实测免提权），
/// 本命令仅为历史遗留与排障保留，正常路径不需要提权。
#[tauri::command]
pub fn relaunch_elevated(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
            s.encode_wide().chain(std::iter::once(0)).collect()
        }

        let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径：{e}"))?;
        let file = wide(exe.as_os_str());
        let verb: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();

        let r = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(file.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if r.0 as usize <= 32 {
            return Err("提权启动被取消或被系统拒绝".to_string());
        }
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("仅支持 Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 字段表自检：每个字段都能查表命中，上下文取值合法，且 9 项功能全部覆盖。
    #[test]
    fn field_specs_are_consistent() {
        let valid_ctx = [CTX_MFX_GUID, CTX_SFX_GUID, CTX_EFX_GUID];
        for (name, _cap, ctx, guid, _pid) in FIELD_SPECS {
            assert!(valid_ctx.contains(ctx), "{name} 的上下文非法：{ctx}");
            assert_eq!(guid.len(), 36, "{name} 的 GUID 长度异常：{guid}");
            assert!(field_spec(name).is_some(), "{name} 应能查表命中");
        }
        // 9 项功能的 enabled 字段必须齐全
        for k in [
            "surround71_enabled",
            "brilliant_enabled",
            "bass_enabled",
            "smartvol_enabled",
            "clarity_enabled",
            "surroundmax_enabled",
            "magicvoice_enabled",
            "micnr_enabled",
        ] {
            assert!(field_spec(k).is_some(), "缺少字段 {k}");
        }
        // 智能音量必须是 MFX（写错到 SFX 会导致功能不生效）
        assert_eq!(field_spec("smartvol_enabled").unwrap().1, CTX_MFX_GUID);
        // 动态低频 / 明亮化 / 人声清晰化必须是 SFX
        assert_eq!(field_spec("bass_enabled").unwrap().1, CTX_SFX_GUID);
        assert_eq!(field_spec("brilliant_enabled").unwrap().1, CTX_SFX_GUID);
        assert_eq!(field_spec("clarity_enabled").unwrap().1, CTX_SFX_GUID);
        // 7.1环绕 / 环绕扩增必须是 EFX
        assert_eq!(field_spec("surround71_enabled").unwrap().1, CTX_EFX_GUID);
        assert_eq!(field_spec("surroundmax_enabled").unwrap().1, CTX_EFX_GUID);
        // 麦克风侧必须是录音端点
        assert!(field_spec("micnr_level").unwrap().0);
        assert!(field_spec("magicvoice_selection").unwrap().0);
    }

    /// 真机往返：读 → 写特征值 → 回读一致 → 还原。逐项覆盖 9 项功能的关键字段。
    #[test]
    fn fields_roundtrip_on_real_device() {
        let before = match backend::fields_read() {
            Ok(v) => v,
            Err(e) => {
                println!("跳过（无法读取真机字段）：{e}");
                return;
            }
        };
        let get = |name: &str| -> i32 {
            before
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| *v)
                .unwrap_or(i32::MIN)
        };

        // 打印核心功能的真机现值（供人工比对原版界面）
        for k in [
            "surround71_enabled",
            "surround71_roomsize",
            "surround71_mode",
            "brilliant_enabled",
            "brilliant_level",
            "bass_enabled",
            "bass_level",
            "bass_cutoff",
            "smartvol_enabled",
            "smartvol_level",
            "smartvol_mode",
            "clarity_enabled",
            "clarity_level",
            "clarity_ns",
            "surroundmax_enabled",
            "magicvoice_enabled",
            "magicvoice_selection",
            "micnr_enabled",
            "micnr_level",
        ] {
            println!("  {k} = {}", get(k));
        }

        // 逐项往返（只挑「可安全扰动并还原」的数值字段）
        let probes: &[(&str, i32)] = &[
            ("brilliant_level", 7),
            ("clarity_level", 6),
            ("clarity_ns", 9),
            ("bass_level", 8),
            ("bass_cutoff", 180),
            ("smartvol_level", 42),
            ("surround71_roomsize", 0),
            ("magicvoice_selection", 2),
            ("micnr_level", 20),
        ];
        for (field, probe) in probes {
            let orig = get(field);
            if orig == i32::MIN {
                println!("跳过 {field}：设备未提供该键");
                continue;
            }
            match backend::field_write(field, *probe) {
                Ok(after) => {
                    let now = after
                        .iter()
                        .find(|(k, _)| k == field)
                        .map(|(_, v)| *v)
                        .unwrap_or(i32::MIN);
                    println!("写 {field}={probe} → 回读 {now}");
                    assert_eq!(now, *probe, "{field} 回读应与写入一致");
                    backend::field_write(field, orig).expect("还原应成功");
                }
                Err(e) => println!("跳过 {field}：{e}"),
            }
        }
    }

    /// 真机往返：EQ 10 段增益 + 10 段滤波类型（写入值必落在 ±20 / 0..5 内）。
    #[test]
    fn eq_roundtrip_writes_real_property_store() {
        let before = match backend::eq_read() {
            Ok(v) => v,
            Err(e) => {
                println!("跳过：{e}");
                return;
            }
        };
        println!(
            "原始：enabled={} sliders={:?} qs={:?} filters={:?} path={}",
            before.enabled, before.sliders, before.qs, before.filters, before.store_path
        );

        let probe: [i32; 10] = [12, -12, 5, -5, 3, -3, 2, -2, 1, -1];
        let filt: [i32; 10] = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3];
        let after =
            backend::eq_write(Some(true), Some(probe), None, None, Some(filt)).expect("写入应成功");
        assert_eq!(after.sliders, probe, "增益回读应等于写入值");
        assert_eq!(after.filters, filt, "滤波类型回读应等于写入值");
        assert!(after.enabled, "Enable 应为 true");

        // 越界钳位：写入 ±40 应被夹到 ±20
        let over = backend::eq_write(None, Some([40i32; 10]), None, None, None).expect("越界写入应成功");
        assert_eq!(over.sliders, [EQ_GAIN_MAX; 10], "越界增益应被钳位到 +20");

        // Q 值越界钳位（原版 SetQValue 5..100）
        let qover = backend::eq_write(None, None, None, Some([200i32; 10]), None).expect("Q 写入应成功");
        assert_eq!(qover.qs, [Q_MAX; 10], "越界 Q 应被钳位到 100");

        let restored = backend::eq_write(
            Some(before.enabled),
            Some(before.sliders),
            Some(before.freqs),
            Some(before.qs),
            Some(before.filters),
        )
        .expect("还原应成功");
        assert_eq!(restored.sliders, before.sliders, "应已还原增益");
        assert_eq!(restored.filters, before.filters, "应已还原滤波类型");
        println!("已还原：enabled={} sliders={:?}", restored.enabled, restored.sliders);
    }
}
