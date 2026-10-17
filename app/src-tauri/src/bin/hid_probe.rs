//! HID 探针：枚举 0D8C:0334 的全部 HID 接口（用途页/用途/接口号），
//! 并尝试一次无害的 feature report 读取，判断设备侧控制通道是否可用。

fn main() {
    let api = match hidapi::HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            println!("HidApi::new FAILED: {e}");
            return;
        }
    };
    println!("total HID devices: {}", api.device_list().count());
    let mut n = 0;
    for d in api.device_list() {
        if d.vendor_id() != 0x0D8C {
            continue;
        }
        n += 1;
        println!(
            "\n[{}] {:04X}:{:04X} if={} page=0x{:04X} usage=0x{:04X}\n    path={}\n    product={:?} manufacturer={:?} serial={:?}",
            n,
            d.vendor_id(),
            d.product_id(),
            d.interface_number(),
            d.usage_page(),
            d.usage(),
            d.path().to_string_lossy(),
            d.product_string(),
            d.manufacturer_string(),
            d.serial_number()
        );

        // 无害读取：feature report（多数 CMedia 控制通道走 feature report）
        match d.open_device(&api) {
            Ok(dev) => {
                let mut buf = [0u8; 65];
                for rid in [0u8, 1, 2, 3, 0x77] {
                    buf[0] = rid;
                    match dev.get_feature_report(&mut buf[..]) {
                        Ok(len) => {
                            if len > 0 {
                                println!(
                                    "    get_feature_report(rid=0x{rid:02X}) -> len={len} data={:02X?}",
                                    &buf[..len.min(32)]
                                );
                            }
                        }
                        Err(e) => {
                            // 静默：多数 report id 不存在
                            let _ = e;
                        }
                    }
                }
            }
            Err(e) => println!("    open FAILED: {e}"),
        }
    }
    if n == 0 {
        println!("\nNO 0D8C device found on HID bus");
    }
    println!("\n===== hid probe done =====");
}
