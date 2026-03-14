use sha2::{Digest, Sha256};

/// Get a stable device identifier, hashed with SHA256.
/// - Windows: MachineGuid from registry
/// - macOS: IOPlatformUUID via ioreg
/// - Linux: /etc/machine-id
pub fn get_device_id() -> Result<String, String> {
    let raw = get_raw_machine_id()?;
    let mut hasher = Sha256::new();
    hasher.update(raw.trim().as_bytes());
    let result = hasher.finalize();
    Ok(hex::encode(result))
}

/// Get a human-readable device name for display.
pub fn get_device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "Unknown".to_string())
}

/// Get the current platform string.
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[cfg(target_os = "windows")]
fn get_raw_machine_id() -> Result<String, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey("SOFTWARE\\Microsoft\\Cryptography")
        .map_err(|e| format!("Failed to open registry key: {}", e))?;
    let guid: String = key
        .get_value("MachineGuid")
        .map_err(|e| format!("Failed to read MachineGuid: {}", e))?;
    Ok(guid)
}

#[cfg(target_os = "macos")]
fn get_raw_machine_id() -> Result<String, String> {
    let output = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|e| format!("Failed to run ioreg: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("IOPlatformUUID") {
            if let Some(uuid) = line.split('"').nth(3) {
                return Ok(uuid.to_string());
            }
        }
    }
    Err("IOPlatformUUID not found".to_string())
}

#[cfg(target_os = "linux")]
fn get_raw_machine_id() -> Result<String, String> {
    std::fs::read_to_string("/etc/machine-id")
        .map_err(|e| format!("Failed to read /etc/machine-id: {}", e))
}
