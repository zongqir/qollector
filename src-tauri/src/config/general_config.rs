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
    /// Enable global show/hide main window shortcut.
    #[serde(default = "default_toggle_window_shortcut_enabled")]
    pub toggle_window_shortcut_enabled: bool,
    /// Global shortcut for show/hide main window.
    #[serde(default = "default_toggle_window_shortcut")]
    pub toggle_window_shortcut: String,
    /// Enable Ctrl/Cmd+T quick-tag shortcut in history/preview UI.
    #[serde(default = "default_history_tag_shortcut_enabled")]
    pub history_tag_shortcut_enabled: bool,
    /// Whether the workbench panel is visible.
    #[serde(
        default = "default_workbench_panel_enabled",
        alias = "collection_panel_enabled"
    )]
    pub workbench_panel_enabled: bool,
    /// Double-click auto-paste: copy and paste to foreground app.
    #[serde(default)]
    pub auto_paste_on_double_click: bool,
    /// Allow copy actions for items captured from Qollect itself.
    #[serde(default = "default_copy_qollect_source_items")]
    pub copy_qollect_source_items: bool,
    /// Enable automatic cleanup of old data.
    #[serde(default = "default_auto_cleanup_enabled")]
    pub auto_cleanup_enabled: bool,
    /// Max number of items to keep (100–999999).
    #[serde(default = "default_cleanup_max_items")]
    pub cleanup_max_items: u32,
    /// Max age in days for items (1–3650).
    #[serde(default = "default_cleanup_max_age_days")]
    pub cleanup_max_age_days: u32,
    /// Whether startup should default to favorites-only history view.
    #[serde(default)]
    pub startup_favorites_view_enabled: bool,
    /// Enable autostart on system boot.
    #[serde(default)]
    pub autostart_enabled: bool,
    /// Enable automatic layout switch by window width.
    #[serde(default = "default_auto_layout_switch_enabled")]
    pub auto_layout_switch_enabled: bool,
    /// Accent color preset name (blue/purple/pink/red/orange/yellow/green/graphite).
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    /// Capture settled text from supported focused input controls on Windows.
    #[serde(default)]
    pub input_capture_enabled: bool,
    /// Enable copy-on-select on Windows.
    #[serde(default)]
    pub copy_on_select_enabled: bool,
    /// Enable copy on double click word selection on Windows.
    #[serde(default = "default_copy_on_select_double_click_enabled")]
    pub copy_on_select_double_click_enabled: bool,
    /// Filter out meaningless micro text (<= 2 routine chars) and noisy isolated verification digits (3-6 digits).
    #[serde(default = "default_filter_noise_digits_enabled")]
    pub filter_noise_digits_enabled: bool,
}

fn default_filter_noise_digits_enabled() -> bool {
    true
}

fn default_copy_on_select_double_click_enabled() -> bool {
    true
}

fn default_accent_color() -> String {
    "blue".to_string()
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_theme_mode() -> String {
    "system".to_string()
}

fn default_toggle_window_shortcut_enabled() -> bool {
    true
}

fn default_toggle_window_shortcut() -> String {
    "alt+x".to_string()
}

fn default_history_tag_shortcut_enabled() -> bool {
    true
}

fn default_workbench_panel_enabled() -> bool {
    true
}

fn default_auto_cleanup_enabled() -> bool {
    true
}

fn default_copy_qollect_source_items() -> bool {
    false
}

fn default_cleanup_max_items() -> u32 {
    50000
}

fn default_cleanup_max_age_days() -> u32 {
    90
}

fn default_auto_layout_switch_enabled() -> bool {
    true
}

fn default_autostart_enabled() -> bool {
    true
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            max_pinned_items: 10,
            language: "zh-CN".to_string(),
            theme_mode: "system".to_string(),
            lock_password_hash: None,
            toggle_window_shortcut_enabled: true,
            toggle_window_shortcut: default_toggle_window_shortcut(),
            history_tag_shortcut_enabled: default_history_tag_shortcut_enabled(),
            workbench_panel_enabled: true,
            auto_paste_on_double_click: false,
            copy_qollect_source_items: default_copy_qollect_source_items(),
            auto_cleanup_enabled: true,
            cleanup_max_items: 50000,
            cleanup_max_age_days: 90,
            startup_favorites_view_enabled: false,
            autostart_enabled: default_autostart_enabled(),
            auto_layout_switch_enabled: default_auto_layout_switch_enabled(),
            accent_color: default_accent_color(),
            input_capture_enabled: false,
            copy_on_select_enabled: false,
            copy_on_select_double_click_enabled: default_copy_on_select_double_click_enabled(),
            filter_noise_digits_enabled: default_filter_noise_digits_enabled(),
        }
    }
}

impl GeneralConfig {
    /// 验证并修正配置值
    pub fn validate(&mut self) {
        if self.max_pinned_items > 100 {
            self.max_pinned_items = 100;
        }
        if self.max_pinned_items < 1 {
            self.max_pinned_items = 1;
        }
        // 验证主题模式
        if !["light", "dark", "system"].contains(&self.theme_mode.as_str()) {
            self.theme_mode = "system".to_string();
        }
        self.toggle_window_shortcut = self.toggle_window_shortcut.trim().to_ascii_lowercase();
        if self.toggle_window_shortcut.is_empty() {
            self.toggle_window_shortcut = default_toggle_window_shortcut();
        }
        self.cleanup_max_items = self.cleanup_max_items.clamp(100, 999999);
        self.cleanup_max_age_days = self.cleanup_max_age_days.clamp(1, 3650);
        // validate accent color
        if ![
            "blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite",
        ]
        .contains(&self.accent_color.as_str())
        {
            self.accent_color = default_accent_color();
        }
    }
}
