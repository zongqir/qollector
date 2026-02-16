use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    /// 最大置顶数量（默认3，最大10）
    pub max_pinned_items: usize,
    /// 界面语言（zh-CN 或 en-US）
    #[serde(default = "default_language")]
    pub language: String,
    /// 主题模式（light / dark / system）
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    /// 锁屏密码哈希（None 表示未设置密码）
    #[serde(default)]
    pub lock_password_hash: Option<String>,
    /// Enable double-copy emphasis pin behavior.
    #[serde(default = "default_double_copy_emphasis_enabled")]
    pub double_copy_emphasis_enabled: bool,
    /// Max interval for two consecutive copies to be treated as emphasis.
    #[serde(default = "default_double_copy_window_ms")]
    pub double_copy_window_ms: u64,
    /// Enable global Ctrl+Shift+C one-shot copy and pin shortcut.
    #[serde(default = "default_ctrl_shift_c_shortcut_enabled")]
    pub ctrl_shift_c_shortcut_enabled: bool,
    /// Global shortcut for one-shot copy and pin.
    #[serde(default = "default_copy_pin_shortcut")]
    pub copy_pin_shortcut: String,
    /// Enable global show/hide main window shortcut.
    #[serde(default = "default_toggle_window_shortcut_enabled")]
    pub toggle_window_shortcut_enabled: bool,
    /// Global shortcut for show/hide main window.
    #[serde(default = "default_toggle_window_shortcut")]
    pub toggle_window_shortcut: String,
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_theme_mode() -> String {
    "system".to_string()
}

fn default_double_copy_emphasis_enabled() -> bool {
    true
}

fn default_double_copy_window_ms() -> u64 {
    900
}

fn default_ctrl_shift_c_shortcut_enabled() -> bool {
    false
}

fn default_copy_pin_shortcut() -> String {
    "ctrl+shift+c".to_string()
}

fn default_toggle_window_shortcut_enabled() -> bool {
    true
}

fn default_toggle_window_shortcut() -> String {
    "alt+x".to_string()
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            max_pinned_items: 3,
            language: "zh-CN".to_string(),
            theme_mode: "system".to_string(),
            lock_password_hash: None,
            double_copy_emphasis_enabled: true,
            double_copy_window_ms: 900,
            ctrl_shift_c_shortcut_enabled: false,
            copy_pin_shortcut: default_copy_pin_shortcut(),
            toggle_window_shortcut_enabled: true,
            toggle_window_shortcut: default_toggle_window_shortcut(),
        }
    }
}

impl GeneralConfig {
    /// 验证并修正配置值
    pub fn validate(&mut self) {
        if self.max_pinned_items > 10 {
            self.max_pinned_items = 10;
        }
        if self.max_pinned_items < 1 {
            self.max_pinned_items = 1;
        }
        // 验证主题模式
        if !["light", "dark", "system"].contains(&self.theme_mode.as_str()) {
            self.theme_mode = "system".to_string();
        }
        if self.double_copy_window_ms < 300 {
            self.double_copy_window_ms = 300;
        }
        if self.double_copy_window_ms > 2500 {
            self.double_copy_window_ms = 2500;
        }
        self.copy_pin_shortcut = self.copy_pin_shortcut.trim().to_ascii_lowercase();
        if self.copy_pin_shortcut.is_empty() {
            self.copy_pin_shortcut = default_copy_pin_shortcut();
        }
        self.toggle_window_shortcut = self.toggle_window_shortcut.trim().to_ascii_lowercase();
        if self.toggle_window_shortcut.is_empty() {
            self.toggle_window_shortcut = default_toggle_window_shortcut();
        }
    }
}
