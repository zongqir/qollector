use std::io::Write;
use std::path::PathBuf;

fn crash_log_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("com.qollect.clipboard").join("crash.log")
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

pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    let log_path = crash_log_path();
    println!("[CrashLog] Panic hook installed, log path: {}", log_path.display());

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
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = file.write_all(entry.as_bytes());
        }

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
