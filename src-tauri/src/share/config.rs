use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareConfig {
    pub provider: ShareProvider,
    pub s3_config: Option<S3Config>,
}

impl Default for ShareConfig {
    fn default() -> Self {
        Self {
            provider: ShareProvider::FileIo,
            s3_config: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ShareProvider {
    FileIo,
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
