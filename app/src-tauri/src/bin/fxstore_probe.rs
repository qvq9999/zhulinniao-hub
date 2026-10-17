//! 探针：验证能否通过**官方属性存储接口**读写效果属性（这是「实时生效」的关键）。
//!
//! 正确姿势（Microsoft 文档 «Windows 11 APIs for Audio Processing Objects»）：
//!   InitPropVariantFromCLSID(propertyStoreContext, &pv)
//!   device->Activate(IID_IAudioSystemEffectsPropertyStore, CLSCTX_INPROC_SERVER, &pv, &store)
//!   store->OpenUserPropertyStore(STGM_READ / STGM_READWRITE, &props)
//! 之前传 nullptr 激活参数才会得到 E_INVALIDARG。
//!
//! 本探针只读 + 尝试只读打开写模式（不改任何值），用于判定：
//!   1) 带上下文 GUID 能否激活成功；
//!  2) READWRITE 是否真的需要管理员；
//!  3) 属性存储里的值是否与注册表一致（=音频引擎缓存是否已过期）。

#![cfg(windows)]

use core::mem::MaybeUninit;
use windows::core::{GUID, PROPVARIANT};
use windows::Win32::Media::Audio::{
    eCapture, eRender, IAudioSystemEffectsPropertyStore, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, DEVICE_STATE_ACTIVE, EDataFlow,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, StructuredStorage::PropVariantToInt32,
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STGM_READ, STGM_READWRITE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PROPERTYKEY};

#[link(name = "propsys")]
extern "system" {
    fn InitPropVariantFromCLSID(clsid: *const GUID, ppropvar: *mut MaybeUninit<PROPVARIANT>) -> i32;
}

const PKEY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

const EQ_PKEY: GUID = GUID::from_u128(0xBD341FFB_9FD1_4ED4_8159_7999D546EA8A);
const MV_PKEY: GUID = GUID::from_u128(0x3BC6329A_2397_4FF3_92F5_2CD9894BB889);
const CTX_MFX: GUID = GUID::from_u128(0x4C6C316B_C24F_421C_A266_690540CABD11);
const CTX_SFX: GUID = GUID::from_u128(0xC31A35A5_22EC_425E_9B74_B64700F067DA);
const CTX_EFX: GUID = GUID::from_u128(0x9C97FB8F_7C45_4EF3_A5A8_67D0AC630E8F);

unsafe fn find_device(flow: EDataFlow) -> Option<IMMDevice> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER).ok()?;
    let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE).ok()?;
    for i in 0..collection.GetCount().unwrap_or(0) {
        if let Ok(dev) = collection.Item(i) {
            let name = (|| -> windows::core::Result<String> {
                let store = dev.OpenPropertyStore(STGM_READ)?;
                let v = store.GetValue(&PKEY_NAME)?;
                let s = PropVariantToStringAlloc(&v)?;
                Ok(s.to_string().unwrap_or_default())
            })()
            .unwrap_or_default();
            if name.to_ascii_lowercase().contains("zhuaudio") {
                println!("端点：{name}");
                return Some(dev);
            }
        }
    }
    None
}

unsafe fn ctx_pv(ctx: GUID) -> MaybeUninit<PROPVARIANT> {
    let mut pv = MaybeUninit::<PROPVARIANT>::zeroed();
    let hr = InitPropVariantFromCLSID(&ctx, &mut pv);
    println!("  InitPropVariantFromCLSID -> 0x{:08X}", hr as u32);
    pv
}

unsafe fn dump_store(
    label: &str,
    dev: &IMMDevice,
    ctx: GUID,
    ctx_name: &str,
    keys: &[(GUID, u32, &str)],
) {
    println!("\n--- {label} / {ctx_name} ---");
    let pv = ctx_pv(ctx);
    let store: IAudioSystemEffectsPropertyStore =
        match dev.Activate(CLSCTX_INPROC_SERVER, Some(pv.as_ptr())) {
            Ok(s) => s,
            Err(e) => {
                println!("  Activate 失败：{e}");
                return;
            }
        };
    println!("  Activate(带上下文 GUID) 成功");

    match store.OpenUserPropertyStore(STGM_READ.0) {
        Ok(_) => println!("  OpenUserPropertyStore(READ) 成功"),
        Err(e) => println!("  OpenUserPropertyStore(READ) 失败：{e}"),
    }
    match store.OpenUserPropertyStore(STGM_READWRITE.0) {
        Ok(_) => println!("  OpenUserPropertyStore(READWRITE) 成功（非管理员也能写）"),
        Err(e) => println!("  OpenUserPropertyStore(READWRITE) 失败：{e}（预期为需要管理员）"),
    }

    if let Ok(props) = store.OpenUserPropertyStore(STGM_READ.0) {
        for (guid, pid, name) in keys {
            let pk = PROPERTYKEY { fmtid: *guid, pid: *pid };
            match props.GetValue(&pk) {
                Ok(v) => {
                    let n = PropVariantToInt32(&v).unwrap_or(i32::MIN);
                    println!("    {name} = {n}{}", if n == i32::MIN { "（非整数/空）" } else { "" });
                }
                Err(e) => println!("    {name} 读取失败：{e}"),
            }
        }
    }
}

fn main() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        if let Some(dev) = find_device(eRender) {
            let keys = [
                (EQ_PKEY, 0u32, "Enable_EQ_GFX"),
                (EQ_PKEY, 1, "EQ_Slider1"),
                (EQ_PKEY, 2, "EQ_Slider2"),
                (EQ_PKEY, 5, "EQ_Slider5"),
            ];
            dump_store("Render", &dev, CTX_MFX, "MFX(EQ)", &keys);
            dump_store("Render", &dev, CTX_SFX, "SFX", &keys);
            dump_store("Render", &dev, CTX_EFX, "EFX", &keys);
        } else {
            println!("未找到 Render 端点");
        }

        if let Some(dev) = find_device(eCapture) {
            let keys = [(MV_PKEY, 2u32, "Enable_MAGICVOICE"), (MV_PKEY, 3, "MagicVoice_Selection")];
            dump_store("Capture", &dev, CTX_MFX, "MFX(MagicVoice)", &keys);
        } else {
            println!("未找到 Capture 端点");
        }

        CoUninitialize();
    }
}
