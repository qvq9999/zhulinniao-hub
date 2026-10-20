//! 应用内更新：查询 GitHub 最新 Release → 下载 NSIS 安装包 → 静默覆盖安装。
//!
//! 为什么不用 reqwest / tauri-plugin-updater：
//!   - 引入 rustls/hyper 会多出几十个 crate，构建体积和编译时间都要涨；
//!   - Windows 10 1803+ 自带 `curl.exe`（System32），TLS、系统代理、证书链都由系统处理；
//!   - tauri-plugin-updater 需要额外维护签名私钥与 .sig 资产，个人项目没必要。
//!
//! 因此统一走 `%SystemRoot%\System32\curl.exe`（用绝对路径，避免被 Git 自带的 curl 顶掉）。

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// 最新 Release 的 API（换仓库时只需改这里）
const API_LATEST: &str = "https://api.github.com/repos/qvq9999/zhulinniao-hub/releases/latest";
/// 网页端 latest（302 跳转到 /releases/tag/vX.Y.Z），**不消耗 API 配额**
const WEB_LATEST: &str = "https://github.com/qvq9999/zhulinniao-hub/releases/latest";
/// 资产命名规则：与发版脚本保持一致，备用通道靠它推导下载地址
const ASSET_PREFIX: &str = "ZhulinniaoHub";
const DOWNLOAD_BASE: &str = "https://github.com/qvq9999/zhulinniao-hub/releases/download";

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

/// GitHub 出错时的响应体：`{"message":"API rate limit exceeded ..."}`
///
/// 为什么需要它：curl 对 **HTTP 4xx/5xx 仍算成功退出**（退出码 0），
/// 于是限流 JSON 会被当成 Release 结构去解析 → 报出「解析 Release 失败」这种误导文案。
/// 用户 2026-10-20 反馈的正是这一条：本机出口 IP 的匿名配额（60 次/小时）被耗尽。
#[derive(Debug, Deserialize)]
struct GhApiError {
    message: String,
}

/// 把 GitHub 的错误响应翻译成可读原因；不是错误响应则返回 None
fn describe_api_error(text: &str) -> Option<String> {
    let e: GhApiError = serde_json::from_str(text).ok()?;
    let m = e.message;
    let low = m.to_ascii_lowercase();
    Some(if low.contains("rate limit") {
        "GitHub 接口访问次数已超限（未登录 60 次/小时，按出口 IP 计）".to_string()
    } else if low.contains("not found") {
        format!("仓库或 Release 不存在（{m}）")
    } else {
        format!("GitHub 返回错误：{m}")
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// 当前运行版本
    pub current: String,
    /// 远端最新版本（去掉前导 v）
    pub latest: String,
    pub newer: bool,
    pub notes: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_size: u64,
    pub digest: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: u64,
    percent: f64,
}

fn curl_path() -> String {
    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    format!("{sys}\\System32\\curl.exe")
}

/// 构造 curl 命令，并**始终带上 CREATE_NO_WINDOW**。
///
/// 为什么不直接 `Command::new(curl_path())`：GUI 进程（本应用）spawn 控制台程序时，
/// Windows 默认会给子进程新建一个控制台 —— 用户看到的就是「点检查更新弹一下黑色终端窗」。
/// `/S` 静默安装那条命令早就带了该标志，这里补上查询/下载两条，全程无窗口。
fn curl_cmd() -> Command {
    let mut cmd = Command::new(curl_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// "1.2.3" → [1,2,3]；容忍前导 v 与多余后缀
fn parse_ver(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<u64>().unwrap_or(0))
        .collect()
}

/// `a` 是否比 `b` 新
fn is_newer(a: &str, b: &str) -> bool {
    let (x, y) = (parse_ver(a), parse_ver(b));
    let n = x.len().max(y.len());
    for i in 0..n {
        let xa = x.get(i).copied().unwrap_or(0);
        let yb = y.get(i).copied().unwrap_or(0);
        if xa != yb {
            return xa > yb;
        }
    }
    false
}

fn fetch_latest() -> Result<GhRelease, String> {
    let out = curl_cmd()
        .args([
            "-sS",
            "-L",
            // 代理/杀毒软件做 TLS 中间人时，schannel 的吊销检查会失败（CRYPT_E_NO_REVOCATION_CHECK）
            "--ssl-no-revoke",
            "--max-time",
            "25",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            API_LATEST,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("无法调用 curl.exe：{e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("查询更新失败（curl 退出码 {:?}）：{err}", out.status.code()));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() {
        return Err("查询更新失败：GitHub 返回空内容（可能是网络受限）".into());
    }
    // 先判是不是 GitHub 的错误响应（限流 / 404），否则会被误报成「解析 Release 失败」
    if let Some(desc) = describe_api_error(&text) {
        return Err(desc);
    }
    serde_json::from_str::<GhRelease>(&text).map_err(|e| {
        let head: String = text.chars().take(120).collect();
        format!("解析 Release 失败：{e}；返回内容开头：{head}")
    })
}

/// 备用通道：读 `/releases/latest` 的 302 Location 取 tag。
///
/// 这条走 github.com 网页端点，**不消耗 API 配额**（匿名 API 只有 60 次/小时/IP），
/// 因此 API 被限流时仍能判断「有没有新版本」。
fn fetch_tag_via_redirect() -> Option<String> {
    let out = curl_cmd()
        // 注意：**不加 -L**，要的就是 302 本身
        .args(["-sS", "-I", "--ssl-no-revoke", "--max-time", "15", WEB_LATEST])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .filter(|l| l.to_ascii_lowercase().starts_with("location:"))
        .filter_map(|l| l.split_once(':').map(|(_, v)| v.trim().to_string()))
        .find_map(|u| {
            let idx = u.find("/releases/tag/")?;
            let tail = &u[idx + "/releases/tag/".len()..];
            let tag = tail.split(['?', '#', '/']).next()?.trim();
            (!tag.is_empty()).then(|| tag.to_string())
        })
}

/// HEAD 取远端字节数（拿不到返回 0）。备用通道没有 assets 元数据，靠它让进度条可用。
fn head_size(url: &str) -> u64 {
    let out = curl_cmd()
        .args(["-sS", "-I", "-L", "--ssl-no-revoke", "--max-time", "15", url])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    let text = match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return 0,
    };
    // 多次跳转会有多个 Content-Length，取最后一个（最终资源）
    text.lines()
        .filter(|l| l.to_ascii_lowercase().starts_with("content-length:"))
        .filter_map(|l| l.split_once(':').and_then(|(_, v)| v.trim().parse::<u64>().ok()))
        .last()
        .unwrap_or(0)
}

/// 资产命名规则（与发版脚本一致），备用通道据此推导下载地址
fn asset_name_for(ver: &str) -> String {
    format!("{ASSET_PREFIX}_{ver}_x64-setup.exe")
}

fn asset_url_for(tag: &str, name: &str) -> String {
    format!("{DOWNLOAD_BASE}/{tag}/{name}")
}

fn build_info(
    latest: String,
    current: String,
    notes: String,
    asset_name: String,
    asset_url: String,
    asset_size: u64,
    digest: String,
) -> UpdateInfo {
    UpdateInfo {
        newer: is_newer(&latest, &current),
        current,
        latest,
        notes,
        asset_name,
        asset_url,
        asset_size,
        digest,
    }
}

#[tauri::command]
pub fn update_check() -> Result<UpdateInfo, String> {
    let current = current_version();

    match fetch_latest() {
        Ok(rel) => {
            let latest = rel.tag_name.trim_start_matches(['v', 'V']).to_string();
            let asset = rel
                .assets
                .iter()
                .find(|a| a.name.to_ascii_lowercase().ends_with("setup.exe"))
                .ok_or_else(|| format!("最新版本 {latest} 里没有 setup.exe 资产"))?;
            Ok(build_info(
                latest,
                current,
                rel.body.unwrap_or_else(|| rel.name.unwrap_or_default()),
                asset.name.clone(),
                asset.browser_download_url.clone(),
                asset.size,
                asset.digest.clone().unwrap_or_default(),
            ))
        }
        Err(api_err) => {
            // API 不可用（限流 / 网络抖动）→ 走网页 302 备用通道，保证仍能提示有新版本
            let tag = fetch_tag_via_redirect().ok_or_else(|| {
                format!("{api_err}；备用通道也未能取到版本号，请检查网络后重试")
            })?;
            let latest = tag.trim_start_matches(['v', 'V']).to_string();
            let name = asset_name_for(&latest);
            let url = asset_url_for(&tag, &name);
            let size = head_size(&url);
            Ok(build_info(
                latest,
                current,
                format!(
                    "（本次经备用通道查询：{api_err}）\n更新说明请到 Release 页面查看。"
                ),
                name,
                url,
                size,
                String::new(),
            ))
        }
    }
}

/// 更新包落到 %TEMP%\zhulinniao-hub-update\
fn download_dir() -> PathBuf {
    std::env::temp_dir().join("zhulinniao-hub-update")
}

/// 下载到指定文件（抽出来便于测试）。返回最终字节数。
fn download_to(
    url: &str,
    dest: &std::path::Path,
    total: u64,
    deadline: Duration,
    mut on_progress: impl FnMut(u64, f64),
) -> Result<u64, String> {
    let _ = std::fs::remove_file(dest);

    let mut child = curl_cmd()
        .args(["-sS", "-L", "--ssl-no-revoke", "--max-time", "1800", "-o"])
        .arg(dest)
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动下载：{e}"))?;

    let started = Instant::now();
    let mut last = Instant::now() - Duration::from_secs(1);
    // 「停滞」判定：连接挂起时 curl 不会自己报错，会一直吊到 30 分钟总超时。
    // 15 秒收不到任何新字节就直接放弃，交给上层换下一个源（直连 → 镜像）。
    let mut last_got = 0u64;
    let mut last_growth = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if last.elapsed() >= Duration::from_millis(200) {
                    last = Instant::now();
                    let got = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
                    let percent = if total > 0 {
                        (got as f64 / total as f64 * 100.0).min(100.0)
                    } else {
                        -1.0
                    };
                    on_progress(got, percent);
                    if got != last_got {
                        last_got = got;
                        last_growth = Instant::now();
                    } else if last_growth.elapsed() > Duration::from_secs(15) {
                        let _ = child.kill();
                        return Err("下载停滞超过 15 秒（收不到新数据），已中止".into());
                    }
                }
                if started.elapsed() > deadline {
                    let _ = child.kill();
                    return Err("下载超时".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("等待下载失败：{e}")),
        }
    }

    let status = child.wait().map_err(|e| format!("收尾失败：{e}"))?;
    if !status.success() {
        let mut msg = String::new();
        if let Some(mut err) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut err, &mut msg);
        }
        return Err(format!("下载失败（curl 退出码 {:?}）：{}", status.code(), msg.trim()));
    }

    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    if size < 100 * 1024 {
        return Err(format!("下载内容异常（仅 {size} 字节），已中止"));
    }
    Ok(size)
}

/// 下载源候选：**直连优先，失败再换公益镜像**。
///
/// 依据 2026-10-20 实测（对 v1.2.2 资产做 HEAD）：
///   直连 2.4s / ghproxy.net 1.2s / gh-proxy.com 1.5s，三者 Content-Length 完全一致（2944103）；
///   ghfast.top 超时不可用，jsDelivr 不支持 release 资产，故不列入。
/// 镜像只是把同一份字节转发一次，因此**下载完成必须校验字节数**，不符就换下一个源。
fn download_candidates(url: &str) -> Vec<(&'static str, String)> {
    let mut list = vec![("直连 GitHub", url.to_string())];
    // 只对原始 github.com 地址拼镜像前缀，避免把已经是镜像的地址二次包装
    if url.starts_with("https://github.com/") {
        list.push(("镜像 ghproxy.net", format!("https://ghproxy.net/{url}")));
        list.push(("镜像 gh-proxy.com", format!("https://gh-proxy.com/{url}")));
    }
    list
}

/// 下载安装包，边下边发进度事件；返回本地路径
///
/// 多源策略：任一源失败（网络错误 / 字节数不符）自动换下一个，全部失败才报错，
/// 换源时通过 `hub://update/source` 事件告知前端当前用的是哪个源。
#[tauri::command]
pub fn update_download(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
    total: u64,
) -> Result<String, String> {
    use tauri::Emitter;

    let dir = download_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    // 文件名消毒，避免路径穿越
    let safe: String = file_name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let dest = dir.join(if safe.is_empty() { "update-setup.exe".to_string() } else { safe });

    let candidates = download_candidates(&url);
    let total_sources = candidates.len();
    let mut errors: Vec<String> = Vec::new();

    for (label, cand) in candidates {
        if label != "直连 GitHub" {
            let _ = app.emit("hub://update/source", label.to_string());
        }
        let attempt = download_to(&cand, &dest, total, Duration::from_secs(1800), |got, percent| {
            let _ = app.emit("hub://update/progress", Progress { downloaded: got, total, percent });
        });
        match attempt {
            Ok(n) if total == 0 || n == total => {
                let _ = app.emit(
                    "hub://update/progress",
                    Progress { downloaded: n, total: n.max(total), percent: 100.0 },
                );
                return Ok(dest.to_string_lossy().to_string());
            }
            Ok(n) => errors.push(format!("{label}：字节数不符（收到 {n}，应为 {total}）")),
            Err(e) => errors.push(format!("{label}：{e}")),
        }
    }

    Err(format!(
        "下载失败，已尝试 {total_sources} 个源 —— {}",
        errors.join("；")
    ))
}

/// 安装完成标记：提权链在装完后创建它，非提权守望者见到它就重新拉起应用。
fn done_marker() -> PathBuf {
    download_dir().join(".installed")
}

fn ps_lit(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// 生成提权安装脚本内容（单独抽出来便于测试）。
///
/// 细节说明：
/// - `chcp 65001` + UTF-8 写入：用户名含中文时 `%TEMP%` 路径也是中文，不切代码页会乱码；
/// - 路径一律加引号，含空格也安全；
/// - 安装包用 `start /wait` 启动：这样即便目标是 .bat（测试替身）也不会因批处理
///   「调用即接管」而吃掉后续的删除与标记写入；对 .exe 语义仍是「等它装完再往下走」；
/// - 安装包 `/S` 静默安装后**立刻删除**，再写完成标记（守望者靠标记判断结束）。
fn install_script(setup: &std::path::Path, marker: &std::path::Path) -> String {
    format!(
        "@echo off\r\n\
         chcp 65001 >nul\r\n\
         ping -n 4 127.0.0.1 >nul\r\n\
         start \"\" /wait \"{setup}\" /S\r\n\
         del /f /q \"{setup}\"\r\n\
         echo ok>\"{marker}\"\r\n",
        setup = setup.to_string_lossy(),
        marker = marker.to_string_lossy(),
    )
}

/// 启动静默安装并退出应用。
///
/// ⚠️ 安装包是 `perMachine`（清单里 `requestedExecutionLevel=requireAdministrator`），
/// 未提权的进程直接 CreateProcess 会被系统拒绝（错误 740 / ERROR_ELEVATION_REQUIRED），
/// **表现为「下载完就退出，什么都没装」**。因此必须走 ShellExecute + `runas` 让系统弹 UAC。
///
/// 为什么改成「批处理文件」而不是把整串命令塞给 `cmd /c`：
/// `cmd.exe /c` 对引号的处理很刁钻（命令以引号开头时会吃掉首尾引号），
/// 而 Rust 的 `Command::args` 又会把内层引号转义成 `\"`（cmd 不认这种转义），
/// 两者叠加会把安装包路径截断 → 安装根本不执行。写成 .cmd 文件后只剩一次
/// `cmd /c "<脚本路径>"`，参数由 ShellExecute 原样传递，稳定可控。
///
/// 完整链路：
/// 1. `ShellExecuteW(runas, cmd.exe, /c "<install-update.cmd>")` —— 弹一次 UAC；
/// 2. 脚本内：等本体退出（约 3s）→ `/S` 静默安装 → 删除安装包 → 写完成标记；
/// 3. 同时起一个**非提权**的 PowerShell 守望者：等标记出现（最多 3 分钟）后启动新版本。
///    刻意不用提权进程重启应用，否则新进程会继承管理员令牌。
#[tauri::command]
pub fn update_install(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let setup = PathBuf::from(&path);
    if !setup.is_file() {
        return Err(format!("安装包不存在：{path}"));
    }
    let exe = std::env::current_exe().map_err(|e| format!("取当前程序路径失败：{e}"))?;
    let marker = done_marker();
    let _ = std::fs::remove_file(&marker);

    // ---- 1) 写提权安装脚本 ----
    let script = download_dir().join("install-update.cmd");
    std::fs::write(&script, install_script(&setup, &marker))
        .map_err(|e| format!("写入安装脚本失败：{e}"))?;

    let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let cmd_exe = format!("{sys}\\System32\\cmd.exe");
    let params = format!("/c \"{}\"", script.to_string_lossy());

    let verb = windows::core::HSTRING::from("runas");
    let file = windows::core::HSTRING::from(cmd_exe.as_str());
    let prm = windows::core::HSTRING::from(params);
    let ret = unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        ShellExecuteW(
            windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR(prm.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute 返回值 <= 32 表示失败（5 = 用户取消了 UAC 授权）
    let code = ret.0 as isize;
    if code <= 32 {
        return Err(match code {
            5 => "已取消管理员授权（UAC），更新没有继续。".to_string(),
            _ => format!("无法以管理员权限启动安装程序（ShellExecute 返回 {code}）。"),
        });
    }

    // ---- 2) 非提权守望者：安装结束后把新版本拉起来 ----
    let watch = format!(
        "$m={marker}; for($i=0;$i -lt 360;$i++){{ if(Test-Path -LiteralPath $m){{break}}; Start-Sleep -Milliseconds 500 }}; \
         Start-Sleep -Milliseconds 600; \
         try {{ Start-Process -FilePath {exe} }} catch {{ }}",
        marker = ps_lit(&marker.to_string_lossy()),
        exe = ps_lit(&exe.to_string_lossy()),
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &watch])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        app.exit(0);
    });
    Ok(())
}

/// 供设置页显示：当前版本
#[tauri::command]
pub fn app_version() -> String {
    current_version()
}

/// 启动时清理下载残留：安装包（10 分钟以上）与完成标记。
///
/// 正常流程里安装包由提权链在装完后立刻 `del` 掉，这里只是兜底
/// （例如用户在 UAC 处取消、或删除时文件仍被占用）。
pub fn cleanup_stale() {
    let dir = download_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if name == ".installed" || name == "install-update.cmd" {
            let _ = std::fs::remove_file(&p);
            continue;
        }
        if p.extension().map(|x| x == "exe").unwrap_or(false) {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .map(|d| d.as_secs() > 600)
                .unwrap_or(false);
            if old {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证安装脚本「静默安装 → 删除安装包 → 写完成标记」的逻辑与引号处理。
    /// 用 .bat 冒充安装包，**不提权、不装任何东西**，只跑本地文件操作。
    #[test]
    fn install_script_runs_and_cleans_up() {
        let dir = std::env::temp_dir().join("zhulinniao-hub-update-chain");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let setup = dir.join("fake setup.bat"); // 故意带空格，检验引号
        std::fs::write(&setup, "@echo off\r\nexit /b 0\r\n").unwrap();
        let marker = dir.join(".installed");

        // 与正式流程同一份生成逻辑（只把 ping 延时压到 1 次，加快测试）
        let script = dir.join("install-update.cmd");
        let body = install_script(&setup, &marker).replace("ping -n 4", "ping -n 1");
        std::fs::write(&script, body).unwrap();

        // ⚠️ 必须用 raw_arg 模拟 ShellExecute 的「原样参数」传递：
        // `args(["/c", "\"...\""])` 会被 CRT 转义成 `\"...\"`，cmd 不认这种转义。
        use std::os::windows::process::CommandExt;
        let out = Command::new("cmd")
            .raw_arg(format!("/c \"{}\"", script.to_string_lossy()))
            .output()
            .unwrap();
        assert!(out.status.success(), "脚本执行失败：{:?}", out.status);
        assert!(marker.is_file(), "应写出完成标记（守望者靠它判断安装结束）");
        assert!(!setup.exists(), "安装包应在装完后被删除");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ps_literal_escapes_quotes() {
        assert_eq!(ps_lit("C:\\a b\\x'"), "'C:\\a b\\x'''"); // 单引号翻倍
    }

    /// 下载源候选：直连在前，镜像只对原始 github.com 地址追加，且不重复包装
    #[test]
    fn download_candidates_order() {
        let url = "https://github.com/qvq9999/zhulinniao-hub/releases/download/v1.2.2/a.exe";
        let c = download_candidates(url);
        assert_eq!(c.len(), 3);
        assert_eq!(c[0].1, url, "第一个必须是直连");
        assert!(c[1].1.starts_with("https://ghproxy.net/https://github.com/"), "镜像 1 拼接错误：{}", c[1].1);
        assert!(c[2].1.starts_with("https://gh-proxy.com/https://github.com/"), "镜像 2 拼接错误：{}", c[2].1);

        // 已经是镜像地址时不再二次包装（避免 ghproxy.net/https://ghproxy.net/...）
        let mirrored = "https://ghproxy.net/https://github.com/x/y/z.exe";
        let c2 = download_candidates(mirrored);
        assert_eq!(c2.len(), 1);
    }

    /// GitHub 错误响应必须被识别成「限流」，而不是「解析 Release 失败」
    #[test]
    fn api_error_is_described() {
        let body = r#"{"message":"API rate limit exceeded for 1.2.3.4.","documentation_url":"https://docs.github.com"}"#;
        let d = describe_api_error(body).expect("应识别为错误响应");
        assert!(d.contains("超限"), "限流文案不符：{d}");
        assert!(!d.contains("解析"), "不应出现「解析」字样");

        let nf = r#"{"message":"Not Found"}"#;
        assert!(describe_api_error(nf).unwrap().contains("不存在"));

        // 正常 Release 体不应被误判
        assert!(describe_api_error(r#"{"tag_name":"v1.2.2","assets":[]}"#).is_none());
    }

    /// 从 302 响应头里抠 tag（真实返回形如 Location: https://github.com/o/r/releases/tag/v1.2.2）
    #[test]
    fn parse_tag_from_redirect_headers() {
        let hdr = "HTTP/1.1 302 Found\r\nLocation: https://github.com/qvq9999/zhulinniao-hub/releases/tag/v1.2.2\r\n\r\n";
        let tag = hdr
            .lines()
            .filter(|l| l.to_ascii_lowercase().starts_with("location:"))
            .filter_map(|l| l.split_once(':').map(|(_, v)| v.trim().to_string()))
            .find_map(|u| {
                let i = u.find("/releases/tag/")?;
                let t = u[i + "/releases/tag/".len()..].split(['?', '#', '/']).next()?.trim();
                (!t.is_empty()).then(|| t.to_string())
            });
        assert_eq!(tag.as_deref(), Some("v1.2.2"));
    }

    #[test]
    fn version_compare() {        assert!(is_newer("1.1.0", "1.0.0"));
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9.0", "1.0.0"));
        assert!(is_newer("v1.2", "1.1.9"));
        assert_eq!(parse_ver("v1.2.3"), vec![1, 2, 3]);
    }

    /// 真实联网自检（手动运行）：cargo test --release --lib live_check -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_check() {
        let rel = fetch_latest().expect("应能查询到最新 Release");
        println!("tag={} assets={}", rel.tag_name, rel.assets.len());
        for a in &rel.assets {
            println!("  {} {} B {}", a.name, a.size, a.browser_download_url);
        }
        println!("notes 前 80 字：{}", rel.body.unwrap_or_default().chars().take(80).collect::<String>());
    }

    /// 真实下载自检（约 3MB，会走系统代理）：cargo test --release --lib live_download -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_download() {
        let rel = fetch_latest().expect("应能查询到最新 Release");
        let asset = rel.assets.iter().find(|a| a.name.ends_with("setup.exe")).expect("应有 setup.exe");
        let dest = std::env::temp_dir().join("zhulinniao-hub-update").join("live-test-setup.exe");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let mut ticks = 0;
        let got = download_to(&asset.browser_download_url, &dest, asset.size,
            Duration::from_secs(600), |_, _| { ticks += 1; }).expect("下载应成功");
        println!("下载完成：{got} B（期望 {} B），进度回调 {ticks} 次", asset.size);
        assert_eq!(got, asset.size, "下载大小应与 Release 记录一致");
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn curl_exists() {
        assert!(std::path::Path::new(&curl_path()).is_file(), "系统应有 curl.exe");
    }
}
