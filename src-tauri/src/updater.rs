use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::AppHandle;

pub const UPDATE_FEED_URL: &str = "http://111.230.247.111/closedport/latest.json";

#[derive(Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    notes: String,
    url: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    silent_args: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub notes: String,
    pub url: String,
    pub available: bool,
}

pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn check_update() -> Result<UpdateInfo, String> {
    let manifest = fetch_manifest()?;
    Ok(UpdateInfo {
        current: current_version(),
        latest: manifest.version.clone(),
        notes: manifest.notes,
        url: manifest.url,
        available: is_newer(&manifest.version, &current_version()),
    })
}

pub fn install_update(app: AppHandle) -> Result<String, String> {
    let manifest = fetch_manifest()?;
    if !is_newer(&manifest.version, &current_version()) {
        return Err("当前已是最新版本".to_string());
    }
    if manifest.url.trim().is_empty() {
        return Err("更新清单没有安装包地址".to_string());
    }
    let package = download_installer(&manifest)?;
    spawn_updater(&package, manifest.silent_args.as_deref())?;
    app.exit(0);
    Ok("已启动更新，应用即将退出并自动重新打开".to_string())
}

fn fetch_manifest() -> Result<UpdateManifest, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut response = agent
        .get(UPDATE_FEED_URL)
        .call()
        .map_err(|e| format!("无法连接更新服务器：{e}"))?;
    let status = u16::from(response.status());
    if !(200..300).contains(&status) {
        return Err(format!("更新服务器返回 {status}"));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("无法读取更新清单：{e}"))?;
    if content_type.contains("text/html") || body.trim_start().starts_with("<!DOCTYPE html") {
        return Err(format!(
            "更新服务器返回了网页而不是 JSON，请配置 /closedport/ 静态目录：{UPDATE_FEED_URL}"
        ));
    }
    serde_json::from_str::<UpdateManifest>(&body).map_err(|e| {
        let preview: String = body.chars().take(120).collect();
        format!("更新清单 JSON 格式错误：{e}；响应开头：{preview}")
    })
}

fn download_installer(manifest: &UpdateManifest) -> Result<PathBuf, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(180)))
        .build()
        .into();
    let mut response = agent
        .get(&manifest.url)
        .call()
        .map_err(|e| format!("下载安装包失败：{e}"))?;
    let status = u16::from(response.status());
    if !(200..300).contains(&status) {
        return Err(format!("下载安装包失败，状态码 {status}"));
    }
    let bytes = response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("读取安装包失败：{e}"))?;
    if bytes.len() < 64 {
        return Err("安装包内容为空".to_string());
    }
    if !manifest.sha256.trim().is_empty() {
        let actual = hex_lower(&Sha256::digest(&bytes));
        if actual != manifest.sha256.trim().to_ascii_lowercase() {
            return Err("安装包校验失败，请重新发布更新".to_string());
        }
    }
    let ext = if manifest.url.to_ascii_lowercase().ends_with(".msi") {
        "msi"
    } else {
        "exe"
    };
    let path = std::env::temp_dir().join(format!("closedport-setup-{}.{ext}", manifest.version));
    let mut file = File::create(&path).map_err(|e| format!("无法保存安装包：{e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("写入安装包失败：{e}"))?;
    Ok(path)
}

fn looks_like_installer(path: &PathBuf) -> bool {
    if path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("msi")
    {
        return true;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    bytes.windows(12).any(|chunk| chunk == b"NullsoftInst")
}

fn ps_single(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn install_arg_list(silent_args: Option<&str>) -> String {
    let mut args: Vec<String> = silent_args
        .unwrap_or("/S /R")
        .split_whitespace()
        .map(|item| item.to_string())
        .collect();
    if args.is_empty() {
        args.push("/S".to_string());
    }
    if !args.iter().any(|item| item.eq_ignore_ascii_case("/R")) {
        args.push("/R".to_string());
    }
    args.iter()
        .map(|item| ps_single(item))
        .collect::<Vec<_>>()
        .join(",")
}

fn spawn_updater(package: &PathBuf, silent_args: Option<&str>) -> Result<(), String> {
    let current = std::env::current_exe().map_err(|e| format!("无法定位当前程序：{e}"))?;
    let pid = std::process::id();
    let installer = looks_like_installer(package);
    let script = format!(
        "$ErrorActionPreference = 'Continue'\n\
         $oldPid = {pid}\n\
         $package = {}\n\
         $current = {}\n\
         $isInstaller = {}\n\
         $installArgs = @({})\n\
         $log = Join-Path $env:TEMP 'closedport-update.log'\n\
         function Log($m) {{ Add-Content -LiteralPath $log -Value (\"$(Get-Date -Format o) $m\") }}\n\
         Log \"start pid=$oldPid installer=$isInstaller\"\n\
         $deadline = (Get-Date).AddSeconds(90)\n\
         while (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {{\n\
           if ((Get-Date) -gt $deadline) {{ Log 'timeout waiting old process'; break }}\n\
           Start-Sleep -Milliseconds 300\n\
         }}\n\
         Start-Sleep -Milliseconds 800\n\
         if ($isInstaller -and (Test-Path -LiteralPath $package)) {{\n\
           Log \"run installer $package\"\n\
           if ([IO.Path]::GetExtension($package) -ieq '.msi') {{\n\
             $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $package, '/qn', '/norestart') -PassThru -WindowStyle Hidden\n\
           }} else {{\n\
             $p = Start-Process -FilePath $package -ArgumentList $installArgs -PassThru -WindowStyle Hidden\n\
           }}\n\
           if ($p) {{ Wait-Process -Id $p.Id -Timeout 180 -ErrorAction SilentlyContinue }}\n\
         }} elseif (Test-Path -LiteralPath $package) {{\n\
           $targets = @((Join-Path $env:LOCALAPPDATA 'ClosedPort\\closedport.exe'), $current)\n\
           foreach ($t in $targets) {{\n\
             try {{\n\
               New-Item -ItemType Directory -Force -Path (Split-Path $t) | Out-Null\n\
               Copy-Item -LiteralPath $package -Destination $t -Force\n\
               Log \"copied to $t\"\n\
               break\n\
             }} catch {{ Log \"copy failed $t $($_.Exception.Message)\" }}\n\
           }}\n\
         }}\n\
         Start-Sleep -Milliseconds 800\n\
         if (Get-Process -Name 'closedport','ClosedPort' -ErrorAction SilentlyContinue) {{\n\
           Log 'already running'\n\
           exit 0\n\
         }}\n\
         $candidates = @(\n\
           (Join-Path $env:LOCALAPPDATA 'ClosedPort\\closedport.exe'),\n\
           (Join-Path $env:LOCALAPPDATA 'ClosedPort\\ClosedPort.exe'),\n\
           $current\n\
         )\n\
         foreach ($app in $candidates) {{\n\
           if (Test-Path -LiteralPath $app) {{\n\
             Log \"start $app\"\n\
             Start-Process -FilePath $app\n\
             exit 0\n\
           }}\n\
         }}\n\
         Log 'no exe to start'\n",
        ps_single(&package.to_string_lossy()),
        ps_single(&current.to_string_lossy()),
        if installer { "$true" } else { "$false" },
        install_arg_list(silent_args)
    );
    let ps1 = std::env::temp_dir().join("closedport-update.ps1");
    std::fs::write(&ps1, script).map_err(|e| format!("无法写入更新脚本：{e}"))?;
    launch_orphaned_powershell(&ps1)?;
    std::thread::sleep(Duration::from_millis(300));
    Ok(())
}

fn hide_window(cmd: &mut Command) {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
}

fn orphan_via_cim(command_line: &str) -> Result<(), String> {
    let escaped = command_line.replace('\'', "''");
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &format!(
            "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{{CommandLine='{escaped}'}}; if ($r.ReturnValue -ne 0) {{ exit 1 }}"
        ),
    ]);
    hide_window(&mut cmd);
    let status = cmd
        .status()
        .map_err(|e| format!("无法通过 WMI 启动更新：{e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("WMI 创建更新进程失败".to_string())
    }
}

fn orphan_via_wmic(command_line: &str) -> Result<(), String> {
    let mut cmd = Command::new("wmic");
    cmd.args(["process", "call", "create", command_line]);
    hide_window(&mut cmd);
    let status = cmd
        .status()
        .map_err(|e| format!("无法通过 WMIC 启动更新：{e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("WMIC 创建更新进程失败".to_string())
    }
}

fn launch_orphaned_powershell(script: &Path) -> Result<(), String> {
    let command_line = format!(
        "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"{}\"",
        script.display()
    );
    if orphan_via_cim(&command_line).is_ok() || orphan_via_wmic(&command_line).is_ok() {
        return Ok(());
    }
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
    ]);
    hide_window(&mut cmd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0100_0008 | 0x0000_0200 | 0x0800_0000);
    }
    cmd.spawn().map_err(|e| format!("无法启动更新进程：{e}"))?;
    std::thread::sleep(Duration::from_millis(400));
    Ok(())
}

fn is_newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

fn parse_version(value: &str) -> [u32; 3] {
    let mut parts = value
        .trim()
        .trim_start_matches('v')
        .split(|c: char| !c.is_ascii_digit())
        .filter(|item| !item.is_empty())
        .filter_map(|item| item.parse::<u32>().ok());
    [
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    ]
}

fn hex_lower(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}
