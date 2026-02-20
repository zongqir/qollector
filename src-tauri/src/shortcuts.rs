use crate::config::GeneralConfig;
use std::collections::BTreeSet;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutAction {
    None,
    CopyPin,
    ToggleWindow,
}

#[derive(Debug, Clone, Default)]
struct ShortcutBindingsSnapshot {
    copy_pin_shortcut: Option<String>,
    copy_pin_id: Option<u32>,
    toggle_window_shortcut: Option<String>,
    toggle_window_id: Option<u32>,
}

#[derive(Default)]
pub struct ShortcutBindingState {
    inner: Mutex<ShortcutBindingsSnapshot>,
}

impl ShortcutBindingState {
    pub fn action_for_shortcut_id(&self, shortcut_id: u32) -> ShortcutAction {
        let snapshot = self.inner.lock().unwrap();
        if snapshot.copy_pin_id == Some(shortcut_id) {
            return ShortcutAction::CopyPin;
        }
        if snapshot.toggle_window_id == Some(shortcut_id) {
            return ShortcutAction::ToggleWindow;
        }
        ShortcutAction::None
    }

    fn snapshot(&self) -> ShortcutBindingsSnapshot {
        self.inner.lock().unwrap().clone()
    }

    fn replace(&self, snapshot: ShortcutBindingsSnapshot) {
        *self.inner.lock().unwrap() = snapshot;
    }
}

fn has_modifier(shortcut: &str) -> bool {
    const MODIFIERS: [&str; 8] = [
        "ctrl", "control", "alt", "shift", "super", "cmd", "command", "meta",
    ];
    MODIFIERS.iter().any(|m| shortcut.contains(m))
}

fn normalize_shortcut_token(token: &str) -> String {
    match token.trim().to_ascii_lowercase().as_str() {
        "control" => "ctrl".to_string(),
        "cmd" | "command" | "meta" => "super".to_string(),
        "option" => "alt".to_string(),
        "return" => "enter".to_string(),
        "escape" => "esc".to_string(),
        other => other.to_string(),
    }
}

fn shortcut_token_set(shortcut: &str) -> BTreeSet<String> {
    shortcut
        .split('+')
        .map(normalize_shortcut_token)
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(target_os = "windows")]
fn reserved_shortcuts() -> &'static [&'static str] {
    &[
        "alt+tab",
        "alt+f4",
        "super+l",
        "super+d",
        "super+tab",
        "ctrl+alt+delete",
    ]
}

#[cfg(target_os = "macos")]
fn reserved_shortcuts() -> &'static [&'static str] {
    &[
        "super+q",
        "super+tab",
        "super+space",
        "ctrl+space",
        "super+h",
    ]
}

#[cfg(target_os = "linux")]
fn reserved_shortcuts() -> &'static [&'static str] {
    &["alt+tab", "alt+f4", "super+l"]
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn reserved_shortcuts() -> &'static [&'static str] {
    &["alt+tab"]
}

#[cfg(target_os = "windows")]
fn platform_name() -> &'static str {
    "Windows"
}

#[cfg(target_os = "macos")]
fn platform_name() -> &'static str {
    "macOS"
}

#[cfg(target_os = "linux")]
fn platform_name() -> &'static str {
    "Linux"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_name() -> &'static str {
    "current platform"
}

fn is_reserved_shortcut(shortcut: &str) -> bool {
    let current = shortcut_token_set(shortcut);
    if current.is_empty() {
        return false;
    }
    reserved_shortcuts()
        .iter()
        .any(|candidate| shortcut_token_set(candidate) == current)
}

#[cfg(desktop)]
fn parse_shortcut(
    raw: &str,
    field_name: &str,
) -> Result<(String, tauri_plugin_global_shortcut::Shortcut), String> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(format!("{} cannot be empty", field_name));
    }
    if !has_modifier(&normalized) {
        return Err(format!(
            "{} must include at least one modifier key (Ctrl/Alt/Shift/Super)",
            field_name
        ));
    }
    if is_reserved_shortcut(&normalized) {
        return Err(format!(
            "{} uses a reserved system shortcut on {}: {}",
            field_name,
            platform_name(),
            normalized
        ));
    }
    let parsed = normalized
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| format!("Invalid {} '{}': {}", field_name, raw, e))?;
    Ok((normalized, parsed))
}

#[cfg(desktop)]
pub fn apply_shortcut_config(
    app: &AppHandle,
    state: &Arc<ShortcutBindingState>,
    config: &GeneralConfig,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let mut desired = ShortcutBindingsSnapshot::default();
    let mut desired_items: Vec<(ShortcutAction, String)> = Vec::new();
    let mut desired_ids: HashMap<u32, ShortcutAction> = HashMap::new();

    if config.ctrl_shift_c_shortcut_enabled {
        let (shortcut_text, parsed) =
            parse_shortcut(&config.copy_pin_shortcut, "copy_pin_shortcut")?;
        let id = parsed.id();
        if let Some(existing) = desired_ids.insert(id, ShortcutAction::CopyPin) {
            return Err(format!(
                "Shortcut conflict between {:?} and {:?}: {}",
                existing,
                ShortcutAction::CopyPin,
                shortcut_text
            ));
        }
        desired.copy_pin_shortcut = Some(shortcut_text.clone());
        desired.copy_pin_id = Some(id);
        desired_items.push((ShortcutAction::CopyPin, shortcut_text));
    }

    if config.toggle_window_shortcut_enabled {
        let (shortcut_text, parsed) =
            parse_shortcut(&config.toggle_window_shortcut, "toggle_window_shortcut")?;
        let id = parsed.id();
        if let Some(existing) = desired_ids.insert(id, ShortcutAction::ToggleWindow) {
            return Err(format!(
                "Shortcut conflict between {:?} and {:?}: {}",
                existing,
                ShortcutAction::ToggleWindow,
                shortcut_text
            ));
        }
        desired.toggle_window_shortcut = Some(shortcut_text.clone());
        desired.toggle_window_id = Some(id);
        desired_items.push((ShortcutAction::ToggleWindow, shortcut_text));
    }

    let previous = state.snapshot();
    let global_shortcut = app.global_shortcut();

    if let Some(shortcut) = previous.copy_pin_shortcut.as_deref() {
        let _ = global_shortcut.unregister(shortcut);
    }
    if let Some(shortcut) = previous.toggle_window_shortcut.as_deref() {
        let _ = global_shortcut.unregister(shortcut);
    }

    let mut registered_now: Vec<String> = Vec::new();
    for (_, shortcut) in &desired_items {
        if let Err(error) = global_shortcut.register(shortcut.as_str()) {
            for registered in &registered_now {
                let _ = global_shortcut.unregister(registered.as_str());
            }
            if let Some(shortcut) = previous.copy_pin_shortcut.as_deref() {
                let _ = global_shortcut.register(shortcut);
            }
            if let Some(shortcut) = previous.toggle_window_shortcut.as_deref() {
                let _ = global_shortcut.register(shortcut);
            }
            state.replace(previous);
            return Err(format!(
                "Failed to register shortcut '{}': {}. It may be occupied by another app or blocked by the OS. Try a different combination.",
                shortcut, error
            ));
        }
        registered_now.push(shortcut.clone());
    }

    state.replace(desired);
    Ok(())
}

#[cfg(not(desktop))]
pub fn apply_shortcut_config(
    _app: &AppHandle,
    _state: &Arc<ShortcutBindingState>,
    _config: &GeneralConfig,
) -> Result<(), String> {
    Ok(())
}
