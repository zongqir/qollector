use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareConfig {
    pub provider: ShareProvider,
    pub s3_config: Option<S3Config>,
    #[serde(default = "default_force_upload_non_ascii_text")]
    pub force_upload_non_ascii_text: bool,
}

impl Default for ShareConfig {
    fn default() -> Self {
        Self {
            provider: ShareProvider::ZeroX0,
            s3_config: None,
            force_upload_non_ascii_text: default_force_upload_non_ascii_text(),
        }
    }
}

fn default_force_upload_non_ascii_text() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ShareProvider {
    #[serde(alias = "FileIo")]
    ZeroX0,
    Tmpfiles,
    Catbox,
    Litterbox,
    S3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Config {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub custom_domain: Option<String>,
}

impl S3Config {
    pub fn validate(&self) -> Result<(), String> {
        if self.endpoint.trim().is_empty() {
            return Err("Endpoint is required".into());
        }
        if self.region.trim().is_empty() {
            return Err("Region is required".into());
        }
        if self.bucket.trim().is_empty() {
            return Err("Bucket is required".into());
        }
        if self.access_key.trim().is_empty() {
            return Err("Access Key is required".into());
        }
        if self.secret_key.trim().is_empty() {
            return Err("Secret Key is required".into());
        }
        Ok(())
    }
}
