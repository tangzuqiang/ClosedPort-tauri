use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

mod updater;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}
fn output(command: &str, args: &[&str]) -> Result<String, String> {
    let result = Command::new(command)
        .args(args)
        .creation_flags_no_window()
        .output()
        .map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(String::from_utf8_lossy(&result.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).trim().to_string())
    }
}
trait NoWindow {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}
impl NoWindow for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        self
    }
}
fn ps(script: &str) -> Result<String, String> {
    output(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    )
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortEntry {
    protocol: String,
    local_address: String,
    local_port: u16,
    remote_address: Option<String>,
    remote_port: Option<u16>,
    state: Option<String>,
    pid: u32,
    process_name: Option<String>,
    process_path: Option<String>,
    user: Option<String>,
    command_line: Option<String>,
    parent_pid: Option<u32>,
    parent_name: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessEntry {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    path: Option<String>,
    user: Option<String>,
    command_line: Option<String>,
    rss_bytes: u64,
    private_bytes: u64,
    virtual_bytes: u64,
    cpu_percent: f32,
    uptime_seconds: i64,
    thread_count: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessListResult {
    entries: Vec<ProcessEntry>,
    captured_at: u64,
    backend: String,
    warning: Option<String>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KillResult {
    pid: u32,
    success: bool,
    message: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    platform: String,
    is_admin: bool,
    handle_available: bool,
    dev_tools_enabled: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemMemoryInfo {
    total_bytes: u64,
    used_bytes: u64,
    free_bytes: u64,
    available_bytes: u64,
    cached_bytes: u64,
    compressed_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
    captured_at: u64,
    backend: String,
    warning: Option<String>,
}

#[tauri::command]
fn list_ports() -> Vec<PortEntry> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let raw = if cfg!(windows) {
        output("netstat", &["-ano"]).unwrap_or_default()
    } else {
        output(
            "sh",
            &["-c", "ss -H -tulnp 2>/dev/null || netstat -anv 2>/dev/null"],
        )
        .unwrap_or_default()
    };
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for line in raw.lines() {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() < 4 {
            continue;
        }
        let proto = p[0].to_uppercase();
        if !proto.starts_with("TCP") && !proto.starts_with("UDP") {
            continue;
        }
        let local = p[1];
        let (addr, port) = split_endpoint(local);
        if port == 0 {
            continue;
        }
        let (remote, state, pid) = if proto.starts_with("TCP") && p.len() >= 5 {
            (
                Some(p[2]),
                Some(p[3].to_string()),
                p[4].parse().unwrap_or(0),
            )
        } else {
            (
                p.get(2).copied(),
                None,
                p.last().and_then(|x| x.parse().ok()).unwrap_or(0),
            )
        };
        if !seen.insert((proto.clone(), addr.clone(), port, pid)) {
            continue;
        }
        let proc = sys.process(Pid::from_u32(pid));
        let parent = proc.and_then(|x| x.parent()).map(|x| x.as_u32());
        let (raddr, rport) = remote
            .map(split_endpoint)
            .map(|(a, p)| (Some(a), Some(p)))
            .unwrap_or((None, None));
        entries.push(PortEntry {
            protocol: if addr.contains(':') {
                format!("{}6", &proto[..3])
            } else {
                proto
            },
            local_address: addr,
            local_port: port,
            remote_address: raddr,
            remote_port: rport,
            state,
            pid,
            process_name: proc.map(|x| x.name().to_string_lossy().into_owned()),
            process_path: proc
                .and_then(|x| x.exe())
                .map(|x| x.to_string_lossy().into_owned()),
            user: None,
            command_line: proc.map(|x| {
                x.cmd()
                    .iter()
                    .map(|s| s.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ")
            }),
            parent_pid: parent,
            parent_name: parent
                .and_then(|x| sys.process(Pid::from_u32(x)))
                .map(|x| x.name().to_string_lossy().into_owned()),
        });
    }
    entries.sort_by_key(|x| x.local_port);
    entries
}
fn split_endpoint(s: &str) -> (String, u16) {
    let clean = s.trim_matches(|c| c == '[' || c == ']');
    if let Some(i) = clean.rfind(':') {
        (
            clean[..i]
                .trim_matches(|c| c == '[' || c == ']')
                .to_string(),
            clean[i + 1..].parse().unwrap_or(0),
        )
    } else {
        (clean.to_string(), 0)
    }
}

#[tauri::command]
fn list_processes() -> ProcessListResult {
    let mut sys = System::new_all();
    thread::sleep(Duration::from_millis(120));
    sys.refresh_all();
    let entries = sys
        .processes()
        .values()
        .map(|p| ProcessEntry {
            pid: p.pid().as_u32(),
            parent_pid: p.parent().map(|x| x.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            path: p.exe().map(|x| x.to_string_lossy().into_owned()),
            user: None,
            command_line: Some(
                p.cmd()
                    .iter()
                    .map(|x| x.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
            rss_bytes: p.memory(),
            private_bytes: p.memory(),
            virtual_bytes: p.virtual_memory(),
            cpu_percent: p.cpu_usage(),
            uptime_seconds: p.run_time() as i64,
            thread_count: -1,
        })
        .collect();
    ProcessListResult {
        entries,
        captured_at: now(),
        backend: if cfg!(windows) {
            "powershell"
        } else {
            "ps+proc"
        }
        .into(),
        warning: None,
    }
}
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> KillResult {
    let result = if cfg!(windows) {
        output(
            "taskkill",
            &["/PID", &pid.to_string(), if force { "/F" } else { "/T" }],
        )
    } else {
        output(
            "kill",
            &[if force { "-9" } else { "-15" }, &pid.to_string()],
        )
    };
    KillResult {
        pid,
        success: result.is_ok(),
        message: result.err(),
    }
}
#[tauri::command]
fn kill_processes(pids: Vec<u32>, force: bool) -> Vec<KillResult> {
    pids.into_iter().map(|p| kill_process(p, force)).collect()
}
#[tauri::command]
fn get_system_info() -> SystemInfo {
    let admin = if cfg!(windows) {
        output("net", &["session"]).is_ok()
    } else {
        false
    };
    SystemInfo {
        platform: platform().into(),
        is_admin: admin,
        handle_available: find_handle().is_some(),
        dev_tools_enabled: cfg!(windows),
    }
}
#[tauri::command]
fn get_system_memory() -> SystemMemoryInfo {
    let mut s = System::new_all();
    s.refresh_memory();
    SystemMemoryInfo {
        total_bytes: s.total_memory(),
        used_bytes: s.used_memory(),
        free_bytes: s.free_memory(),
        available_bytes: s.available_memory(),
        cached_bytes: 0,
        compressed_bytes: 0,
        swap_total_bytes: s.total_swap(),
        swap_used_bytes: s.used_swap(),
        captured_at: now(),
        backend: platform().into(),
        warning: None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanOptions {
    folder_path: String,
    recursive: Option<bool>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderHandleEntry {
    pid: u32,
    process_name: String,
    process_path: Option<String>,
    handle_type: String,
    resource_path: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderMeta {
    backend: String,
    scanned_file_count: Option<u32>,
    folder_exists: bool,
}
#[derive(Serialize)]
struct FolderResult {
    entries: Vec<FolderHandleEntry>,
    meta: FolderMeta,
}
fn find_handle() -> Option<PathBuf> {
    [
        "handle.exe",
        "resources\\handle.exe",
        "resources\\handle64.exe",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|p| p.exists())
    .or_else(|| {
        std::env::var_os("PATH").and_then(|v| {
            std::env::split_paths(&v)
                .map(|p| p.join("handle.exe"))
                .find(|p| p.exists())
        })
    })
}
fn scan_impl(path: &str) -> FolderResult {
    if !PathBuf::from(path).is_dir() {
        return FolderResult {
            entries: vec![],
            meta: FolderMeta {
                backend: "unsupported".into(),
                scanned_file_count: None,
                folder_exists: false,
            },
        };
    }
    let Some(exe) = find_handle() else {
        return FolderResult {
            entries: vec![],
            meta: FolderMeta {
                backend: "unsupported".into(),
                scanned_file_count: None,
                folder_exists: true,
            },
        };
    };
    let text = Command::new(exe)
        .args(["-accepteula", "-nobanner", path])
        .output()
        .map(|x| String::from_utf8_lossy(&x.stdout).into_owned())
        .unwrap_or_default();
    let mut rows = vec![];
    for l in text.lines() {
        if let Some(pi) = l.find(" pid: ") {
            let name = l[..pi].trim().to_string();
            let rest = &l[pi + 6..];
            let pid = rest
                .split_whitespace()
                .next()
                .and_then(|x| x.parse().ok())
                .unwrap_or(0);
            let resource = l.splitn(2, ':').nth(1).unwrap_or(path).trim().to_string();
            rows.push(FolderHandleEntry {
                pid,
                process_name: name,
                process_path: None,
                handle_type: "File".into(),
                resource_path: resource,
            });
        }
    }
    FolderResult {
        entries: rows,
        meta: FolderMeta {
            backend: "handle.exe".into(),
            scanned_file_count: None,
            folder_exists: true,
        },
    }
}
#[tauri::command]
fn scan_folder(options: ScanOptions) -> Vec<FolderHandleEntry> {
    let _ = options.recursive;
    scan_impl(&options.folder_path).entries
}
#[tauri::command]
fn scan_folder_ex(options: ScanOptions) -> FolderResult {
    let _ = options.recursive;
    scan_impl(&options.folder_path)
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    if cfg!(windows) {
        ps("Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;if($d.ShowDialog()-eq 'OK'){$d.SelectedPath}").ok().map(|s|s.trim().to_string()).filter(|s|!s.is_empty())
    } else {
        None
    }
}
#[tauri::command]
fn reveal_in_folder(file_path: String) {
    if cfg!(windows) {
        let _ = Command::new("explorer.exe")
            .arg(format!("/select,{}", file_path))
            .spawn();
    } else if cfg!(target_os = "macos") {
        let _ = Command::new("open").args(["-R", &file_path]).spawn();
    } else {
        let _ = Command::new("xdg-open")
            .arg(
                PathBuf::from(file_path)
                    .parent()
                    .unwrap_or(std::path::Path::new("/")),
            )
            .spawn();
    }
}
#[derive(Serialize)]
struct SpawnedTestPort {
    pid: u32,
    port: u16,
    token: String,
}
#[tauri::command]
fn spawn_test_ports(count: u32) -> Vec<SpawnedTestPort> {
    (0..count.min(20)).filter_map(|_|{let child=Command::new("powershell.exe").args(["-NoProfile","-WindowStyle","Hidden","-Command","$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();while($true){Start-Sleep 60}"]).spawn().ok()?;Some(SpawnedTestPort{pid:child.id(),port:0,token:Uuid::new_v4().to_string()})}).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupList {
    entries: Vec<StartupEntry>,
    captured_at: u64,
    warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartupEntry {
    id: String,
    name: String,
    source: String,
    location: String,
    command: String,
    enabled: bool,
    reveal_path: Option<String>,
    publisher: Option<String>,
    can_edit: bool,
    can_delete: bool,
    needs_admin: bool,
    protected: bool,
}
#[derive(Serialize)]
struct Mutation {
    success: bool,
    message: Option<String>,
}
#[tauri::command]
fn list_startups() -> StartupList {
    let script = r#"$x=@();$paths=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run');foreach($p in $paths){if(Test-Path $p){$o=Get-ItemProperty $p;foreach($n in $o.PSObject.Properties.Name|?{$_ -notmatch '^PS'}){$x+=[pscustomobject]@{id=($p+'|'+$n);name=$n;source='registry';location=$p;command=[string]$o.$n;enabled=$true;canEdit=$true;canDelete=$true;needsAdmin=$p.StartsWith('HKLM');protected=$false}}};$x|ConvertTo-Json -Compress"#;
    let entries = ps(script)
        .ok()
        .and_then(|x| serde_json::from_str(&x).ok())
        .unwrap_or_default();
    StartupList {
        entries,
        captured_at: now(),
        warnings: vec![],
    }
}
fn startup_parts(id: &str) -> Option<(&str, &str)> {
    id.rsplit_once('|')
}
#[tauri::command]
fn set_startup_enabled(_id: String, _enabled: bool) -> Mutation {
    Mutation {
        success: false,
        message: Some("Tauri 版本目前仅支持查看和删除注册表启动项".into()),
    }
}
#[tauri::command]
fn update_startup(id: String, command: String) -> Mutation {
    if let Some((path, name)) = startup_parts(&id) {
        let s = format!(
            "Set-ItemProperty -LiteralPath {} -Name {} -Value {}",
            ps_quote(path),
            ps_quote(name),
            ps_quote(&command)
        );
        return mutation(ps(&s));
    }
    Mutation {
        success: false,
        message: Some("Invalid id".into()),
    }
}
#[tauri::command]
fn delete_startup(id: String) -> Mutation {
    if let Some((path, name)) = startup_parts(&id) {
        let s = format!(
            "Remove-ItemProperty -LiteralPath {} -Name {}",
            ps_quote(path),
            ps_quote(name)
        );
        return mutation(ps(&s));
    }
    Mutation {
        success: false,
        message: Some("Invalid id".into()),
    }
}
fn mutation(r: Result<String, String>) -> Mutation {
    match r {
        Ok(_) => Mutation {
            success: true,
            message: None,
        },
        Err(e) => Mutation {
            success: false,
            message: Some(e),
        },
    }
}
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostMutation {
    address: String,
    hostnames: Vec<String>,
    comment: String,
    enabled: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostEntry {
    id: String,
    address: String,
    hostnames: Vec<String>,
    comment: String,
    enabled: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostList {
    entries: Vec<HostEntry>,
    path: String,
    captured_at: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostProfile {
    id: String,
    name: String,
    is_active: bool,
    created_at: u64,
}
fn hosts_path() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
    } else {
        PathBuf::from("/etc/hosts")
    }
}
fn read_hosts() -> Result<String, String> {
    fs::read_to_string(hosts_path()).map_err(|e| format!("无法读取 hosts 文件：{e}"))
}
fn format_host(input: &HostMutation) -> Result<String, String> {
    if input.address.trim().is_empty() || input.hostnames.is_empty() {
        return Err("地址和主机名不能为空".into());
    }
    if input.address.contains(['\r', '\n', '#'])
        || input
            .hostnames
            .iter()
            .any(|name| name.trim().is_empty() || name.contains(['\r', '\n', '#']))
        || input.comment.contains(['\r', '\n'])
    {
        return Err("hosts 条目包含非法换行或注释符".into());
    }
    Ok(format!(
        "{}{} {}{}",
        if input.enabled {
            ""
        } else {
            "# closedport-disabled "
        },
        input.address.trim(),
        input
            .hostnames
            .iter()
            .map(|name| name.trim())
            .collect::<Vec<_>>()
            .join(" "),
        if input.comment.trim().is_empty() {
            String::new()
        } else {
            format!(" # {}", input.comment.trim())
        }
    ))
}
fn write_hosts_text(content: &str) -> Result<String, String> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);
    if system.processes().values().any(|process| {
        process
            .name()
            .to_string_lossy()
            .eq_ignore_ascii_case("Steam++.Accelerator.exe")
    }) {
        return Err(
            "Steam++ 加速器正在以 Hosts 模式接管系统 hosts。请先在 Steam++ 停止加速或切换为非 Hosts 代理模式，再保存。"
                .into(),
        );
    }
    let path = hosts_path();
    let backup = path.with_file_name("hosts.closedport.bak");
    if !backup.exists() {
        fs::copy(&path, &backup)
            .map_err(|e| format!("无法创建 hosts 备份 {}：{e}", backup.display()))?;
    }
    fs::write(&path, content).map_err(|e| format!("无法写入 hosts（请以管理员身份运行）：{e}"))?;
    let written = fs::read_to_string(&path).map_err(|e| format!("写入后无法校验 hosts：{e}"))?;
    if written != content {
        return Err("hosts 写入校验失败，磁盘内容与预期不一致".into());
    }
    // Hosts managers and security tools often rewrite the file immediately
    // after receiving a filesystem notification. Verify again after the
    // notification window so the UI never reports a transient write as saved.
    thread::sleep(Duration::from_millis(1500));
    let stable = fs::read_to_string(&path).map_err(|e| format!("延迟校验 hosts 失败：{e}"))?;
    if stable != content {
        return Err("hosts 保存后被其他程序立即覆盖，请关闭其他 hosts 管理/加速工具后重试".into());
    }
    Ok(String::new())
}
fn hosts_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    let conn =
        Connection::open(dir.join("closedport.db")).map_err(|e| format!("无法打开 SQLite：{e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS host_profiles(
           id TEXT PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS host_entries(
           id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, address TEXT NOT NULL,
           hostnames TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
           sort_order INTEGER NOT NULL DEFAULT 0,
           FOREIGN KEY(profile_id) REFERENCES host_profiles(id) ON DELETE CASCADE
         );",
    ).map_err(|e| format!("初始化 SQLite 失败：{e}"))?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM host_profiles", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if count == 0 {
        conn.execute(
            "INSERT INTO host_profiles(id,name,is_active,created_at) VALUES(?1,'默认配置',0,?2)",
            params![Uuid::new_v4().to_string(), now() as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(conn)
}
fn resolve_profile(conn: &Connection, profile_id: Option<String>) -> Result<String, String> {
    if let Some(id) = profile_id {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM host_profiles WHERE id=?1",
                [&id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists > 0 {
            return Ok(id);
        }
    }
    conn.query_row(
        "SELECT id FROM host_profiles ORDER BY is_active DESC,created_at ASC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("没有可用的 hosts 配置：{e}"))
}
#[tauri::command]
fn list_host_profiles(app: tauri::AppHandle) -> Result<Vec<HostProfile>, String> {
    let conn = hosts_db(&app)?;
    let mut stmt = conn.prepare("SELECT id,name,is_active,created_at FROM host_profiles ORDER BY is_active DESC,created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(HostProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                is_active: row.get::<_, i64>(2)? != 0,
                created_at: row.get::<_, i64>(3)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn create_host_profile(app: tauri::AppHandle, name: String) -> Result<HostProfile, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("配置名称不能为空".into());
    }
    let conn = hosts_db(&app)?;
    let profile = HostProfile {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        is_active: false,
        created_at: now(),
    };
    conn.execute(
        "INSERT INTO host_profiles(id,name,is_active,created_at) VALUES(?1,?2,0,?3)",
        params![profile.id, profile.name, profile.created_at as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(profile)
}
#[tauri::command]
fn rename_host_profile(app: tauri::AppHandle, id: String, name: String) -> Mutation {
    let result = (|| -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("配置名称不能为空".into());
        }
        let conn = hosts_db(&app)?;
        if conn
            .execute(
                "UPDATE host_profiles SET name=?1 WHERE id=?2",
                params![name, id],
            )
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("配置不存在".into());
        }
        Ok(String::new())
    })();
    mutation(result)
}
#[tauri::command]
fn delete_host_profile(app: tauri::AppHandle, id: String) -> Mutation {
    let result = (|| -> Result<String, String> {
        let conn = hosts_db(&app)?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM host_profiles", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if count <= 1 {
            return Err("至少保留一套配置".into());
        }
        let active: i64 = conn
            .query_row(
                "SELECT is_active FROM host_profiles WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(|_| "配置不存在".to_string())?;
        if active != 0 {
            return Err("当前已应用的配置不能删除".into());
        }
        conn.execute("DELETE FROM host_profiles WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(String::new())
    })();
    mutation(result)
}
#[tauri::command]
fn list_hosts(app: tauri::AppHandle, profile_id: Option<String>) -> Result<HostList, String> {
    let conn = hosts_db(&app)?;
    let profile = resolve_profile(&conn, profile_id)?;
    let mut stmt=conn.prepare("SELECT id,address,hostnames,comment,enabled FROM host_entries WHERE profile_id=?1 ORDER BY sort_order,rowid").map_err(|e|e.to_string())?;
    let entries = stmt
        .query_map([profile], |row| {
            let names: String = row.get(2)?;
            Ok(HostEntry {
                id: row.get(0)?,
                address: row.get(1)?,
                hostnames: serde_json::from_str(&names).unwrap_or_default(),
                comment: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(HostList {
        entries,
        path: hosts_path().to_string_lossy().into_owned(),
        captured_at: now(),
    })
}
#[tauri::command]
fn save_hosts(
    app: tauri::AppHandle,
    profile_id: Option<String>,
    inputs: Vec<HostMutation>,
) -> Mutation {
    let result = (|| -> Result<String, String> {
        let mut conn = hosts_db(&app)?;
        let profile = resolve_profile(&conn, profile_id)?;
        for input in &inputs {
            format_host(input)?;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let start: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_order),-1)+1 FROM host_entries WHERE profile_id=?1",
                [&profile],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        for (index, input) in inputs.iter().enumerate() {
            tx.execute("INSERT INTO host_entries(id,profile_id,address,hostnames,comment,enabled,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![Uuid::new_v4().to_string(),profile,input.address.trim(),serde_json::to_string(&input.hostnames).unwrap(),input.comment.trim(),input.enabled as i32,start+index as i64]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(String::new())
    })();
    mutation(result)
}
#[tauri::command]
fn save_host(
    app: tauri::AppHandle,
    profile_id: Option<String>,
    id: Option<String>,
    input: HostMutation,
) -> Mutation {
    let result = (|| -> Result<String, String> {
        format_host(&input)?;
        let conn = hosts_db(&app)?;
        let profile = resolve_profile(&conn, profile_id)?;
        if let Some(id) = id {
            if conn.execute("UPDATE host_entries SET address=?1,hostnames=?2,comment=?3,enabled=?4 WHERE id=?5 AND profile_id=?6",params![input.address.trim(),serde_json::to_string(&input.hostnames).unwrap(),input.comment.trim(),input.enabled as i32,id,profile]).map_err(|e|e.to_string())?==0{return Err("配置条目不存在".into())}
        } else {
            let order: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order),-1)+1 FROM host_entries WHERE profile_id=?1",
                    [&profile],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO host_entries(id,profile_id,address,hostnames,comment,enabled,sort_order) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![Uuid::new_v4().to_string(),profile,input.address.trim(),serde_json::to_string(&input.hostnames).unwrap(),input.comment.trim(),input.enabled as i32,order]).map_err(|e|e.to_string())?;
        }
        Ok(String::new())
    })();
    mutation(result)
}
#[tauri::command]
fn delete_host(app: tauri::AppHandle, profile_id: Option<String>, id: String) -> Mutation {
    let result = (|| -> Result<String, String> {
        let conn = hosts_db(&app)?;
        let profile = resolve_profile(&conn, profile_id)?;
        if conn
            .execute(
                "DELETE FROM host_entries WHERE id=?1 AND profile_id=?2",
                params![id, profile],
            )
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("配置条目不存在".into());
        }
        Ok(String::new())
    })();
    mutation(result)
}
#[tauri::command]
fn activate_host_profile(app: tauri::AppHandle, id: String) -> Mutation {
    let result = (|| -> Result<String, String> {
        let mut conn = hosts_db(&app)?;
        let profile = resolve_profile(&conn, Some(id))?;
        let inputs = {
            let mut stmt=conn.prepare("SELECT address,hostnames,comment,enabled FROM host_entries WHERE profile_id=?1 ORDER BY sort_order,rowid").map_err(|e|e.to_string())?;
            let rows = stmt
                .query_map([&profile], |row| {
                    let names: String = row.get(1)?;
                    Ok(HostMutation {
                        address: row.get(0)?,
                        hostnames: serde_json::from_str(&names).unwrap_or_default(),
                        comment: row.get(2)?,
                        enabled: row.get::<_, i64>(3)? != 0,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let old = read_hosts()?;
        let newline = if old.contains("\r\n") { "\r\n" } else { "\n" };
        let mut kept = Vec::new();
        let mut inside = false;
        for line in old.lines() {
            if line.trim() == "# ClosedPort profile start" {
                inside = true;
                continue;
            }
            if line.trim() == "# ClosedPort profile end" {
                inside = false;
                continue;
            }
            if !inside {
                kept.push(line.to_string())
            }
        }
        while kept.last().is_some_and(|line| line.trim().is_empty()) {
            kept.pop();
        }
        kept.push(String::new());
        kept.push("# ClosedPort profile start".into());
        for input in &inputs {
            kept.push(format_host(input)?);
        }
        kept.push("# ClosedPort profile end".into());
        let mut next = kept.join(newline);
        next.push_str(newline);
        write_hosts_text(&next)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("UPDATE host_profiles SET is_active=0", [])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE host_profiles SET is_active=1 WHERE id=?1",
            [profile],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(String::new())
    })();
    mutation(result)
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}
#[derive(Default)]
struct AppState {
    terminals: Mutex<HashMap<String, TerminalSession>>,
    scripts: Mutex<HashMap<String, Arc<Mutex<std::process::Child>>>>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalData {
    id: String,
    data: String,
}
#[tauri::command]
fn create_terminal(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let shell = if cfg!(windows) {
        "powershell.exe"
    } else {
        "sh"
    };
    let child = pair
        .slave
        .spawn_command(CommandBuilder::new(shell))
        .map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let eid = id.clone();
    thread::spawn(move || {
        let mut b = [0u8; 4096];
        while let Ok(n) = reader.read(&mut b) {
            if n == 0 {
                break;
            }
            let _ = app.emit(
                "terminal-data",
                TerminalData {
                    id: eid.clone(),
                    data: String::from_utf8_lossy(&b[..n]).into_owned(),
                },
            );
        }
        let _ = app.emit("terminal-exit", serde_json::json!({"id":eid,"exitCode":0}));
    });
    state.terminals.lock().insert(
        id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            _child: child,
        },
    );
    Ok(id)
}
#[tauri::command]
fn write_terminal(state: State<AppState>, id: String, data: String) {
    if let Some(t) = state.terminals.lock().get_mut(&id) {
        let _ = t.writer.write_all(data.as_bytes());
    }
}
#[tauri::command]
fn resize_terminal(state: State<AppState>, id: String, cols: u16, rows: u16) {
    if let Some(t) = state.terminals.lock().get(&id) {
        let _ = t.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
}
#[tauri::command]
fn close_terminal(state: State<AppState>, id: String) {
    state.terminals.lock().remove(&id);
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptCommand {
    id: String,
    name: String,
    command: String,
    created_at: u64,
    updated_at: u64,
}
fn scripts_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("scripts.json")
}
fn read_scripts(app: &tauri::AppHandle) -> Vec<ScriptCommand> {
    fs::read_to_string(scripts_path(app))
        .ok()
        .and_then(|x| serde_json::from_str(&x).ok())
        .unwrap_or_default()
}
fn store_scripts(app: &tauri::AppHandle, s: &Vec<ScriptCommand>) -> Result<(), String> {
    let p = scripts_path(app);
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?
    }
    fs::write(p, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())
}
#[tauri::command]
fn list_scripts(app: tauri::AppHandle) -> Vec<ScriptCommand> {
    read_scripts(&app)
}
#[tauri::command]
fn save_script(
    app: tauri::AppHandle,
    id: Option<String>,
    name: String,
    command: String,
) -> Mutation {
    let mut s = read_scripts(&app);
    let n = now();
    if let Some(existing) = id.and_then(|id| s.iter_mut().find(|x| x.id == id)) {
        existing.name = name;
        existing.command = command;
        existing.updated_at = n
    } else {
        s.push(ScriptCommand {
            id: Uuid::new_v4().to_string(),
            name,
            command,
            created_at: n,
            updated_at: n,
        })
    }
    mutation(store_scripts(&app, &s).map(|_| String::new()))
}
#[tauri::command]
fn delete_script(app: tauri::AppHandle, id: String) -> Mutation {
    let mut s = read_scripts(&app);
    s.retain(|x| x.id != id);
    mutation(store_scripts(&app, &s).map(|_| String::new()))
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptEvent {
    execution_id: String,
    script_id: String,
    r#type: String,
    data: String,
    timestamp: u64,
    exit_code: Option<i32>,
}
#[tauri::command]
fn execute_script(app: tauri::AppHandle, state: State<AppState>, id: String) -> Mutation {
    let Some(script) = read_scripts(&app).into_iter().find(|x| x.id == id) else {
        return Mutation {
            success: false,
            message: Some("Script not found".into()),
        };
    };
    let mut cmd = if cfg!(windows) {
        let mut x = Command::new("cmd.exe");
        x.args(["/D", "/S", "/C", &script.command]);
        x
    } else {
        let mut x = Command::new("sh");
        x.args(["-c", &script.command]);
        x
    };
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let Ok(child) = cmd.spawn() else {
        return Mutation {
            success: false,
            message: Some("Unable to start script".into()),
        };
    };
    let execution_id = Uuid::new_v4().to_string();
    let child = Arc::new(Mutex::new(child));
    state
        .scripts
        .lock()
        .insert(execution_id.clone(), child.clone());
    let eid = execution_id.clone();
    thread::spawn(move || loop {
        let mut c = child.lock();
        if let Ok(Some(status)) = c.try_wait() {
            let mut data = String::new();
            if let Some(mut o) = c.stdout.take() {
                let _ = o.read_to_string(&mut data);
            }
            if let Some(mut e) = c.stderr.take() {
                let _ = e.read_to_string(&mut data);
            }
            let _ = app.emit(
                "script-event",
                ScriptEvent {
                    execution_id: eid.clone(),
                    script_id: script.id.clone(),
                    r#type: "stdout".into(),
                    data,
                    timestamp: now(),
                    exit_code: None,
                },
            );
            let _ = app.emit(
                "script-event",
                ScriptEvent {
                    execution_id: eid.clone(),
                    script_id: script.id.clone(),
                    r#type: "exit".into(),
                    data: String::new(),
                    timestamp: now(),
                    exit_code: status.code(),
                },
            );
            break;
        }
        drop(c);
        thread::sleep(Duration::from_millis(100));
    });
    Mutation {
        success: true,
        message: None,
    }
}
#[tauri::command]
fn stop_script(state: State<AppState>, execution_id: String) {
    if let Some(c) = state.scripts.lock().remove(&execution_id) {
        let _ = c.lock().kill();
    }
}
#[tauri::command]
fn write_clipboard_text(text: String) {
    if cfg!(windows) {
        let mut c = Command::new("powershell.exe");
        c.args([
            "-NoProfile",
            "-Command",
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ])
        .stdin(Stdio::piped())
        .creation_flags_no_window();
        if let Ok(mut child) = c.spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
        }
    }
}
#[tauri::command]
async fn check_update() -> Result<updater::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(updater::check_update)
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || updater::install_update(app))
        .await
        .map_err(|e| format!("后台任务失败：{e}"))?
}
#[tauri::command]
fn app_version() -> String {
    updater::current_version()
}
#[tauri::command]
fn toggle_floating(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window("floating") {
        if w.is_visible().unwrap_or(false) {
            w.hide().map_err(|e| e.to_string())?;
            return Ok(false);
        }
        w.show().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    WebviewWindowBuilder::new(&app, "floating", WebviewUrl::App("floating.html".into()))
        .title("ClosedPort Floating")
        .inner_size(380.0, 520.0)
        .always_on_top(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("ClosedPort {}", updater::current_version()))?;
            }
            let show = MenuItem::with_id(app, "show", "Show Main", true, None::<&str>)?;
            let floating =
                MenuItem::with_id(app, "floating", "Toggle Floating", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &floating, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ClosedPort")
                .menu(&menu)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "floating" => {
                        let _ = toggle_floating(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_ports,
            list_processes,
            scan_folder,
            scan_folder_ex,
            kill_process,
            kill_processes,
            get_system_info,
            get_system_memory,
            toggle_floating,
            pick_folder,
            reveal_in_folder,
            spawn_test_ports,
            list_startups,
            set_startup_enabled,
            update_startup,
            delete_startup,
            list_host_profiles,
            create_host_profile,
            rename_host_profile,
            delete_host_profile,
            activate_host_profile,
            list_hosts,
            save_host,
            save_hosts,
            delete_host,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            list_scripts,
            save_script,
            delete_script,
            execute_script,
            stop_script,
            write_clipboard_text,
            check_update,
            install_update,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClosedPort");
}
