use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRelayConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub smtp_host: String,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    #[serde(default = "default_encryption")]
    pub encryption: String, // "none" | "starttls" | "tls"
    #[serde(default = "default_true")]
    pub allow_insecure_certs: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub from_address: String,
    #[serde(default = "default_from_name")]
    pub from_name: String,
    #[serde(default)]
    pub default_recipients: Vec<String>,
    #[serde(default = "default_true")]
    pub send_to_self_by_default: bool,
    #[serde(default = "default_subject_prefix")]
    pub subject_prefix: String,
}

fn default_smtp_port() -> u16 {
    25
}

fn default_encryption() -> String {
    "none".to_string()
}

fn default_from_name() -> String {
    "Qollect".to_string()
}

fn default_true() -> bool {
    true
}

fn default_subject_prefix() -> String {
    "[Qollect] ".to_string()
}

impl Default for EmailRelayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            smtp_host: String::new(),
            smtp_port: 25,
            encryption: "none".to_string(),
            allow_insecure_certs: true,
            username: String::new(),
            password: String::new(),
            from_address: String::new(),
            from_name: "Qollect".to_string(),
            default_recipients: Vec::new(),
            send_to_self_by_default: true,
            subject_prefix: "[Qollect] ".to_string(),
        }
    }
}

impl EmailRelayConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
        if self.smtp_host.trim().is_empty() {
            return Err("SMTP 服务器地址不能为空".into());
        }
        if self.from_address.trim().is_empty() {
            return Err("发件人企业邮箱不能为空".into());
        }
        Ok(())
    }
}
