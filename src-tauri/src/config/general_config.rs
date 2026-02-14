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
}

fn default_language() -> String {
    "zh-CN".to_string()
}

fn default_theme_mode() -> String {
    "system".to_string()
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            max_pinned_items: 3,
            language: "zh-CN".to_string(),
            theme_mode: "system".to_string(),
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
    }
}
