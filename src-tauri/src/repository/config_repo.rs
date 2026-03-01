use crate::ai::AIConfig;
use crate::config::GeneralConfig;
use crate::config::secure_store::{seal_json, unseal_json};
use crate::lan_sync::LanSyncConfig;
use crate::license::config::LicenseConfig;
use crate::mcp::McpConfig;
use crate::ocr::OcrConfig;
use crate::share::ShareConfig;
use serde::Serialize;
use sqlx::SqlitePool;

/// 配置仓库，负责持久化应用配置
pub struct ConfigRepository {
    pool: SqlitePool,
}

fn decode_storage_error(message: String) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    )))
}

fn encode_storage_error(message: String) -> sqlx::Error {
    sqlx::Error::Encode(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message,
    )))
}

fn decode_config_value(value: &str, sensitive: bool) -> Result<String, sqlx::Error> {
    if !sensitive {
        return Ok(value.to_string());
    }
    match unseal_json(value).map_err(decode_storage_error)? {
        Some(plain) => Ok(plain),
        None => Ok(value.to_string()),
    }
}

fn encode_config_value<T: Serialize>(config: &T, sensitive: bool) -> Result<String, sqlx::Error> {
    let plain = serde_json::to_string(config).map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
    if !sensitive {
        return Ok(plain);
    }
    seal_json(&plain).map_err(encode_storage_error)
}

impl ConfigRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 初始化配置表
    pub async fn init_table(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 保存 AI 配置
    pub async fn save_ai_config(&self, config: &AIConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, true)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('ai_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 加载 AI 配置
    pub async fn load_ai_config(&self) -> Result<Option<AIConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'ai_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, true)?;
            // 使用迁移逻辑加载配置
            match AIConfig::from_legacy(&decoded_value) {
                Ok(config) => {
                    // 如果是从旧格式迁移的，保存新格式
                    if let Ok(new_json) = serde_json::to_string(&config) {
                        if new_json != decoded_value {
                            println!("迁移 AI 配置到新格式");
                            let _ = self.save_ai_config(&config).await;
                        }
                    }
                    Ok(Some(config))
                }
                Err(e) => {
                    eprintln!("解析 AI 配置失败: {}", e);
                    Ok(None)
                }
            }
        } else {
            Ok(None)
        }
    }

    /// 保存 OCR 配置
    pub async fn save_ocr_config(&self, config: &OcrConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, true)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('ocr_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 加载 OCR 配置
    pub async fn load_ocr_config(&self) -> Result<Option<OcrConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'ocr_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, true)?;
            // 使用迁移逻辑加载配置
            match OcrConfig::from_legacy(&decoded_value) {
                Ok(config) => {
                    // 如果是从旧格式迁移的，保存新格式
                    if let Ok(new_json) = serde_json::to_string(&config) {
                        if new_json != decoded_value {
                            println!("迁移 OCR 配置到新格式");
                            let _ = self.save_ocr_config(&config).await;
                        }
                    }
                    Ok(Some(config))
                }
                Err(e) => {
                    eprintln!("解析 OCR 配置失败: {}", e);
                    Ok(None)
                }
            }
        } else {
            Ok(None)
        }
    }

    /// 保存 MCP 配置
    pub async fn save_mcp_config(&self, config: &McpConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, false)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('mcp_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 加载 MCP 配置
    pub async fn load_mcp_config(&self) -> Result<Option<McpConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'mcp_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, false)?;
            let config: McpConfig =
                serde_json::from_str(&decoded_value).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// 保存通用配置
    pub async fn save_general_config(&self, config: &GeneralConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, false)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('general_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Load general config
    pub async fn load_general_config(&self) -> Result<Option<GeneralConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'general_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, false)?;
            let mut config: GeneralConfig =
                serde_json::from_str(&decoded_value).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            config.validate();
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Save share config
    pub async fn save_share_config(&self, config: &ShareConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, true)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('share_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Load share config
    pub async fn load_share_config(&self) -> Result<Option<ShareConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'share_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, true)?;
            let config: ShareConfig =
                serde_json::from_str(&decoded_value).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Save LAN sync config
    pub async fn save_lan_sync_config(&self, config: &LanSyncConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, false)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('lan_sync_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Load LAN sync config
    pub async fn load_lan_sync_config(&self) -> Result<Option<LanSyncConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'lan_sync_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, false)?;
            let config: LanSyncConfig =
                serde_json::from_str(&decoded_value).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// Save license config
    pub async fn save_license_config(&self, config: &LicenseConfig) -> Result<(), sqlx::Error> {
        let value = encode_config_value(config, true)?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('license_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#,
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Load license config
    pub async fn load_license_config(&self) -> Result<Option<LicenseConfig>, sqlx::Error> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM app_config WHERE key = 'license_config'")
                .fetch_optional(&self.pool)
                .await?;

        if let Some((value,)) = row {
            let decoded_value = decode_config_value(&value, true)?;
            let config: LicenseConfig =
                serde_json::from_str(&decoded_value).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }
}
