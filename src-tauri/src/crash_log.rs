use std::io::Write;
use std::path::PathBuf;

const CRASH_LOG_RETENTION_HOURS: i64 = 24;
const CRASH_LOG_MAX_BYTES: usize = 256 * 1024;

fn crash_log_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata)
            .join("com.qollect.clipboard")
            .join("crash.log")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".local/share/com.qollect.clipboard/crash.log")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join("Library/Application Support/com.qollect.clipboard/crash.log")
    }
}

fn parse_entry_timestamp(line: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let prefix = "=== CRASH at ";
    let suffix = " ===";
    let ts = line.strip_prefix(prefix)?.strip_suffix(suffix)?;
    let naive = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S UTC").ok()?;
    Some(chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(
        naive,
        chrono::Utc,
    ))
}

fn trim_to_max_bytes(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut start = text.len().saturating_sub(max_bytes);
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    text[start..].to_string()
}

fn prune_crash_log(path: &PathBuf) {
    let content = match std::fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return,
    };
    if content.is_empty() {
        return;
    }

    let cutoff = chrono::Utc::now() - chrono::Duration::hours(CRASH_LOG_RETENTION_HOURS);
    let mut kept = String::new();
    let mut current_entry = String::new();
    let mut current_ts: Option<chrono::DateTime<chrono::Utc>> = None;

    for line in content.lines() {
        if let Some(ts) = parse_entry_timestamp(line) {
            if !current_entry.is_empty() {
                if current_ts.map(|t| t >= cutoff).unwrap_or(true) {
                    kept.push_str(&current_entry);
                }
                current_entry.clear();
            }
            current_ts = Some(ts);
        }
        current_entry.push_str(line);
        current_entry.push('\n');
    }

    if !current_entry.is_empty() && current_ts.map(|t| t >= cutoff).unwrap_or(true) {
        kept.push_str(&current_entry);
    }

    let final_content = trim_to_max_bytes(&kept, CRASH_LOG_MAX_BYTES);
    let _ = std::fs::write(path, final_content);
}

pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    let log_path = crash_log_path();
    println!(
        "[CrashLog] Panic hook installed, log path: {}",
        log_path.display()
    );

    std::panic::set_hook(Box::new(move |info| {
        let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();

        let entry = format!(
            "=== CRASH at {} ===\nMessage: {}\nLocation: {}\nBacktrace:\n{}\n\n",
            timestamp, message, location, backtrace
        );

        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        prune_crash_log(&log_path);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = file.write_all(entry.as_bytes());
        }
        prune_crash_log(&log_path);

        default_hook(info);
    }));
}

#[tauri::command]
pub fn get_crash_log(tail_lines: Option<usize>) -> Result<String, String> {
    let path = crash_log_path();
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let n = tail_lines.unwrap_or(200);
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= n {
        Ok(content)
    } else {
        Ok(lines[lines.len() - n..].join("\n"))
    }
}

#[tauri::command]
pub fn clear_crash_log() -> Result<(), String> {
    let path = crash_log_path();
    if path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}
