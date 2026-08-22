use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectorConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub token: String,
}

impl Default for CollectorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: String::new(),
            token: String::new(),
        }
    }
}

impl CollectorConfig {
    pub fn validate(&mut self) {
        self.endpoint = self.endpoint.trim().trim_end_matches('/').to_string();
        self.token = self.token.trim().to_string();
        if self.endpoint.len() > 2048 {
            self.endpoint.truncate(2048);
        }
        if self.token.len() > 4096 {
            self.token.truncate(4096);
        }
    }
}
