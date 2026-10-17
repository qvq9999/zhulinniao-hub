// 平衡探针：确认「写左右声道音量」在本机会不会连带改动主音量。
// 用法：cargo run --release --bin balance_probe
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

fn dump(tag: &str, v: &IAudioEndpointVolume) {
    unsafe {
        let master = v.GetMasterVolumeLevelScalar().unwrap_or(-1.0);
        let ch = v.GetChannelCount().unwrap_or(0);
        let l = v.GetChannelVolumeLevelScalar(0).unwrap_or(-1.0);
        let r = v.GetChannelVolumeLevelScalar(1).unwrap_or(-1.0);
        let db = v.GetMasterVolumeLevel().map(|d| d).unwrap_or(f32::NAN);
        println!("{tag}: master={master:.3} ({db:.1} dB) channels={ch} ch0={l:.3} ch1={r:.3}");
    }
}

fn main() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumr: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).expect("枚举器创建失败");
        let dev = enumr.GetDefaultAudioEndpoint(eRender, eConsole).expect("取端点失败");
        let v: IAudioEndpointVolume = dev.Activate(CLSCTX_ALL, None).expect("音量接口失败");

        dump("before  ", &v);
        let original_l = v.GetChannelVolumeLevelScalar(0).unwrap_or(1.0);
        let original_r = v.GetChannelVolumeLevelScalar(1).unwrap_or(1.0);
        let original_m = v.GetMasterVolumeLevelScalar().unwrap_or(1.0);

        // 模拟滑杆推到最左：左 100% / 右 0%
        let r1 = v.SetChannelVolumeLevelScalar(0, 1.0, std::ptr::null());
        let r2 = v.SetChannelVolumeLevelScalar(1, 0.0, std::ptr::null());
        println!("set ch0=1.0 -> {r1:?};  set ch1=0.0 -> {r2:?}");
        dump("after-L ", &v);

        // 模拟推回中间：左右各 100%
        let _ = v.SetChannelVolumeLevelScalar(0, 1.0, std::ptr::null());
        let _ = v.SetChannelVolumeLevelScalar(1, 1.0, std::ptr::null());
        dump("after-C ", &v);

        // 还原
        let _ = v.SetChannelVolumeLevelScalar(0, original_l, std::ptr::null());
        let _ = v.SetChannelVolumeLevelScalar(1, original_r, std::ptr::null());
        let _ = v.SetMasterVolumeLevelScalar(original_m, std::ptr::null());
        dump("restored", &v);
    }
}
