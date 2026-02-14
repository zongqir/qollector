use sqlx::SqlitePool;
use crate::ai::AIConfig;
use crate::ocr::OcrConfig;
use crate::mcp::McpConfig;
use crate::config::GeneralConfig;

/// 配置仓库，负责持久化应用配置
pub struct ConfigRepository {
    pool: SqlitePool,
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
            "#
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 保存 AI 配置
    pub async fn save_ai_config(&self, config: &AIConfig) -> Result<(), sqlx::Error> {
        let value = serde_json::to_string(config)
            .map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('ai_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#
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
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM app_config WHERE key = 'ai_config'"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((value,)) = row {
            // 使用迁移逻辑加载配置
            match AIConfig::from_legacy(&value) {
                Ok(config) => {
                    // 如果是从旧格式迁移的，保存新格式
                    if let Ok(new_json) = serde_json::to_string(&config) {
                        if new_json != value {
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
        let value = serde_json::to_string(config)
            .map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('ocr_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#
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
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM app_config WHERE key = 'ocr_config'"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((value,)) = row {
            // 使用迁移逻辑加载配置
            match OcrConfig::from_legacy(&value) {
                Ok(config) => {
                    // 如果是从旧格式迁移的，保存新格式
                    if let Ok(new_json) = serde_json::to_string(&config) {
                        if new_json != value {
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
        let value = serde_json::to_string(config)
            .map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('mcp_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#
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
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM app_config WHERE key = 'mcp_config'"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((value,)) = row {
            let config: McpConfig = serde_json::from_str(&value)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    /// 保存通用配置
    pub async fn save_general_config(&self, config: &GeneralConfig) -> Result<(), sqlx::Error> {
        let value = serde_json::to_string(config)
            .map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
        let now = chrono::Utc::now().timestamp();

        sqlx::query(
            r#"
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('general_config', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            "#
        )
        .bind(&value)
        .bind(now)
        .bind(&value)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 加载通用配置
    pub async fn load_general_config(&self) -> Result<Option<GeneralConfig>, sqlx::Error> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT value FROM app_config WHERE key = 'general_config'"
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((value,)) = row {
            let mut config: GeneralConfig = serde_json::from_str(&value)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
            config.validate();
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }
}
