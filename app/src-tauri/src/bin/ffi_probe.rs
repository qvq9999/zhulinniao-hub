//! FFI 可行性探针（临时工具，验证后可删）：
//! 验证三个厂商 DLL 能否在本机加载并与朱雀 ZG3 通信。
//! 1. cmjokkoo.dll    — CmInit / CmGetDevice / CmSendFeature(AppSync 请求)
//! 2. CmXearSDK.dll   — CmXearInit / CmGetAudioEndpoint
//! 3. CmFirmwareUpdateSDK.dll — Init / CmGetDevice / CmGetDeviceProperty(版本/型号/电池)
//!
//! 运行：cargo run --bin ffi_probe

use windows::core::{PCSTR, PCWSTR};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

type CmErrFn = extern "system" fn() -> i32;
type CmErrFnVid = extern "system" fn(i32) -> i32;
type CmGetDeviceFn =
    extern "system" fn(*mut i32, *mut i32, *mut *mut u8) -> i32;
type CmSendFeatureFn = extern "system" fn(
    *const u8, // devUid (GUID 16 bytes)
    i32,
    i32,
    i32,
    i32,
    *const u8,
    i32,
) -> i32;
type CmXearEndpointFn = extern "system" fn(*mut i32, *mut i32, *mut *mut u8) -> i32;
type CmFwGetDeviceFn = extern "system" fn(i32, i32, *mut i32, *mut i32, *mut *mut u8) -> i32;
type CmFwGetPropFn = extern "system" fn(
    *const u8,
    *const u16,
    i32,
    i32,
    *const u8,
    *mut i32,
    *mut i32,
    *mut *mut u8,
) -> i32;

fn wide(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}

unsafe fn get_proc(h: HMODULE, name: &str) -> Option<usize> {
    let c = format!("{}\0", name);
    GetProcAddress(h, PCSTR(c.as_ptr())).map(|f| f as usize)
}

extern "system" fn evt_cb(
    _evt: i32,
    _uid: *const u8,
    _cmd: i32,
    _feat: i32,
    _param: i32,
    _data: i32,
    _ext: *const u8,
    _ext_len: i32,
    _usr: *mut u8,
) {
    // 仅用于触发 Jokkoo 内部设备监控线程
}

fn guid_str(g: &[u8; 16]) -> String {
    let d1 = u32::from_le_bytes([g[0], g[1], g[2], g[3]]);
    let d2 = u16::from_le_bytes([g[4], g[5]]);
    let d3 = u16::from_le_bytes([g[6], g[7]]);
    format!(
        "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
        d1, d2, d3, g[8], g[9], g[10], g[11], g[12], g[13], g[14], g[15]
    )
}

fn main() {
    let vendor_dir = r"E:\ZHUAUDIO HUB (CM002X1)\UI";
    // 让厂商 DLL 的依赖（同目录其他 DLL）可被解析
    let r = unsafe {
        windows::Win32::System::LibraryLoader::SetDllDirectoryW(PCWSTR(wide(vendor_dir).as_ptr()))
    };
    println!("SetDllDirectoryW({}) -> {}", vendor_dir, r.is_ok());

    // ---------- 1. cmjokkoo.dll ----------
    println!("\n===== cmjokkoo.dll =====");
    unsafe {
        // 先试目录内短名，失败则回退到绝对路径
        let h = match LoadLibraryW(PCWSTR(wide("cmjokkoo.dll").as_ptr())) {
            Ok(h) => h,
            Err(e1) => match LoadLibraryW(PCWSTR(
                wide(r"E:\ZHUAUDIO HUB (CM002X1)\UI\CmJokkoo.dll").as_ptr(),
            )) {
                Ok(h) => h,
                Err(e2) => {
                    println!("LoadLibrary FAILED: short={e1} full={e2}");
                    return;
                }
            },
        };
        println!("loaded, handle={:?}", h);
        let cm_init: CmErrFnVid = std::mem::transmute(get_proc(h, "CmInit").expect("CmInit"));
        let cm_deinit: CmErrFn = std::mem::transmute(get_proc(h, "CmDeinit").expect("CmDeinit"));
        let cm_get_device: CmGetDeviceFn =
            std::mem::transmute(get_proc(h, "CmGetDevice").expect("CmGetDevice"));
        let cm_send: CmSendFeatureFn =
            std::mem::transmute(get_proc(h, "CmSendFeature").expect("CmSendFeature"));

        let err = cm_init(0x0D8C);
        println!("CmInit(0x0D8C) -> err={err} (0=Ok)");

        // 注册事件（设备可能是异步到达的）
        let cb: extern "system" fn(i32, *const u8, i32, i32, i32, i32, *const u8, i32, *mut u8) =
            evt_cb;
        let reg: extern "system" fn(usize, *mut u8) -> i32 =
            std::mem::transmute(get_proc(h, "CmRegisterEvent").expect("CmRegisterEvent"));
        let r = reg(cb as usize, std::ptr::null_mut());
        println!("CmRegisterEvent -> err={r}");

        // 轮询枚举（异步设备到达）
        let mut dat_type: i32 = 0;
        let mut arr_len: i32 = 0;
        let mut arr_dat: *mut u8 = std::ptr::null_mut();
        let mut err = -1;
        for i in 0..20 {
            dat_type = 0;
            arr_len = 0;
            arr_dat = std::ptr::null_mut();
            err = cm_get_device(&mut dat_type, &mut arr_len, &mut arr_dat);
            if err == 0 && arr_len > 0 {
                println!("CmGetDevice -> FOUND on try {i}: len={arr_len}");
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        println!("CmGetDevice -> err={err} datType={dat_type} len={arr_len}");
        if err == 0 && arr_len > 0 && !arr_dat.is_null() {
            let guids =
                std::slice::from_raw_parts(arr_dat, (arr_len as usize) * 16);
            for i in 0..arr_len as usize {
                let mut g = [0u8; 16];
                g.copy_from_slice(&guids[i * 16..i * 16 + 16]);
                let uid = g;

                // AppSync 同步请求（feat 255, param 1）——无害的读通道测试
                let err2 = cm_send(uid.as_ptr(), 119, 255, 1, 0, std::ptr::null(), 0);
                println!("  device[{}] {} AppSyncRequest -> err={err2}", i, guid_str(&g));
            }
        }
        let _ = cm_deinit();
    }

    // ---------- 2. CmXearSDK.dll ----------
    println!("\n===== CmXearSDK.dll =====");
    unsafe {
        let loaded = LoadLibraryW(PCWSTR(wide("CmXearSDK.dll").as_ptr()));
        if let Ok(h) = loaded {
            let init: CmErrFn = std::mem::transmute(get_proc(h, "CmXearInit").expect("CmXearInit"));
            let get_ep: CmXearEndpointFn =
                std::mem::transmute(get_proc(h, "CmGetAudioEndpoint").expect("CmGetAudioEndpoint"));
            let err = init();
            println!("CmXearInit -> err={err}");
            let mut dat_type: i32 = 0;
            let mut arr_len: i32 = 0;
            let mut arr_dat: *mut u8 = std::ptr::null_mut();
            let err = get_ep(&mut dat_type, &mut arr_len, &mut arr_dat);
            println!("CmGetAudioEndpoint -> err={err} datType={dat_type} len={arr_len}");
            if err == 0 && arr_len > 0 && !arr_dat.is_null() {
                let guids = std::slice::from_raw_parts(arr_dat, (arr_len as usize) * 16);
                for i in 0..arr_len as usize {
                    let mut g = [0u8; 16];
                    g.copy_from_slice(&guids[i * 16..i * 16 + 16]);
                    println!("  endpoint[{}] {}", i, guid_str(&g));
                }
            }
        }
    }

    // ---------- 3. CmFirmwareUpdateSDK.dll ----------
    println!("\n===== CmFirmwareUpdateSDK.dll =====");
    unsafe {
        let h = LoadLibraryW(PCWSTR(wide("CmFirmwareUpdateSDK.dll").as_ptr()));
        if let Ok(h) = h {
            let init: CmErrFn =
                std::mem::transmute(get_proc(h, "CmFirmwareUpdateInit").expect("CmFirmwareUpdateInit"));
            let get_dev: CmFwGetDeviceFn =
                std::mem::transmute(get_proc(h, "CmGetDevice").expect("CmGetDevice"));
            let get_prop: CmFwGetPropFn =
                std::mem::transmute(get_proc(h, "CmGetDeviceProperty").expect("CmGetDeviceProperty"));
            let err = init();
            println!("CmFirmwareUpdateInit -> err={err}");
            let mut dat_type: i32 = 0;
            let mut arr_len: i32 = 0;
            let mut arr_dat: *mut u8 = std::ptr::null_mut();
            let mut err = -1;
            for i in 0..8 {
                dat_type = 0;
                arr_len = 0;
                arr_dat = std::ptr::null_mut();
                err = get_dev(0x0D8C, 0x0334, &mut dat_type, &mut arr_len, &mut arr_dat);
                if err == 0 && arr_len > 0 {
                    println!("CmGetDevice -> FOUND on try {i}: len={arr_len}");
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            println!("CmGetDevice(0D8C,0334) -> err={err} datType={dat_type} len={arr_len}");
            if err == 0 && arr_len > 0 && !arr_dat.is_null() {
                let guids = std::slice::from_raw_parts(arr_dat, (arr_len as usize) * 16);
                for i in 0..arr_len as usize {
                    let mut g = [0u8; 16];
                    g.copy_from_slice(&guids[i * 16..i * 16 + 16]);
                    println!("  fw-device[{}] {}", i, guid_str(&g));
                    for prop in ["FirmwareVersion", "ModelName", "ProjectID"] {
                        let pw = wide(prop);
                        let mut ot: i32 = 0;
                        let mut ol: i32 = 0;
                        let mut od: *mut u8 = std::ptr::null_mut();
                        // CmDataType2: Int32=2, CmWString=5, Float=3, Byte=4
                        let e = get_prop(
                            g.as_ptr(),
                            pw.as_ptr(),
                            2,
                            0,
                            std::ptr::null(),
                            &mut ot,
                            &mut ol,
                            &mut od,
                        );
                        let mut val = String::new();
                        if e == 0 && ol > 0 && !od.is_null() {
                            if ot == 2 {
                                let v = *(od as *const i32);
                                val = format!("int={v}");
                            } else if ot == 5 {
                                // CmWString 数组：每个元素是 IntPtr
                                let ptrs = std::slice::from_raw_parts(od as *const *const u16, ol as usize);
                                let mut parts = Vec::new();
                                for p in ptrs {
                                    if !p.is_null() {
                                        let mut len = 0usize;
                                        while *p.add(len) != 0 {
                                            len += 1;
                                        }
                                        let s = String::from_utf16_lossy(std::slice::from_raw_parts(*p, len));
                                        parts.push(s);
                                    }
                                }
                                val = format!("str={:?}", parts);
                            } else {
                                val = format!("type={ot} len={ol}");
                            }
                        }
                        println!("    {prop} -> err={e} {val}");
                    }
                }
            }
        } else {
            println!("LoadLibrary FAILED");
        }
    }
    println!("\n===== probe done =====");
}
