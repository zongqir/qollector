use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
use crate::core::models::{ClipboardItem, SearchFilters};
use std::path::PathBuf;

pub struct ClipboardRepository {
    pool: SqlitePool,
}

impl ClipboardRepository {
    /// 获取数据库连接池的引用
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

impl ClipboardRepository {
    pub async fn new(db_path: PathBuf) -> Result<Self, sqlx::Error> {
        let db_url = format!("sqlite://{}?mode=rwc", db_path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await?;

        let repo = Self { pool };
        repo.init_database().await?;
        Ok(repo)
    }

    async fn init_database(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS clipboard_items (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                content TEXT,
                original_content TEXT,
                content_hash TEXT NOT NULL,
                image_paths TEXT,
                ocr_text TEXT,
                embedding BLOB,
                tags TEXT,
                user_note TEXT,
                metadata TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            "#
        )
        .execute(&self.pool)
        .await?;

        // 优化索引：添加复合索引提升查询性能
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_items(content_hash)")
            .execute(&self.pool)
            .await?;

        // 复合索引：is_deleted + is_pinned + updated_at（覆盖最常用的查询）
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_recent_query ON clipboard_items(is_deleted, is_pinned DESC, updated_at DESC)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_type ON clipboard_items(type)")
            .execute(&self.pool)
            .await?;

        // 添加 is_pinned 索引用于快速过滤
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_is_pinned ON clipboard_items(is_pinned)")
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn insert(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO clipboard_items (
                id, type, content, original_content, content_hash,
                image_paths, ocr_text, embedding, tags, user_note,
                metadata, is_pinned, is_favorite, is_deleted,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&item.id)
        .bind(&item.type_)
        .bind(&item.content)
        .bind(&item.original_content)
        .bind(&item.content_hash)
        .bind(&item.image_paths)
        .bind(&item.ocr_text)
        .bind(&item.embedding)
        .bind(&item.tags)
        .bind(&item.user_note)
        .bind(&item.metadata)
        .bind(item.is_pinned)
        .bind(item.is_favorite)
        .bind(item.is_deleted)
        .bind(item.created_at)
        .bind(item.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn find_by_hash(&self, hash: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let item = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE content_hash = ? AND is_deleted = 0 LIMIT 1"
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?;

        Ok(item)
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 ORDER BY is_pinned DESC, updated_at DESC LIMIT ?"
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    pub async fn search(&self, query: &str, filters: &SearchFilters, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let mut sql = String::from("SELECT * FROM clipboard_items WHERE is_deleted = 0");

        if let Some(type_filter) = &filters.type_filter {
            sql.push_str(&format!(" AND type = '{}'", type_filter));
        }

        if let Some(is_pinned) = filters.is_pinned {
            sql.push_str(&format!(" AND is_pinned = {}", if is_pinned { 1 } else { 0 }));
        }

        if let Some(is_favorite) = filters.is_favorite {
            sql.push_str(&format!(" AND is_favorite = {}", if is_favorite { 1 } else { 0 }));
        }

        if !query.is_empty() {
            sql.push_str(&format!(" AND (content LIKE '%{}%' OR ocr_text LIKE '%{}%')", query, query));
        }

        sql.push_str(&format!(" ORDER BY is_pinned DESC, updated_at DESC LIMIT {}", limit));

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    pub async fn update(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                content = ?, tags = ?, user_note = ?,
                is_pinned = ?, is_favorite = ?, updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(&item.content)
        .bind(&item.tags)
        .bind(&item.user_note)
        .bind(item.is_pinned)
        .bind(item.is_favorite)
        .bind(item.updated_at)
        .bind(&item.id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE clipboard_items SET is_deleted = 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn update_ocr_text(&self, id: &str, ocr_text: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                ocr_text = ?, updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(ocr_text)
        .bind(chrono::Utc::now().timestamp())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn touch(&self, id: &str) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("UPDATE clipboard_items SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let item = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE id = ? AND is_deleted = 0 LIMIT 1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(item)
    }

    /// 获取所有置顶项,按更新时间排序(最早的在前)
    pub async fn get_pinned_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 AND is_pinned = 1 ORDER BY updated_at ASC"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// 取消指定项的置顶状态
    pub async fn unpin(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE clipboard_items SET is_pinned = 0 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
