use crate::core::models::{ClipboardItem, SearchFilters};
use crate::core::tokenizer;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::collections::HashSet;
use std::path::PathBuf;

/// Lightweight struct returned by cleanup queries.
pub struct CleanupTarget {
    pub id: String,
    pub type_: String,
    pub image_paths: Option<String>,
}

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
                pinned_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // migration: add pinned_at column
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN pinned_at INTEGER")
            .execute(&self.pool)
            .await;

        // migration: add code_language column
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN code_language TEXT")
            .execute(&self.pool)
            .await;

        // 优化索引：添加复合索引提升查询性能
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_items(content_hash)")
            .execute(&self.pool)
            .await?;

        // 复合索引：is_deleted + updated_at（覆盖最常用的查询）
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_recent_query ON clipboard_items(is_deleted, updated_at DESC)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_type ON clipboard_items(type)")
            .execute(&self.pool)
            .await?;

        // 添加 is_pinned 索引用于快速过滤
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_is_pinned ON clipboard_items(is_pinned)")
            .execute(&self.pool)
            .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_code_language ON clipboard_items(code_language)")
            .execute(&self.pool)
            .await?;

        // Raw clipboard formats table (HTML, RTF, etc.)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS clipboard_raw_formats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                data BLOB NOT NULL,
                created_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_raw_formats_item_id ON clipboard_raw_formats(item_id)")
            .execute(&self.pool)
            .await?;

        // FTS5 virtual table for full-text search
        sqlx::query(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_fts USING fts5(
                item_id UNINDEXED,
                content_tokens,
                ocr_tokens,
                note_tokens
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Migrate existing data into FTS table if empty
        self.migrate_fts_data().await?;

        Ok(())
    }

    pub async fn insert(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO clipboard_items (
                id, type, content, original_content, content_hash,
                image_paths, ocr_text, code_language, embedding, tags, user_note,
                metadata, is_pinned, is_favorite, is_deleted,
                pinned_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&item.id)
        .bind(&item.type_)
        .bind(&item.content)
        .bind(&item.original_content)
        .bind(&item.content_hash)
        .bind(&item.image_paths)
        .bind(&item.ocr_text)
        .bind(&item.code_language)
        .bind(&item.embedding)
        .bind(&item.tags)
        .bind(&item.user_note)
        .bind(&item.metadata)
        .bind(item.is_pinned)
        .bind(item.is_favorite)
        .bind(item.is_deleted)
        .bind(item.pinned_at)
        .bind(item.created_at)
        .bind(item.updated_at)
        .execute(&self.pool)
        .await?;

        self.insert_fts(item).await;

        Ok(())
    }

    pub async fn find_by_hash(&self, hash: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let item = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE content_hash = ? AND is_deleted = 0 LIMIT 1",
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?;

        Ok(item)
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// 轻量查询：排除 embedding 和 original_content 大字段
    pub async fn get_recent_light(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT id, type, content, '' as original_content, content_hash,
                    image_paths, ocr_text, code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats
             FROM clipboard_items WHERE is_deleted = 0
             ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// paged query (for loadMore)
    pub async fn get_recent_paged(
        &self,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT id, type, content, '' as original_content, content_hash,
                    image_paths, ocr_text, code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats
             FROM clipboard_items WHERE is_deleted = 0
             ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    pub async fn search(
        &self,
        query: &str,
        filters: &SearchFilters,
        limit: i32,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        if limit <= 0 {
            return Ok(vec![]);
        }

        // When there's a query, merge FTS and tag LIKE results first.
        if !query.is_empty() {
            let mut merged_items: Vec<ClipboardItem> = Vec::new();
            let mut seen_ids: HashSet<String> = HashSet::new();

            match self.search_fts(query, filters, limit).await {
                Ok(results) => {
                    for item in results {
                        if seen_ids.insert(item.id.clone()) {
                            merged_items.push(item);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[FTS] search failed, continue with tags/fallback: {}", e);
                }
            }

            // If FTS already filled the requested quota, skip extra recall query.
            if merged_items.len() >= limit as usize {
                merged_items.truncate(limit as usize);
                return Ok(merged_items);
            }

            let tag_results = self.search_tags_like(query, filters, limit).await?;
            for item in tag_results {
                if seen_ids.insert(item.id.clone()) {
                    merged_items.push(item);
                }
            }

            if !merged_items.is_empty() {
                // Keep FTS matches first; tag LIKE matches are supplemental recall.
                merged_items.truncate(limit as usize);
                return Ok(merged_items);
            }
        }

        // Fallback: LIKE-based search over the lightweight projection.
        let mut sql = String::from(
            "SELECT id, type, content, '' as original_content, content_hash,
                    image_paths, ocr_text, code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats
             FROM clipboard_items WHERE is_deleted = 0",
        );

        if let Some(type_filter) = &filters.type_filter {
            sql.push_str(&format!(" AND type = '{}'", type_filter));
        }

        if let Some(is_pinned) = filters.is_pinned {
            sql.push_str(&format!(
                " AND is_pinned = {}",
                if is_pinned { 1 } else { 0 }
            ));
        }

        if let Some(is_favorite) = filters.is_favorite {
            sql.push_str(&format!(
                " AND is_favorite = {}",
                if is_favorite { 1 } else { 0 }
            ));
        }

        if !query.is_empty() {
            let escaped_query = query.replace('\'', "''");
            sql.push_str(&format!(
                " AND (content LIKE '%{}%' OR ocr_text LIKE '%{}%')",
                escaped_query, escaped_query
            ));
        }

        sql.push_str(&format!(" ORDER BY updated_at DESC LIMIT {}", limit));

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    async fn search_tags_like(
        &self,
        query: &str,
        filters: &SearchFilters,
        limit: i32,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        if query.is_empty() || limit <= 0 {
            return Ok(vec![]);
        }

        // Tag search should be case-insensitive for mixed upper/lower tag text.
        let escaped_query = query.to_lowercase().replace('\'', "''");
        let mut sql = String::from(
            "SELECT id, type, content, '' as original_content, content_hash,
                    image_paths, ocr_text, code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats
             FROM clipboard_items WHERE is_deleted = 0 AND tags IS NOT NULL",
        );

        if let Some(type_filter) = &filters.type_filter {
            sql.push_str(&format!(" AND type = '{}'", type_filter));
        }

        if let Some(is_pinned) = filters.is_pinned {
            sql.push_str(&format!(
                " AND is_pinned = {}",
                if is_pinned { 1 } else { 0 }
            ));
        }

        if let Some(is_favorite) = filters.is_favorite {
            sql.push_str(&format!(
                " AND is_favorite = {}",
                if is_favorite { 1 } else { 0 }
            ));
        }

        sql.push_str(&format!(" AND LOWER(tags) LIKE '%{}%'", escaped_query));
        sql.push_str(&format!(" ORDER BY updated_at DESC LIMIT {}", limit));

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    pub async fn update(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                content = ?, tags = ?, user_note = ?, code_language = ?,
                is_pinned = ?, is_favorite = ?, pinned_at = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(&item.content)
        .bind(&item.tags)
        .bind(&item.user_note)
        .bind(&item.code_language)
        .bind(item.is_pinned)
        .bind(item.is_favorite)
        .bind(item.pinned_at)
        .bind(item.updated_at)
        .bind(&item.id)
        .execute(&self.pool)
        .await?;

        self.update_fts(item).await;

        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE clipboard_items SET is_deleted = 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.delete_fts(id).await;

        Ok(())
    }

    pub async fn update_ocr_text(&self, id: &str, ocr_text: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                ocr_text = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(ocr_text)
        .bind(chrono::Utc::now().timestamp())
        .bind(id)
        .execute(&self.pool)
        .await?;

        // Re-index FTS for this item
        if let Ok(Some(item)) = self.find_by_id(id).await {
            self.update_fts(&item).await;
        }

        Ok(())
    }

    pub async fn update_metadata_only(&self, id: &str, metadata: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                metadata = ?
            WHERE id = ?
            "#,
        )
        .bind(metadata)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_code_language(&self, id: &str, code_language: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                code_language = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(code_language)
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
            "SELECT * FROM clipboard_items WHERE id = ? AND is_deleted = 0 LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(item)
    }

    /// 获取所有置顶项,按置顶时间排序(最早的在前)
    pub async fn get_pinned_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 AND is_pinned = 1 ORDER BY pinned_at ASC"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// 取消指定项的置顶状态
    pub async fn unpin(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE clipboard_items SET is_pinned = 0, pinned_at = NULL WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), sqlx::Error> {
        let pinned_at = if pinned {
            Some(chrono::Utc::now().timestamp())
        } else {
            None
        };
        sqlx::query("UPDATE clipboard_items SET is_pinned = ?, pinned_at = ? WHERE id = ?")
            .bind(pinned as i32)
            .bind(pinned_at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ========== Raw Formats CRUD ==========

    /// Insert raw clipboard format data (zstd-compressed) for an item.
    pub async fn insert_raw_formats(
        &self,
        item_id: &str,
        formats: &[(String, Vec<u8>)],
    ) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        for (mime_type, data) in formats {
            let compressed = zstd::encode_all(data.as_slice(), 3).unwrap_or_else(|_| data.clone());
            sqlx::query(
                "INSERT INTO clipboard_raw_formats (item_id, mime_type, data, created_at) VALUES (?, ?, ?, ?)",
            )
            .bind(item_id)
            .bind(mime_type)
            .bind(&compressed)
            .bind(now)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    /// Get raw clipboard format data for an item (zstd-decompressed).
    pub async fn get_raw_formats(
        &self,
        item_id: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, sqlx::Error> {
        let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
            "SELECT mime_type, data FROM clipboard_raw_formats WHERE item_id = ?",
        )
        .bind(item_id)
        .fetch_all(&self.pool)
        .await?;

        let mut results = Vec::new();
        for (mime_type, compressed) in rows {
            match zstd::decode_all(compressed.as_slice()) {
                Ok(decompressed) => results.push((mime_type, decompressed)),
                Err(_) => {
                    // Fallback: treat as uncompressed (migration safety)
                    results.push((mime_type, compressed));
                }
            }
        }
        Ok(results)
    }

    /// Delete all raw format data for an item.
    pub async fn delete_raw_formats(&self, item_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM clipboard_raw_formats WHERE item_id = ?")
            .bind(item_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Delete all raw format data (for clear_all_items).
    pub async fn delete_all_raw_formats(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM clipboard_raw_formats")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ========== FTS5 Full-Text Search ==========

    /// FTS index version — bump this when tokenizer logic changes to trigger rebuild.
    const FTS_VERSION: i64 = 2;

    async fn migrate_fts_data(&self) -> Result<(), sqlx::Error> {
        // Track FTS index version in app_config-style pragma
        let _ = sqlx::query(
            "CREATE TABLE IF NOT EXISTS _fts_meta (key TEXT PRIMARY KEY, value INTEGER)",
        )
        .execute(&self.pool)
        .await;

        let stored_version: Option<(i64,)> =
            sqlx::query_as("SELECT value FROM _fts_meta WHERE key = 'fts_version'")
                .fetch_optional(&self.pool)
                .await?;

        let need_rebuild = match stored_version {
            Some((v,)) if v >= Self::FTS_VERSION => false,
            _ => true,
        };

        if !need_rebuild {
            return Ok(());
        }

        // Clear stale index
        sqlx::query("DELETE FROM clipboard_fts")
            .execute(&self.pool)
            .await?;

        let item_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0")
                .fetch_one(&self.pool)
                .await?;

        if item_count.0 > 0 {
            println!(
                "[FTS] Building index v{} for {} items...",
                Self::FTS_VERSION,
                item_count.0
            );

            let items = sqlx::query_as::<_, ClipboardItem>(
                "SELECT * FROM clipboard_items WHERE is_deleted = 0",
            )
            .fetch_all(&self.pool)
            .await?;

            for item in &items {
                self.insert_fts(item).await;
            }

            println!("[FTS] Index build complete: {} items", items.len());
        }

        // Store version
        sqlx::query(
            "INSERT OR REPLACE INTO _fts_meta (key, value) VALUES ('fts_version', ?)",
        )
        .bind(Self::FTS_VERSION)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn insert_fts(&self, item: &ClipboardItem) {
        let content_tokens = tokenizer::tokenize(item.content.as_deref().unwrap_or(""));
        let ocr_tokens = tokenizer::tokenize(item.ocr_text.as_deref().unwrap_or(""));
        let note_tokens = tokenizer::tokenize(item.user_note.as_deref().unwrap_or(""));

        if let Err(e) = sqlx::query(
            "INSERT INTO clipboard_fts (item_id, content_tokens, ocr_tokens, note_tokens) VALUES (?, ?, ?, ?)",
        )
        .bind(&item.id)
        .bind(&content_tokens)
        .bind(&ocr_tokens)
        .bind(&note_tokens)
        .execute(&self.pool)
        .await
        {
            eprintln!("[FTS] insert failed for {}: {}", item.id, e);
        }
    }

    async fn delete_fts(&self, id: &str) {
        if let Err(e) =
            sqlx::query("DELETE FROM clipboard_fts WHERE item_id = ?")
                .bind(id)
                .execute(&self.pool)
                .await
        {
            eprintln!("[FTS] delete failed for {}: {}", id, e);
        }
    }

    async fn update_fts(&self, item: &ClipboardItem) {
        self.delete_fts(&item.id).await;
        self.insert_fts(item).await;
    }

    async fn search_fts(
        &self,
        query: &str,
        filters: &SearchFilters,
        limit: i32,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let match_expr = tokenizer::tokenize_for_query(query);
        if match_expr.is_empty() {
            return Ok(vec![]);
        }

        // Build filter conditions for the main table
        let mut filter_sql = String::new();
        if let Some(type_filter) = &filters.type_filter {
            filter_sql.push_str(&format!(" AND ci.type = '{}'", type_filter));
        }
        if let Some(is_pinned) = filters.is_pinned {
            filter_sql.push_str(&format!(
                " AND ci.is_pinned = {}",
                if is_pinned { 1 } else { 0 }
            ));
        }
        if let Some(is_favorite) = filters.is_favorite {
            filter_sql.push_str(&format!(
                " AND ci.is_favorite = {}",
                if is_favorite { 1 } else { 0 }
            ));
        }

        let sql = format!(
            r#"SELECT ci.id, ci.type, ci.content, '' as original_content, ci.content_hash,
                      ci.image_paths, ci.ocr_text, ci.code_language, NULL as embedding, ci.tags, ci.user_note,
                      ci.metadata, ci.is_pinned, ci.is_favorite, ci.is_deleted,
                      ci.pinned_at, ci.created_at, ci.updated_at,
                      EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = ci.id) as has_raw_formats
               FROM clipboard_items ci
               INNER JOIN clipboard_fts fts ON ci.id = fts.item_id
               WHERE ci.is_deleted = 0
               AND clipboard_fts MATCH ?
               {}
               ORDER BY ci.updated_at DESC
               LIMIT ?"#,
            filter_sql
        );

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .bind(&match_expr)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    // ========== Timeline Query ==========

    /// Get items by date range (for timeline mode)
    pub async fn get_items_by_date_range(
        &self,
        start: i64,
        end: i64,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT id, type, content, '' as original_content, content_hash,
                    image_paths, ocr_text, code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats
             FROM clipboard_items WHERE is_deleted = 0
             AND updated_at >= ? AND updated_at < ?
             ORDER BY updated_at ASC",
        )
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    // ========== Auto Cleanup ==========

    /// Find and hard-delete expired items. Returns targets for file cleanup.
    pub async fn cleanup_expired_items(
        &self,
        max_items: u32,
        max_age_days: u32,
    ) -> Result<Vec<CleanupTarget>, sqlx::Error> {
        let age_cutoff = chrono::Utc::now().timestamp() - (max_age_days as i64) * 86400;

        // Count non-protected items
        let (total_unprotected,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0 AND is_pinned = 0 AND is_favorite = 0",
        )
        .fetch_one(&self.pool)
        .await?;

        let excess = if total_unprotected > max_items as i64 {
            total_unprotected - max_items as i64
        } else {
            0
        };

        // Select candidates: aged out OR excess (oldest first)
        let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
            r#"SELECT id, type, image_paths FROM clipboard_items
               WHERE is_deleted = 0 AND is_pinned = 0 AND is_favorite = 0
               AND (created_at < ? OR id IN (
                   SELECT id FROM clipboard_items
                   WHERE is_deleted = 0 AND is_pinned = 0 AND is_favorite = 0
                   ORDER BY created_at ASC
                   LIMIT ?
               ))
               ORDER BY created_at ASC"#,
        )
        .bind(age_cutoff)
        .bind(excess)
        .fetch_all(&self.pool)
        .await?;

        if rows.is_empty() {
            return Ok(vec![]);
        }

        let targets: Vec<CleanupTarget> = rows
            .iter()
            .map(|(id, type_, image_paths)| CleanupTarget {
                id: id.clone(),
                type_: type_.clone(),
                image_paths: image_paths.clone(),
            })
            .collect();

        // Hard delete in batches
        for target in &targets {
            // Delete FTS entry
            self.delete_fts(&target.id).await;
            // Delete raw formats
            let _ = sqlx::query("DELETE FROM clipboard_raw_formats WHERE item_id = ?")
                .bind(&target.id)
                .execute(&self.pool)
                .await;
            // Hard delete the item row
            let _ = sqlx::query("DELETE FROM clipboard_items WHERE id = ?")
                .bind(&target.id)
                .execute(&self.pool)
                .await;
        }

        Ok(targets)
    }
}
