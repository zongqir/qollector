use crate::commands::ai_commands::AIState;
use crate::config::GeneralConfig;
use crate::commands::input_access_probe_commands::InputCaptureState;
use crate::shortcuts::{apply_shortcut_config, ShortcutBindingState};
use crate::startup_metrics::{StartupMetricsSnapshot, StartupMetricsState};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

fn shortcut_fields_changed(next: &GeneralConfig, previous: &GeneralConfig) -> bool {
    next.toggle_window_shortcut_enabled != previous.toggle_window_shortcut_enabled
        || next.toggle_window_shortcut != previous.toggle_window_shortcut
}

#[tauri::command]
pub async fn get_general_config(ai_state: State<'_, AIState>) -> Result<GeneralConfig, String> {
    let config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(config)
}

#[tauri::command]
pub async fn update_general_config(
    app: AppHandle,
    ai_state: State<'_, AIState>,
    shortcut_state: State<'_, Arc<ShortcutBindingState>>,
    input_capture_state: State<'_, Arc<InputCaptureState>>,
    mut config: GeneralConfig,
) -> Result<(), String> {
    config.validate();
    let previous_config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let shortcuts_changed = shortcut_fields_changed(&config, &previous_config);

    if shortcuts_changed {
        apply_shortcut_config(&app, shortcut_state.inner(), &config)?;
    }

    if let Err(error) = ai_state.config_repo.save_general_config(&config).await {
        if shortcuts_changed {
            let _ = apply_shortcut_config(&app, shortcut_state.inner(), &previous_config);
        }
        return Err(error.to_string());
    }

    input_capture_state.set_enabled(config.input_capture_enabled);

    if let Some(copy_on_select_state) =
        app.try_state::<Arc<crate::copy_on_select::CopyOnSelectState>>()
    {
        copy_on_select_state.update(
            config.copy_on_select_enabled,
            config.copy_on_select_double_click_enabled,
        );
    }

    // Update tray menu language if it changed
    if config.language != previous_config.language {
        crate::tray::update_tray_language(&app, &config.language);
    }

    // Update autostart if it changed
    if config.autostart_enabled != previous_config.autostart_enabled {
        if let Err(e) = update_autostart_state(&app, config.autostart_enabled) {
            eprintln!("[Autostart] Failed to update autostart state: {}", e);
        }
    }

    Ok(())
}

fn update_autostart_state(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autostart_manager = app.autolaunch();

    if enabled {
        if !autostart_manager
            .is_enabled()
            .map_err(|e: tauri_plugin_autostart::Error| e.to_string())?
        {
            autostart_manager
                .enable()
                .map_err(|e: tauri_plugin_autostart::Error| e.to_string())?;
            println!("[Autostart] Enabled");
        }
    } else {
        if autostart_manager
            .is_enabled()
            .map_err(|e: tauri_plugin_autostart::Error| e.to_string())?
        {
            autostart_manager
                .disable()
                .map_err(|e: tauri_plugin_autostart::Error| e.to_string())?;
            println!("[Autostart] Disabled");
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct WebviewProcessSnapshot {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub process_role: String,
    pub role_source: String,
    pub role_confidence: String,
    pub utility_sub_type: Option<String>,
    pub exe_path: Option<String>,
    pub command_line_preview: String,
    pub memory_bytes: u64,
    pub virtual_memory_bytes: u64,
    pub cpu_usage_percent: f32,
    pub start_time_unix_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowSnapshot {
    pub handle: String,
    pub title: String,
    pub visible: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebviewRoleSummary {
    pub role: String,
    pub process_count: usize,
    pub memory_bytes_total: u64,
    pub virtual_memory_bytes_total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeDiagnosticsSnapshot {
    pub captured_at_unix_ms: i64,
    pub app_pid: u32,
    pub app_memory_bytes: u64,
    pub app_virtual_memory_bytes: u64,
    pub descendant_process_count: usize,
    pub webview2_process_count: usize,
    pub webview2_memory_bytes_total: u64,
    pub webview2_virtual_memory_bytes_total: u64,
    pub webview2_browser_host_pid: Option<u32>,
    pub webview2_role_summary: Vec<WebviewRoleSummary>,
    pub webview2_processes: Vec<WebviewProcessSnapshot>,
    pub windows: Vec<WindowSnapshot>,
}

fn collect_descendant_pids(system: &System, root: Pid) -> HashSet<Pid> {
    let mut descendants = HashSet::new();
    let mut stack = vec![root];

    while let Some(current) = stack.pop() {
        for (pid, process) in system.processes() {
            if process.parent() == Some(current) && descendants.insert(*pid) {
                stack.push(*pid);
            }
        }
    }

    descendants
}

fn extract_flag_value<'a>(args: &'a [String], prefix: &str) -> Option<&'a str> {
    args.iter().find_map(|arg| arg.strip_prefix(prefix))
}

fn detect_webview2_role(args: &[String]) -> Option<(String, Option<String>)> {
    let role = extract_flag_value(args, "--type=")?.to_string();
    let utility_sub_type = extract_flag_value(args, "--utility-sub-type=").map(str::to_string);
    Some((role, utility_sub_type))
}

fn set_heuristic_role(
    process: &mut WebviewProcessSnapshot,
    role: &str,
    utility_sub_type: Option<&str>,
    confidence: &str,
) {
    process.process_role = role.to_string();
    process.utility_sub_type = utility_sub_type.map(str::to_string);
    process.role_source = "heuristic".to_string();
    process.role_confidence = confidence.to_string();
}

fn infer_webview2_roles_heuristically(
    app_pid: u32,
    webview2_processes: &mut [WebviewProcessSnapshot],
) -> Option<u32> {
    if webview2_processes.is_empty() {
        return None;
    }

    let browser_host_idx = webview2_processes
        .iter()
        .enumerate()
        .filter(|(_, p)| p.parent_pid == Some(app_pid))
        .min_by_key(|(_, p)| p.start_time_unix_secs)
        .map(|(idx, _)| idx)
        .or_else(|| {
            webview2_processes
                .iter()
                .enumerate()
                .max_by_key(|(_, p)| p.memory_bytes)
                .map(|(idx, _)| idx)
        });

    let browser_host_pid = browser_host_idx.map(|idx| webview2_processes[idx].pid);

    if let Some(idx) = browser_host_idx {
        if webview2_processes[idx].process_role == "unknown" {
            set_heuristic_role(&mut webview2_processes[idx], "browser_host", None, "high");
        }
    }

    let Some(host_pid) = browser_host_pid else {
        return None;
    };

    let mut unknown_child_indexes: Vec<usize> = webview2_processes
        .iter()
        .enumerate()
        .filter(|(_, p)| p.parent_pid == Some(host_pid) && p.process_role == "unknown")
        .map(|(idx, _)| idx)
        .collect();

    if let Some(gpu_idx) = unknown_child_indexes
        .iter()
        .copied()
        .max_by_key(|idx| webview2_processes[*idx].virtual_memory_bytes)
    {
        set_heuristic_role(
            &mut webview2_processes[gpu_idx],
            "gpu_process",
            Some("gpu"),
            "medium",
        );
        unknown_child_indexes.retain(|idx| *idx != gpu_idx);
    }

    if let Some(renderer_idx) = unknown_child_indexes
        .iter()
        .copied()
        .max_by_key(|idx| webview2_processes[*idx].memory_bytes)
    {
        set_heuristic_role(
            &mut webview2_processes[renderer_idx],
            "renderer_main",
            None,
            "medium",
        );
        unknown_child_indexes.retain(|idx| *idx != renderer_idx);
    }

    for idx in unknown_child_indexes {
        let memory_mb = webview2_processes[idx].memory_bytes as f64 / 1024.0 / 1024.0;
        if memory_mb >= 20.0 {
            set_heuristic_role(
                &mut webview2_processes[idx],
                "utility_or_renderer_aux",
                None,
                "low",
            );
        } else {
            set_heuristic_role(&mut webview2_processes[idx], "utility_light", None, "low");
        }
    }

    for process in webview2_processes.iter_mut() {
        if process.process_role != "unknown" {
            continue;
        }

        if process.pid == host_pid {
            set_heuristic_role(process, "browser_host", None, "medium");
            continue;
        }

        set_heuristic_role(process, "webview2_other", None, "low");
    }

    Some(host_pid)
}

fn summarize_webview2_roles(
    webview2_processes: &[WebviewProcessSnapshot],
) -> Vec<WebviewRoleSummary> {
    let mut grouped: HashMap<String, (usize, u64, u64)> = HashMap::new();

    for process in webview2_processes {
        let entry = grouped
            .entry(process.process_role.clone())
            .or_insert((0usize, 0u64, 0u64));
        entry.0 += 1;
        entry.1 += process.memory_bytes;
        entry.2 += process.virtual_memory_bytes;
    }

    let mut summaries = grouped
        .into_iter()
        .map(
            |(role, (process_count, memory_bytes_total, virtual_memory_bytes_total))| {
                WebviewRoleSummary {
                    role,
                    process_count,
                    memory_bytes_total,
                    virtual_memory_bytes_total,
                }
            },
        )
        .collect::<Vec<_>>();

    summaries.sort_by(|a, b| b.memory_bytes_total.cmp(&a.memory_bytes_total));
    summaries
}

fn command_line_preview(args: &[String], max_len: usize) -> String {
    let mut joined = args.join(" ");
    if joined.len() > max_len {
        joined.truncate(max_len);
        joined.push_str("...");
    }
    joined
}

#[cfg(target_os = "windows")]
fn collect_windows_for_pid(target_pid: u32) -> Vec<WindowSnapshot> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    struct EnumContext {
        target_pid: u32,
        windows: Vec<WindowSnapshot>,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut EnumContext);

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != ctx.target_pid {
            return BOOL(1);
        }

        let title_len = GetWindowTextLengthW(hwnd);
        let title = if title_len > 0 {
            let mut buf = vec![0u16; (title_len + 1) as usize];
            let copied = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..copied.max(0) as usize])
        } else {
            String::new()
        };

        let mut rect = RECT::default();
        let has_rect = GetWindowRect(hwnd, &mut rect).is_ok();
        let (x, y, width, height) = if has_rect {
            (
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
            )
        } else {
            (0, 0, 0, 0)
        };

        ctx.windows.push(WindowSnapshot {
            handle: format!("0x{:X}", hwnd.0 as usize),
            title,
            visible: IsWindowVisible(hwnd).as_bool(),
            x,
            y,
            width,
            height,
        });

        BOOL(1)
    }

    let mut ctx = EnumContext {
        target_pid,
        windows: Vec::new(),
    };

    unsafe {
        let lparam = LPARAM((&mut ctx as *mut EnumContext) as isize);
        let _ = EnumWindows(Some(enum_windows_proc), lparam);
    }

    ctx.windows.sort_by(|a, b| {
        b.visible
            .cmp(&a.visible)
            .then_with(|| b.width.cmp(&a.width))
            .then_with(|| b.height.cmp(&a.height))
            .then_with(|| a.handle.cmp(&b.handle))
    });
    ctx.windows
}

#[cfg(not(target_os = "windows"))]
fn collect_windows_for_pid(_target_pid: u32) -> Vec<WindowSnapshot> {
    Vec::new()
}

pub fn collect_runtime_diagnostics_snapshot() -> RuntimeDiagnosticsSnapshot {
    let mut system = System::new();
    let refresh_kind = ProcessRefreshKind::everything()
        .with_cmd(UpdateKind::Always)
        .with_exe(UpdateKind::Always);
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh_kind);

    let app_pid_u32 = std::process::id();
    let app_pid = Pid::from_u32(app_pid_u32);
    let descendants = collect_descendant_pids(&system, app_pid);

    let mut webview2_processes = Vec::new();
    for pid in &descendants {
        if let Some(process) = system.process(*pid) {
            let name = process.name().to_string_lossy().to_string();
            let lower = name.to_ascii_lowercase();
            if lower.contains("msedgewebview2") {
                let cmd_args: Vec<String> = process
                    .cmd()
                    .iter()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect();
                let (process_role, utility_sub_type, role_source, role_confidence) =
                    if let Some((role, utility_sub_type)) = detect_webview2_role(&cmd_args) {
                        (
                            role,
                            utility_sub_type,
                            "cmdline".to_string(),
                            "high".to_string(),
                        )
                    } else {
                        (
                            "unknown".to_string(),
                            None,
                            "unknown".to_string(),
                            "unknown".to_string(),
                        )
                    };
                webview2_processes.push(WebviewProcessSnapshot {
                    pid: pid.as_u32(),
                    parent_pid: process.parent().map(|p| p.as_u32()),
                    name,
                    process_role,
                    role_source,
                    role_confidence,
                    utility_sub_type,
                    exe_path: process.exe().map(|path| path.to_string_lossy().to_string()),
                    command_line_preview: command_line_preview(&cmd_args, 260),
                    memory_bytes: process.memory(),
                    virtual_memory_bytes: process.virtual_memory(),
                    cpu_usage_percent: process.cpu_usage(),
                    start_time_unix_secs: process.start_time(),
                });
            }
        }
    }

    let webview2_browser_host_pid =
        infer_webview2_roles_heuristically(app_pid_u32, &mut webview2_processes);
    webview2_processes.sort_by(|a, b| b.memory_bytes.cmp(&a.memory_bytes));
    let webview2_role_summary = summarize_webview2_roles(&webview2_processes);

    let webview2_memory_bytes_total = webview2_processes
        .iter()
        .map(|p| p.memory_bytes)
        .sum::<u64>();
    let webview2_virtual_memory_bytes_total = webview2_processes
        .iter()
        .map(|p| p.virtual_memory_bytes)
        .sum::<u64>();

    let (app_memory_bytes, app_virtual_memory_bytes) =
        if let Some(process) = system.process(app_pid) {
            (process.memory(), process.virtual_memory())
        } else {
            (0, 0)
        };

    RuntimeDiagnosticsSnapshot {
        captured_at_unix_ms: chrono::Utc::now().timestamp_millis(),
        app_pid: app_pid_u32,
        app_memory_bytes,
        app_virtual_memory_bytes,
        descendant_process_count: descendants.len(),
        webview2_process_count: webview2_processes.len(),
        webview2_memory_bytes_total,
        webview2_virtual_memory_bytes_total,
        webview2_browser_host_pid,
        webview2_role_summary,
        webview2_processes,
        windows: collect_windows_for_pid(app_pid_u32),
    }
}

#[tauri::command]
pub fn get_runtime_diagnostics() -> Result<RuntimeDiagnosticsSnapshot, String> {
    Ok(collect_runtime_diagnostics_snapshot())
}

#[tauri::command]
pub fn get_startup_metrics(
    startup_metrics: State<'_, Arc<StartupMetricsState>>,
) -> Result<StartupMetricsSnapshot, String> {
    Ok(startup_metrics.snapshot())
}

#[tauri::command]
pub fn analyze_quick_action(text: String) -> Result<Option<crate::quick_action::QuickActionResult>, String> {
    Ok(crate::quick_action::detect_quick_action(&text))
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

