use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::{now, Mutation, NoWindow};

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchCommand {
    id: String,
    name: String,
    command: String,
    #[serde(default)]
    cwd: String,
    #[serde(default = "default_true")]
    kill_before_start: bool,
    created_at: u64,
    updated_at: u64,
    last_pid: Option<u32>,
    /// Process start time (epoch seconds) of `last_pid`, used to detect PID reuse.
    last_pid_start: Option<u64>,
    last_started_at: Option<u64>,
    last_exited_at: Option<u64>,
    last_exit_code: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInput {
    name: String,
    command: String,
    #[serde(default)]
    cwd: String,
    #[serde(default = "default_true")]
    kill_before_start: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCommandView {
    #[serde(flatten)]
    command: BatchCommand,
    running: bool,
    pid: Option<u32>,
    run_id: Option<String>,
    started_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchActionResult {
    id: String,
    success: bool,
    message: Option<String>,
    pid: Option<u32>,
    run_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchEvent {
    command_id: String,
    run_id: String,
    r#type: &'static str,
    data: String,
    timestamp: u64,
    pid: Option<u32>,
    exit_code: Option<i32>,
}

struct Running {
    run_id: String,
    pid: u32,
    started_at: u64,
    child: Arc<Mutex<Child>>,
}

#[derive(Default)]
pub struct BatchState {
    running: Mutex<HashMap<String, Running>>,
    store: Mutex<()>,
}

fn store_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("batch_commands.json")
}
fn read_all(app: &tauri::AppHandle) -> Vec<BatchCommand> {
    fs::read_to_string(store_path(app))
        .ok()
        .and_then(|x| serde_json::from_str(&x).ok())
        .unwrap_or_default()
}
fn write_all(app: &tauri::AppHandle, items: &[BatchCommand]) -> Result<(), String> {
    let p = store_path(app);
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?
    }
    let data = serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?;
    fs::write(p, data).map_err(|e| e.to_string())
}
fn modify<T>(
    app: &tauri::AppHandle,
    state: &BatchState,
    f: impl FnOnce(&mut Vec<BatchCommand>) -> T,
) -> Result<T, String> {
    let _guard = state.store.lock();
    let mut items = read_all(app);
    let out = f(&mut items);
    write_all(app, &items)?;
    Ok(out)
}

fn emit(app: &tauri::AppHandle, command_id: &str, run_id: &str, kind: &'static str, data: String) {
    let _ = app.emit(
        "batch-event",
        BatchEvent {
            command_id: command_id.into(),
            run_id: run_id.into(),
            r#type: kind,
            data,
            timestamp: now(),
            pid: None,
            exit_code: None,
        },
    );
}

fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) if cfg!(windows) => encoding_rs::GBK.decode(bytes).0.into_owned(),
        Err(_) => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn process_start(pid: u32) -> Option<u64> {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
    sys.process(p).map(|x| x.start_time())
}
/// True only when `pid` is alive AND is still the process we spawned.
fn is_same_process(pid: u32, recorded_start: Option<u64>) -> bool {
    match (process_start(pid), recorded_start) {
        (Some(actual), Some(expected)) => actual.abs_diff(expected) <= 1,
        _ => false,
    }
}

fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::output("taskkill", &["/PID", &pid.to_string(), "/T", "/F"]).map(|_| ())
    }
    #[cfg(not(windows))]
    {
        let group = format!("-{pid}");
        crate::output("kill", &["-TERM", &group])
            .or_else(|_| crate::output("kill", &["-KILL", &pid.to_string()]))
            .map(|_| ())
    }
}

fn wait_gone(pid: u32, child: Option<&Arc<Mutex<Child>>>, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let gone = match child {
            Some(c) => !matches!(c.lock().try_wait(), Ok(None)),
            None => process_start(pid).is_none(),
        };
        if gone {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/// Kill the managed child of `id`, or the recorded `last_pid` when the app was
/// restarted in between. Returns the killed PID.
fn kill_existing(state: &BatchState, item: &BatchCommand) -> Option<u32> {
    let managed = state
        .running
        .lock()
        .get(&item.id)
        .map(|r| (r.pid, r.child.clone()));
    if let Some((pid, child)) = managed {
        if matches!(child.lock().try_wait(), Ok(None)) {
            let _ = kill_tree(pid);
            if matches!(child.lock().try_wait(), Ok(None)) {
                let _ = child.lock().kill();
            }
            wait_gone(pid, Some(&child), Duration::from_secs(5));
            return Some(pid);
        }
    }
    let pid = item.last_pid?;
    if !is_same_process(pid, item.last_pid_start) {
        return None;
    }
    let _ = kill_tree(pid);
    wait_gone(pid, None, Duration::from_secs(5));
    Some(pid)
}

fn shell_command(item: &BatchCommand) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut x = Command::new("cmd.exe");
        x.arg("/D").arg("/S").arg("/C");
        x.raw_arg(format!("\"{}\"", item.command));
        x.creation_flags_no_window();
        x
    };
    #[cfg(not(windows))]
    let mut cmd = {
        use std::os::unix::process::CommandExt;
        let mut x = Command::new("sh");
        x.args(["-c", &item.command]).process_group(0);
        x.creation_flags_no_window();
        x
    };
    if !item.cwd.trim().is_empty() {
        cmd.current_dir(item.cwd.trim());
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

fn pipe_lines(
    app: tauri::AppHandle,
    command_id: String,
    run_id: String,
    kind: &'static str,
    stream: impl Read + Send + 'static,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = decode(&buf);
                    let line = line.trim_end_matches(['\r', '\n']);
                    emit(&app, &command_id, &run_id, kind, line.to_string());
                }
            }
        }
    });
}

fn start_one(app: &tauri::AppHandle, state: &BatchState, id: &str, restart: bool) -> BatchActionResult {
    let fail = |message: String| BatchActionResult {
        id: id.into(),
        success: false,
        message: Some(message),
        pid: None,
        run_id: None,
    };
    let Some(item) = read_all(app).into_iter().find(|x| x.id == id) else {
        return fail("命令不存在".into());
    };
    let already_running = state
        .running
        .lock()
        .get(id)
        .is_some_and(|r| matches!(r.child.lock().try_wait(), Ok(None)));
    if already_running && !restart && !item.kill_before_start {
        return fail("命令正在运行中".into());
    }
    let run_id = Uuid::new_v4().to_string();
    if restart || item.kill_before_start {
        if let Some(old) = kill_existing(state, &item) {
            emit(app, id, &run_id, "system", format!("已结束旧进程树 PID {old}"));
        }
    }

    let mut child = match shell_command(&item).spawn() {
        Ok(c) => c,
        Err(e) => {
            emit(app, id, &run_id, "error", format!("启动失败：{e}"));
            return fail(format!("启动失败：{e}"));
        }
    };
    let pid = child.id();
    let started_at = now();
    let pid_start = process_start(pid);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    state.running.lock().insert(
        id.into(),
        Running {
            run_id: run_id.clone(),
            pid,
            started_at,
            child: child.clone(),
        },
    );
    let _ = modify(app, state, |items| {
        if let Some(x) = items.iter_mut().find(|x| x.id == id) {
            x.last_pid = Some(pid);
            x.last_pid_start = pid_start;
            x.last_started_at = Some(started_at);
            x.last_exited_at = None;
            x.last_exit_code = None;
        }
    });
    let _ = app.emit(
        "batch-event",
        BatchEvent {
            command_id: id.into(),
            run_id: run_id.clone(),
            r#type: "start",
            data: item.command.clone(),
            timestamp: started_at,
            pid: Some(pid),
            exit_code: None,
        },
    );
    if let Some(o) = stdout {
        pipe_lines(app.clone(), id.into(), run_id.clone(), "stdout", o);
    }
    if let Some(e) = stderr {
        pipe_lines(app.clone(), id.into(), run_id.clone(), "stderr", e);
    }

    let app2 = app.clone();
    let cid = id.to_string();
    let rid = run_id.clone();
    thread::spawn(move || {
        let status = loop {
            if let Ok(Some(s)) = child.lock().try_wait() {
                break s;
            }
            thread::sleep(Duration::from_millis(200));
        };
        let state = app2.state::<BatchState>();
        {
            let mut running = state.running.lock();
            if running.get(&cid).is_some_and(|r| r.run_id == rid) {
                running.remove(&cid);
            }
        }
        let code = status.code();
        let _ = modify(&app2, &state, |items| {
            if let Some(x) = items
                .iter_mut()
                .find(|x| x.id == cid && x.last_pid == Some(pid))
            {
                x.last_exited_at = Some(now());
                x.last_exit_code = code;
            }
        });
        let _ = app2.emit(
            "batch-event",
            BatchEvent {
                command_id: cid,
                run_id: rid,
                r#type: "exit",
                data: String::new(),
                timestamp: now(),
                pid: Some(pid),
                exit_code: code,
            },
        );
    });

    BatchActionResult {
        id: id.into(),
        success: true,
        message: None,
        pid: Some(pid),
        run_id: Some(run_id),
    }
}

fn stop_one(app: &tauri::AppHandle, state: &BatchState, id: &str) -> BatchActionResult {
    let item = read_all(app).into_iter().find(|x| x.id == id);
    let killed = item.as_ref().and_then(|x| kill_existing(state, x));
    if let Some(pid) = killed {
        let run_id = state
            .running
            .lock()
            .get(id)
            .map(|r| r.run_id.clone())
            .unwrap_or_default();
        emit(app, id, &run_id, "system", format!("已结束进程树 PID {pid}"));
    }
    BatchActionResult {
        id: id.into(),
        success: item.is_some(),
        message: match (&item, killed) {
            (None, _) => Some("命令不存在".into()),
            (Some(_), None) => Some("进程未在运行".into()),
            _ => None,
        },
        pid: killed,
        run_id: None,
    }
}

fn run_parallel(ids: Vec<String>, f: impl Fn(&str) -> BatchActionResult + Send + Sync) -> Vec<BatchActionResult> {
    let f = &f;
    thread::scope(|s| {
        let handles: Vec<_> = ids.iter().map(|id| s.spawn(move || f(id))).collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    })
}

#[tauri::command]
pub fn list_batch_commands(app: tauri::AppHandle, state: State<BatchState>) -> Vec<BatchCommandView> {
    let running = state.running.lock();
    read_all(&app)
        .into_iter()
        .map(|command| {
            let r = running.get(&command.id);
            BatchCommandView {
                running: r.is_some(),
                pid: r.map(|x| x.pid),
                run_id: r.map(|x| x.run_id.clone()),
                started_at: r.map(|x| x.started_at),
                command,
            }
        })
        .collect()
}

#[tauri::command]
pub fn save_batch_command(
    app: tauri::AppHandle,
    state: State<BatchState>,
    id: Option<String>,
    input: BatchInput,
) -> Mutation {
    if input.command.trim().is_empty() {
        return Mutation {
            success: false,
            message: Some("命令不能为空".into()),
        };
    }
    let n = now();
    crate::mutation(
        modify(&app, &state, |items| {
            match id.and_then(|id| items.iter_mut().find(|x| x.id == id)) {
                Some(x) => {
                    x.name = input.name;
                    x.command = input.command;
                    x.cwd = input.cwd;
                    x.kill_before_start = input.kill_before_start;
                    x.updated_at = n;
                }
                None => items.push(new_command(input, n)),
            }
        })
        .map(|_| String::new()),
    )
}

fn new_command(input: BatchInput, n: u64) -> BatchCommand {
    BatchCommand {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        command: input.command,
        cwd: input.cwd,
        kill_before_start: input.kill_before_start,
        created_at: n,
        updated_at: n,
        last_pid: None,
        last_pid_start: None,
        last_started_at: None,
        last_exited_at: None,
        last_exit_code: None,
    }
}

#[tauri::command]
pub fn add_batch_commands(
    app: tauri::AppHandle,
    state: State<BatchState>,
    inputs: Vec<BatchInput>,
) -> Mutation {
    let n = now();
    crate::mutation(
        modify(&app, &state, |items| {
            items.extend(
                inputs
                    .into_iter()
                    .filter(|x| !x.command.trim().is_empty())
                    .map(|x| new_command(x, n)),
            )
        })
        .map(|_| String::new()),
    )
}

#[tauri::command]
pub fn delete_batch_commands(
    app: tauri::AppHandle,
    state: State<BatchState>,
    ids: Vec<String>,
) -> Mutation {
    let busy = {
        let running = state.running.lock();
        ids.iter().any(|id| running.contains_key(id))
    };
    if busy {
        return Mutation {
            success: false,
            message: Some("请先结束正在运行的命令".into()),
        };
    }
    crate::mutation(
        modify(&app, &state, |items| items.retain(|x| !ids.contains(&x.id)))
            .map(|_| String::new()),
    )
}

#[tauri::command]
pub async fn start_batch_commands(
    app: tauri::AppHandle,
    ids: Vec<String>,
    restart: bool,
) -> Result<Vec<BatchActionResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BatchState>();
        run_parallel(ids, |id| start_one(&app, &state, id, restart))
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_batch_commands(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Vec<BatchActionResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BatchState>();
        run_parallel(ids, |id| stop_one(&app, &state, id))
    })
    .await
    .map_err(|e| e.to_string())
}
