use windows::core::{PCWSTR, HSTRING};
use windows::Win32::System::LibraryLoader::LoadLibraryW;
fn wide(s: &str) -> Vec<u16> { HSTRING::from(s).as_wide().iter().copied().collect() }
fn try_load(label: &str, path: &str) {
    unsafe {
        match LoadLibraryW(PCWSTR(wide(path).as_ptr())) {
            Ok(h) => println!("{label} -> OK {:?}", h),
            Err(e) => println!("{label} -> FAIL {e}"),
        }
    }
}
fn main() {
    try_load("temp-dir", r"C:/Users/Administrator/AppData/Local/Temp/CmJokkoo.dll");
    try_load("workspace", r"E:/Codex wenjian/zhulinniao hub/.workbuddy/artifacts/2026-10-16/CmJokkoo.dll");
}
