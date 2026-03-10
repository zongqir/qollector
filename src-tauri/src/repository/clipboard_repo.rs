use crate::core::models::{
    ClipboardItem, SearchFilters, SyncApplyResult, SyncIncomingSlot, SyncLatestSlot,
};
use crate::core::tokenizer;
use crate::lan_sync::PairedSyncDevice;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::cmp::Ordering;
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

const LIGHT_CONTENT_PREVIEW_CHARS: i32 = 4000;
const LIGHT_OCR_PREVIEW_CHARS: i32 = 3000;
const SYNC_GLOBAL_SLOT_ID: &str = "global";

fn escape_sql_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn normalize_user_tag(raw: &str) -> Option<String> {
    let normalized = raw.trim();
    if normalized.is_empty() || normalized.starts_with("AI:") {
        return None;
    }
    Some(normalized.to_string())
}

fn parse_user_tags(tags_json: Option<&str>) -> HashSet<String> {
    let Some(json) = tags_json else {
        return HashSet::new();
    };

    let parsed: Vec<String> = serde_json::from_str(json).unwrap_or_default();
    parsed
        .into_iter()
        .filter_map(|tag| normalize_user_tag(&tag))
        .collect()
}

fn build_tag_filter_expression(tag_filter: Option<&Vec<String>>, column: &str) -> Option<String> {
    let tags = tag_filter?;
    let expressions: Vec<String> = tags
        .iter()
        .filter_map(|raw| {
            let normalized = raw.trim().to_lowercase();
            if normalized.is_empty() {
                return None;
            }
            let escaped = escape_sql_literal(&normalized);
            Some(format!("LOWER({}) LIKE '%\"{}\"%'", column, escaped))
        })
        .collect();

    if expressions.is_empty() {
        None
    } else {
        Some(expressions.join(" OR "))
    }
}

fn build_source_filter_expression(
    source_filter: Option<&Vec<String>>,
    metadata_column: &str,
) -> Option<String> {
    let sources = source_filter?;
    let expressions: Vec<String> = sources
        .iter()
        .filter_map(|raw| {
            let normalized = raw.trim().to_lowercase();
            if normalized.is_empty() {
                return None;
            }
            let escaped = escape_sql_literal(&normalized);
            Some(format!(
                "LOWER(REPLACE(COALESCE(json_extract({}, '$.source_app'), ''), '.exe', '')) = '{}'",
                metadata_column, escaped
            ))
        })
        .collect();

    if expressions.is_empty() {
        None
    } else {
        Some(expressions.join(" OR "))
    }
}

fn build_type_list_filter_expression(
    type_filter: Option<&Vec<String>>,
    type_column: &str,
) -> Option<String> {
    let types = type_filter?;
    let expressions: Vec<String> = types
        .iter()
        .filter_map(|raw| {
            let normalized = raw.trim().to_lowercase();
            if normalized.is_empty() {
                return None;
            }
            let escaped = escape_sql_literal(&normalized);
            Some(format!("LOWER({}) = '{}'", type_column, escaped))
        })
        .collect();

    if expressions.is_empty() {
        None
    } else {
        Some(expressions.join(" OR "))
    }
}

fn build_selected_tag_clause(
    filters: &SearchFilters,
    tags_column: &str,
    metadata_column: &str,
    type_column: &str,
) -> Option<String> {
    let mut expressions: Vec<String> = Vec::new();

    if let Some(tag_expr) = build_tag_filter_expression(filters.tag_filter.as_ref(), tags_column) {
        expressions.push(format!("({})", tag_expr));
    }
    if let Some(source_expr) =
        build_source_filter_expression(filters.source_filter.as_ref(), metadata_column)
    {
        expressions.push(format!("({})", source_expr));
    }
    if let Some(type_expr) =
        build_type_list_filter_expression(filters.type_tag_filter.as_ref(), type_column)
    {
        expressions.push(format!("({})", type_expr));
    }

    if expressions.is_empty() {
        None
    } else {
        Some(format!(" AND ({})", expressions.join(" OR ")))
    }
}

fn append_common_search_filters(
    sql: &mut String,
    filters: &SearchFilters,
    type_column: &str,
    code_language_column: &str,
    pinned_column: &str,
    favorite_column: &str,
    tags_column: &str,
    metadata_column: &str,
    created_at_column: &str,
) {
    if let Some(type_filter) = &filters.type_filter {
        let escaped = escape_sql_literal(type_filter.trim());
        if !escaped.is_empty() {
            sql.push_str(&format!(" AND {} = '{}'", type_column, escaped));
        }
    }

    if let Some(require_code_language) = filters.require_code_language {
        if require_code_language {
            sql.push_str(&format!(
                " AND {} IS NOT NULL AND TRIM({}) != ''",
                code_language_column, code_language_column
            ));
        }
    }

    if let Some(is_pinned) = filters.is_pinned {
        sql.push_str(&format!(
            " AND {} = {}",
            pinned_column,
            if is_pinned { 1 } else { 0 }
        ));
    }

    if let Some(is_favorite) = filters.is_favorite {
        sql.push_str(&format!(
            " AND {} = {}",
            favorite_column,
            if is_favorite { 1 } else { 0 }
        ));
    }

    if let Some(selected_tag_clause) =
        build_selected_tag_clause(filters, tags_column, metadata_column, type_column)
    {
        sql.push_str(&selected_tag_clause);
    }

    if let Some(date_range) = &filters.date_range {
        sql.push_str(&format!(" AND {} >= {}", created_at_column, date_range.start));
        sql.push_str(&format!(" AND {} <= {}", created_at_column, date_range.end));
    }
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

        // Performance & stability PRAGMAs
        sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await?;
        sqlx::query("PRAGMA busy_timeout=5000").execute(&pool).await?;
        sqlx::query("PRAGMA synchronous=NORMAL").execute(&pool).await?;
        sqlx::query("PRAGMA cache_size=-8000").execute(&pool).await?;
        sqlx::query("PRAGMA foreign_keys=ON").execute(&pool).await?;

        let repo = Self { pool };
        repo.init_database().await?;
        Ok(repo)
    }

    /// Current schema version. Bump this when adding new migrations.
    const CURRENT_SCHEMA_VERSION: i64 = 6;

    async fn init_database(&self) -> Result<(), sqlx::Error> {
        // Schema version table (always created first)
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL,
                applied_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        let db_version = self.get_schema_version().await?;
        println!("[Schema] current version: {}, code version: {}", db_version, Self::CURRENT_SCHEMA_VERSION);

        if db_version > Self::CURRENT_SCHEMA_VERSION {
            println!(
                "[Schema] WARNING: database version ({}) is newer than code version ({}). Possible downgrade install. Skipping migrations.",
                db_version, Self::CURRENT_SCHEMA_VERSION
            );
            return Ok(());
        }

        if db_version < 1 {
            self.migrate_v0_to_v1().await?;
            self.set_schema_version(1).await?;
            println!("[Schema] migrated to version 1");
        }
        if db_version < 2 {
            self.migrate_v1_to_v2().await?;
            self.set_schema_version(2).await?;
            println!("[Schema] migrated to version 2");
        }
        if db_version < 3 {
            self.migrate_v2_to_v3().await?;
            self.set_schema_version(3).await?;
            println!("[Schema] migrated to version 3");
        }
        if db_version < 4 {
            self.migrate_v3_to_v4().await?;
            self.set_schema_version(4).await?;
            println!("[Schema] migrated to version 4");
        }
        if db_version < 5 {
            self.migrate_v4_to_v5().await?;
            self.set_schema_version(5).await?;
            println!("[Schema] migrated to version 5");
        }
        if db_version < 6 {
            self.migrate_v5_to_v6().await?;
            self.set_schema_version(6).await?;
            println!("[Schema] migrated to version 6");
        }

        Ok(())
    }

    async fn get_schema_version(&self) -> Result<i64, sqlx::Error> {
        let row: Option<(i64,)> =
            sqlx::query_as("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(v,)| v).unwrap_or(0))
    }

    async fn set_schema_version(&self, version: i64) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        sqlx::query("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(version)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// V0 -> V1: Initial tables, indexes, raw formats, sync tables
    async fn migrate_v0_to_v1(&self) -> Result<(), sqlx::Error> {
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

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_items(content_hash)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_recent_query ON clipboard_items(is_deleted, updated_at DESC)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_type ON clipboard_items(type)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_is_pinned ON clipboard_items(is_pinned)")
            .execute(&self.pool)
            .await?;

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
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_raw_formats_item_id ON clipboard_raw_formats(item_id)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_paired_devices (
                device_id TEXT PRIMARY KEY,
                device_name TEXT NOT NULL,
                pair_token TEXT NOT NULL,
                last_host TEXT,
                last_port INTEGER,
                created_at_ms INTEGER NOT NULL,
                last_seen_ms INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_sync_paired_last_seen ON sync_paired_devices(last_seen_ms DESC)",
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_latest_slot (
                slot_id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                payload_type TEXT NOT NULL,
                source_device_id TEXT NOT NULL,
                source_seq INTEGER NOT NULL,
                logical_ts_ms INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// V1 -> V2: Add pinned_at and code_language columns
    async fn migrate_v1_to_v2(&self) -> Result<(), sqlx::Error> {
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN pinned_at INTEGER")
            .execute(&self.pool)
            .await;
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN code_language TEXT")
            .execute(&self.pool)
            .await;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_code_language ON clipboard_items(code_language)",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// V2 -> V3: FTS5 virtual table + data migration
    async fn migrate_v2_to_v3(&self) -> Result<(), sqlx::Error> {
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
        self.migrate_fts_data().await?;
        Ok(())
    }

    /// V3 -> V4: Add dedicated workbench pin order column.
    async fn migrate_v3_to_v4(&self) -> Result<(), sqlx::Error> {
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN pin_order INTEGER")
            .execute(&self.pool)
            .await;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_pinned_order ON clipboard_items(is_deleted, is_pinned, pin_order)",
        )
        .execute(&self.pool)
        .await?;

        // Backfill existing pinned rows so old users keep a stable order after upgrade.
        let pinned_ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM clipboard_items
             WHERE is_deleted = 0 AND is_pinned = 1
             ORDER BY pinned_at ASC, created_at ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        for (idx, id) in pinned_ids.iter().enumerate() {
            sqlx::query("UPDATE clipboard_items SET pin_order = ? WHERE id = ?")
                .bind((idx as i64) + 1)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    /// V4 -> V5: Add dedicated collection favorite order column.
    async fn migrate_v4_to_v5(&self) -> Result<(), sqlx::Error> {
        let _ = sqlx::query("ALTER TABLE clipboard_items ADD COLUMN favorite_order INTEGER")
            .execute(&self.pool)
            .await;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_favorite_order ON clipboard_items(is_deleted, is_favorite, favorite_order)",
        )
        .execute(&self.pool)
        .await?;

        // Backfill existing favorites with deterministic order aligned to prior UI sort.
        let favorite_ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM clipboard_items
             WHERE is_deleted = 0 AND is_favorite = 1
             ORDER BY updated_at DESC, created_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        for (idx, id) in favorite_ids.iter().enumerate() {
            sqlx::query("UPDATE clipboard_items SET favorite_order = ? WHERE id = ?")
                .bind((idx as i64) + 1)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    /// V5 -> V6: Add manual user tag index table for fast/complete tag dropdown.
    async fn migrate_v5_to_v6(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS user_tag_index (
                tag TEXT PRIMARY KEY,
                updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_user_tag_index_updated_at ON user_tag_index(updated_at DESC)",
        )
        .execute(&self.pool)
        .await?;

        self.rebuild_user_tag_index().await?;
        Ok(())
    }

    async fn rebuild_user_tag_index(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM user_tag_index")
            .execute(&self.pool)
            .await?;

        let now = chrono::Utc::now().timestamp();
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO user_tag_index (tag, updated_at)
            SELECT DISTINCT TRIM(CAST(j.value AS TEXT)) AS tag, ?
            FROM clipboard_items AS ci
            JOIN json_each(ci.tags) AS j
            WHERE ci.is_deleted = 0
              AND ci.tags IS NOT NULL
              AND json_valid(ci.tags) = 1
              AND TRIM(CAST(j.value AS TEXT)) != ''
              AND CAST(j.value AS TEXT) NOT LIKE 'AI:%'
            "#,
        )
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn user_tag_exists_in_active_items(&self, tag: &str) -> Result<bool, sqlx::Error> {
        let exists: i64 = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM clipboard_items AS ci
                WHERE ci.is_deleted = 0
                  AND ci.tags IS NOT NULL
                  AND json_valid(ci.tags) = 1
                  AND EXISTS (
                      SELECT 1
                      FROM json_each(ci.tags) AS j
                      WHERE CAST(j.value AS TEXT) = ?
                  )
                LIMIT 1
            )
            "#,
        )
        .bind(tag)
        .fetch_one(&self.pool)
        .await?;

        Ok(exists > 0)
    }

    async fn sync_user_tag_index_for_tags(&self, tags: &HashSet<String>) -> Result<(), sqlx::Error> {
        if tags.is_empty() {
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp();
        for tag in tags {
            if self.user_tag_exists_in_active_items(tag).await? {
                sqlx::query("INSERT OR REPLACE INTO user_tag_index (tag, updated_at) VALUES (?, ?)")
                    .bind(tag)
                    .bind(now)
                    .execute(&self.pool)
                    .await?;
            } else {
                sqlx::query("DELETE FROM user_tag_index WHERE tag = ?")
                    .bind(tag)
                    .execute(&self.pool)
                    .await?;
            }
        }

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
        let affected_user_tags = parse_user_tags(item.tags.as_deref());
        self.sync_user_tag_index_for_tags(&affected_user_tags).await?;

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
        let sql = format!(
            "SELECT id, type,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN SUBSTR(content, 1, {content_limit})
                        ELSE content
                    END as content,
                    '' as original_content, content_hash,
                    image_paths,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN SUBSTR(ocr_text, 1, {ocr_limit})
                        ELSE ocr_text
                    END as ocr_text,
                    code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN 1 ELSE 0
                    END as content_truncated,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN 1 ELSE 0
                    END as ocr_truncated
             FROM clipboard_items WHERE is_deleted = 0
             ORDER BY updated_at DESC LIMIT ?",
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS,
        );
        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
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
        let sql = format!(
            "SELECT id, type,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN SUBSTR(content, 1, {content_limit})
                        ELSE content
                    END as content,
                    '' as original_content, content_hash,
                    image_paths,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN SUBSTR(ocr_text, 1, {ocr_limit})
                        ELSE ocr_text
                    END as ocr_text,
                    code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN 1 ELSE 0
                    END as content_truncated,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN 1 ELSE 0
                    END as ocr_truncated
             FROM clipboard_items WHERE is_deleted = 0
             ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS,
        );
        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    /// Count items by history groups based on `updated_at`.
    pub async fn get_history_group_counts(
        &self,
        start_today: i64,
        start_yesterday: i64,
        start_last7: i64,
    ) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        let (today, yesterday, last7, older) = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            r#"
            SELECT
                COALESCE(SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END), 0) AS today_count,
                COALESCE(SUM(CASE WHEN updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END), 0) AS yesterday_count,
                COALESCE(SUM(CASE WHEN updated_at >= ? AND updated_at < ? THEN 1 ELSE 0 END), 0) AS last7_count,
                COALESCE(SUM(CASE WHEN updated_at < ? THEN 1 ELSE 0 END), 0) AS older_count
            FROM clipboard_items
            WHERE is_deleted = 0
            "#,
        )
        .bind(start_today)
        .bind(start_yesterday)
        .bind(start_today)
        .bind(start_last7)
        .bind(start_yesterday)
        .bind(start_last7)
        .fetch_one(&self.pool)
        .await?;

        Ok((today, yesterday, last7, older))
    }

    pub async fn get_user_tags(
        &self,
        query: Option<&str>,
        limit: i32,
        only_favorite: bool,
        only_pinned: bool,
    ) -> Result<Vec<String>, sqlx::Error> {
        let normalized_limit = limit.clamp(1, 200);
        let normalized_query = query.unwrap_or("").trim().to_lowercase();

        if !only_favorite && !only_pinned {
            if normalized_query.is_empty() {
                let tags = sqlx::query_scalar::<_, String>(
                    "SELECT tag FROM user_tag_index
                     ORDER BY updated_at DESC, tag COLLATE NOCASE ASC
                     LIMIT ?",
                )
                .bind(normalized_limit)
                .fetch_all(&self.pool)
                .await?;
                return Ok(tags);
            }

            let like_pattern = format!("%{}%", normalized_query);
            let tags = sqlx::query_scalar::<_, String>(
                "SELECT tag FROM user_tag_index
                 WHERE LOWER(tag) LIKE ?
                 ORDER BY updated_at DESC, tag COLLATE NOCASE ASC
                 LIMIT ?",
            )
            .bind(like_pattern)
            .bind(normalized_limit)
            .fetch_all(&self.pool)
            .await?;
            return Ok(tags);
        }

        let like_pattern = format!("%{}%", normalized_query);
        let empty_query = normalized_query.is_empty();
        let tags = sqlx::query_scalar::<_, String>(
            r#"
            SELECT tag
            FROM (
                SELECT
                    TRIM(CAST(j.value AS TEXT)) AS tag,
                    MAX(ci.updated_at) AS latest_updated_at
                FROM clipboard_items AS ci
                JOIN json_each(ci.tags) AS j
                WHERE ci.is_deleted = 0
                  AND ci.tags IS NOT NULL
                  AND json_valid(ci.tags) = 1
                  AND TRIM(CAST(j.value AS TEXT)) != ''
                  AND CAST(j.value AS TEXT) NOT LIKE 'AI:%'
                  AND (? = 0 OR ci.is_favorite = 1)
                  AND (? = 0 OR ci.is_pinned = 1)
                  AND (? = 1 OR LOWER(CAST(j.value AS TEXT)) LIKE ?)
                GROUP BY TRIM(CAST(j.value AS TEXT))
            ) AS t
            ORDER BY latest_updated_at DESC, tag COLLATE NOCASE ASC
            LIMIT ?
            "#,
        )
        .bind(only_favorite)
        .bind(only_pinned)
        .bind(empty_query)
        .bind(&like_pattern)
        .bind(normalized_limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(tags)
    }

    pub async fn clear_user_tag_index(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM user_tag_index")
            .execute(&self.pool)
            .await?;
        Ok(())
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
        let mut sql = format!(
            "SELECT id, type,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN SUBSTR(content, 1, {content_limit})
                        ELSE content
                    END as content,
                    '' as original_content, content_hash,
                    image_paths,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN SUBSTR(ocr_text, 1, {ocr_limit})
                        ELSE ocr_text
                    END as ocr_text,
                    code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN 1 ELSE 0
                    END as content_truncated,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN 1 ELSE 0
                    END as ocr_truncated
             FROM clipboard_items WHERE is_deleted = 0",
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS,
        );

        append_common_search_filters(
            &mut sql,
            filters,
            "type",
            "code_language",
            "is_pinned",
            "is_favorite",
            "tags",
            "metadata",
            "created_at",
        );

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
        let mut sql = format!(
            "SELECT id, type,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN SUBSTR(content, 1, {content_limit})
                        ELSE content
                    END as content,
                    '' as original_content, content_hash,
                    image_paths,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN SUBSTR(ocr_text, 1, {ocr_limit})
                        ELSE ocr_text
                    END as ocr_text,
                    code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN 1 ELSE 0
                    END as content_truncated,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN 1 ELSE 0
                    END as ocr_truncated
             FROM clipboard_items WHERE is_deleted = 0 AND tags IS NOT NULL",
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS,
        );

        append_common_search_filters(
            &mut sql,
            filters,
            "type",
            "code_language",
            "is_pinned",
            "is_favorite",
            "tags",
            "metadata",
            "created_at",
        );

        sql.push_str(&format!(" AND LOWER(tags) LIKE '%{}%'", escaped_query));
        sql.push_str(&format!(" ORDER BY updated_at DESC LIMIT {}", limit));

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
            .fetch_all(&self.pool)
            .await?;

        Ok(items)
    }

    pub async fn update(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        let previous_tags: Option<String> =
            sqlx::query_scalar("SELECT tags FROM clipboard_items WHERE id = ?")
                .bind(&item.id)
                .fetch_optional(&self.pool)
                .await?
                .flatten();

        let should_update_content = item.content_updated;
        sqlx::query(
            r#"
            UPDATE clipboard_items SET
                content = CASE WHEN ? THEN ? ELSE content END,
                tags = ?, user_note = ?, code_language = ?, metadata = ?,
                is_pinned = ?, is_favorite = ?, pinned_at = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(should_update_content)
        .bind(&item.content)
        .bind(&item.tags)
        .bind(&item.user_note)
        .bind(&item.code_language)
        .bind(&item.metadata)
        .bind(item.is_pinned)
        .bind(item.is_favorite)
        .bind(item.pinned_at)
        .bind(item.updated_at)
        .bind(&item.id)
        .execute(&self.pool)
        .await?;

        let mut affected_user_tags = parse_user_tags(previous_tags.as_deref());
        affected_user_tags.extend(parse_user_tags(item.tags.as_deref()));
        self.sync_user_tag_index_for_tags(&affected_user_tags).await?;

        if let Ok(Some(latest)) = self.find_by_id(&item.id).await {
            self.update_fts(&latest).await;
        }

        Ok(())
    }

    pub async fn delete(&self, id: &str) -> Result<(), sqlx::Error> {
        let existing_tags: Option<String> =
            sqlx::query_scalar("SELECT tags FROM clipboard_items WHERE id = ? AND is_deleted = 0")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .flatten();

        sqlx::query("UPDATE clipboard_items SET is_deleted = 1 WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.delete_fts(id).await;
        let affected_user_tags = parse_user_tags(existing_tags.as_deref());
        self.sync_user_tag_index_for_tags(&affected_user_tags).await?;

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

    pub async fn update_code_language(
        &self,
        id: &str,
        code_language: &str,
    ) -> Result<(), sqlx::Error> {
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

    /// Return pinned items in persisted workbench order.
    pub async fn get_workbench_pinned_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items
             WHERE is_deleted = 0 AND is_pinned = 1
             ORDER BY
               CASE WHEN pin_order IS NULL OR pin_order <= 0 THEN 1 ELSE 0 END ASC,
               pin_order ASC,
               pinned_at DESC,
               created_at DESC,
               id DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// Return favorite items in persisted collection order.
    pub async fn get_collection_favorite_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items
             WHERE is_deleted = 0 AND is_favorite = 1
             ORDER BY
               CASE WHEN favorite_order IS NULL OR favorite_order <= 0 THEN 1 ELSE 0 END ASC,
               favorite_order ASC,
               updated_at DESC,
               created_at DESC,
               id DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(items)
    }

    /// 取消指定项的置顶状态
    pub async fn unpin(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE clipboard_items SET is_pinned = 0, pinned_at = NULL, pin_order = NULL WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), sqlx::Error> {
        if pinned {
            let pinned_at = chrono::Utc::now().timestamp();
            let mut tx = self.pool.begin().await?;
            sqlx::query(
                "UPDATE clipboard_items
                 SET pin_order = CASE
                   WHEN pin_order IS NULL OR pin_order <= 0 THEN 2
                   ELSE pin_order + 1
                 END
                 WHERE is_deleted = 0 AND is_pinned = 1 AND id != ?",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "UPDATE clipboard_items
                 SET is_pinned = 1,
                     pinned_at = ?,
                     pin_order = 1
                 WHERE id = ?",
            )
            .bind(pinned_at)
            .bind(id)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(());
        }

        sqlx::query(
            "UPDATE clipboard_items
             SET is_pinned = 0, pinned_at = NULL, pin_order = NULL
             WHERE id = ?",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn reorder_workbench_pinned_items(
        &self,
        ordered_ids: &[String],
    ) -> Result<(), sqlx::Error> {
        let existing_ids = self
            .get_workbench_pinned_items()
            .await?
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<String>>();

        if existing_ids.is_empty() {
            return Ok(());
        }

        let existing_set = existing_ids
            .iter()
            .cloned()
            .collect::<HashSet<String>>();

        let mut normalized = Vec::with_capacity(existing_ids.len());
        let mut seen = HashSet::new();

        for id in ordered_ids {
            if !existing_set.contains(id) {
                continue;
            }
            if seen.insert(id.clone()) {
                normalized.push(id.clone());
            }
        }

        for id in existing_ids {
            if seen.insert(id.clone()) {
                normalized.push(id);
            }
        }

        let mut tx = self.pool.begin().await?;
        for (idx, id) in normalized.iter().enumerate() {
            sqlx::query("UPDATE clipboard_items SET pin_order = ? WHERE id = ?")
                .bind((idx as i64) + 1)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;

        Ok(())
    }

    pub async fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), sqlx::Error> {
        let now = chrono::Utc::now().timestamp();
        if favorite {
            sqlx::query(
                "UPDATE clipboard_items
                 SET is_favorite = 1,
                     favorite_order = (
                       SELECT COALESCE(MAX(favorite_order), 0) + 1
                       FROM clipboard_items
                       WHERE is_deleted = 0 AND is_favorite = 1
                     ),
                     updated_at = ?
                 WHERE id = ?",
            )
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
            return Ok(());
        }

        sqlx::query(
            "UPDATE clipboard_items
             SET is_favorite = 0, favorite_order = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn reorder_collection_favorite_items(
        &self,
        ordered_ids: &[String],
    ) -> Result<(), sqlx::Error> {
        let existing_ids = self
            .get_collection_favorite_items()
            .await?
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<String>>();

        if existing_ids.is_empty() {
            return Ok(());
        }

        let existing_set = existing_ids
            .iter()
            .cloned()
            .collect::<HashSet<String>>();

        let mut normalized = Vec::with_capacity(existing_ids.len());
        let mut seen = HashSet::new();

        for id in ordered_ids {
            if !existing_set.contains(id) {
                continue;
            }
            if seen.insert(id.clone()) {
                normalized.push(id.clone());
            }
        }

        for id in existing_ids {
            if seen.insert(id.clone()) {
                normalized.push(id);
            }
        }

        let mut tx = self.pool.begin().await?;
        for (idx, id) in normalized.iter().enumerate() {
            sqlx::query("UPDATE clipboard_items SET favorite_order = ? WHERE id = ?")
                .bind((idx as i64) + 1)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;

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
        let rows: Vec<(String, Vec<u8>)> =
            sqlx::query_as("SELECT mime_type, data FROM clipboard_raw_formats WHERE item_id = ?")
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

    fn now_unix_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn compare_sync_version(incoming: &SyncIncomingSlot, current: &SyncLatestSlot) -> Ordering {
        if incoming.source_device_id == current.source_device_id {
            let seq_cmp = incoming.source_seq.cmp(&current.source_seq);
            if seq_cmp != Ordering::Equal {
                return seq_cmp;
            }

            let ts_cmp = incoming.logical_ts_ms.cmp(&current.logical_ts_ms);
            if ts_cmp != Ordering::Equal {
                return ts_cmp;
            }

            return incoming.content_hash.cmp(&current.content_hash);
        }

        let ts_cmp = incoming.logical_ts_ms.cmp(&current.logical_ts_ms);
        if ts_cmp != Ordering::Equal {
            return ts_cmp;
        }

        let source_cmp = incoming.source_device_id.cmp(&current.source_device_id);
        if source_cmp != Ordering::Equal {
            return source_cmp;
        }

        let seq_cmp = incoming.source_seq.cmp(&current.source_seq);
        if seq_cmp != Ordering::Equal {
            return seq_cmp;
        }

        incoming.content_hash.cmp(&current.content_hash)
    }

    fn validate_sync_incoming_slot(incoming: &SyncIncomingSlot) -> Option<&'static str> {
        if incoming.payload_json.trim().is_empty() {
            return Some("invalid_payload_json");
        }
        if incoming.payload_type.trim().is_empty() {
            return Some("invalid_payload_type");
        }
        if incoming.source_device_id.trim().is_empty() {
            return Some("invalid_source_device_id");
        }
        if incoming.source_seq <= 0 {
            return Some("invalid_source_seq");
        }
        if incoming.logical_ts_ms <= 0 {
            return Some("invalid_logical_ts_ms");
        }
        if incoming.content_hash.trim().is_empty() {
            return Some("invalid_content_hash");
        }
        None
    }

    async fn upsert_sync_latest_slot(&self, slot: &SyncLatestSlot) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO sync_latest_slot (
                slot_id, payload_json, payload_type, source_device_id,
                source_seq, logical_ts_ms, content_hash, updated_at_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slot_id) DO UPDATE SET
                payload_json = excluded.payload_json,
                payload_type = excluded.payload_type,
                source_device_id = excluded.source_device_id,
                source_seq = excluded.source_seq,
                logical_ts_ms = excluded.logical_ts_ms,
                content_hash = excluded.content_hash,
                updated_at_ms = excluded.updated_at_ms
            "#,
        )
        .bind(&slot.slot_id)
        .bind(&slot.payload_json)
        .bind(&slot.payload_type)
        .bind(&slot.source_device_id)
        .bind(slot.source_seq)
        .bind(slot.logical_ts_ms)
        .bind(&slot.content_hash)
        .bind(slot.updated_at_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_sync_latest_slot(&self) -> Result<Option<SyncLatestSlot>, sqlx::Error> {
        let slot = sqlx::query_as::<_, SyncLatestSlot>(
            r#"
            SELECT
                slot_id, payload_json, payload_type, source_device_id,
                source_seq, logical_ts_ms, content_hash, updated_at_ms
            FROM sync_latest_slot
            WHERE slot_id = ?
            LIMIT 1
            "#,
        )
        .bind(SYNC_GLOBAL_SLOT_ID)
        .fetch_optional(&self.pool)
        .await?;
        Ok(slot)
    }

    pub async fn get_next_sync_source_seq_hint(
        &self,
        source_device_id: &str,
    ) -> Result<i64, sqlx::Error> {
        let now_ms = Self::now_unix_ms();
        let current = self.get_sync_latest_slot().await?;
        let next = match current {
            Some(slot) if slot.source_device_id == source_device_id => {
                slot.source_seq.saturating_add(1)
            }
            _ => now_ms.max(1),
        };
        Ok(next)
    }

    pub async fn publish_sync_slot_local(
        &self,
        payload_json: &str,
        payload_type: &str,
        source_device_id: &str,
        content_hash: &str,
        logical_ts_ms: Option<i64>,
    ) -> Result<SyncLatestSlot, sqlx::Error> {
        let current = self.get_sync_latest_slot().await?;
        let now_ms = Self::now_unix_ms();

        let requested_ts = logical_ts_ms.unwrap_or(now_ms);
        let min_next_ts = current
            .as_ref()
            .map(|slot| slot.logical_ts_ms.saturating_add(1))
            .unwrap_or(0);
        let final_ts = requested_ts.max(min_next_ts).max(now_ms);

        let source_seq = match current.as_ref() {
            Some(slot) if slot.source_device_id == source_device_id => {
                slot.source_seq.saturating_add(1)
            }
            _ => final_ts.max(1),
        };

        let slot = SyncLatestSlot {
            slot_id: SYNC_GLOBAL_SLOT_ID.to_string(),
            payload_json: payload_json.to_string(),
            payload_type: payload_type.to_string(),
            source_device_id: source_device_id.to_string(),
            source_seq,
            logical_ts_ms: final_ts,
            content_hash: content_hash.to_string(),
            updated_at_ms: now_ms,
        };

        self.upsert_sync_latest_slot(&slot).await?;
        Ok(slot)
    }

    pub async fn apply_remote_sync_slot(
        &self,
        incoming: &SyncIncomingSlot,
    ) -> Result<SyncApplyResult, sqlx::Error> {
        let current = self.get_sync_latest_slot().await?;
        if let Some(reason) = Self::validate_sync_incoming_slot(incoming) {
            return Ok(SyncApplyResult {
                applied: false,
                reason: reason.to_string(),
                slot: current,
            });
        }

        if let Some(current_slot) = current.as_ref() {
            match Self::compare_sync_version(incoming, current_slot) {
                Ordering::Less => {
                    return Ok(SyncApplyResult {
                        applied: false,
                        reason: "stale_version".to_string(),
                        slot: current,
                    });
                }
                Ordering::Equal => {
                    return Ok(SyncApplyResult {
                        applied: false,
                        reason: "duplicate_or_same_version".to_string(),
                        slot: current,
                    });
                }
                Ordering::Greater => {}
            }
        }

        let applied_slot = SyncLatestSlot {
            slot_id: SYNC_GLOBAL_SLOT_ID.to_string(),
            payload_json: incoming.payload_json.clone(),
            payload_type: incoming.payload_type.clone(),
            source_device_id: incoming.source_device_id.clone(),
            source_seq: incoming.source_seq,
            logical_ts_ms: incoming.logical_ts_ms,
            content_hash: incoming.content_hash.clone(),
            updated_at_ms: Self::now_unix_ms(),
        };

        self.upsert_sync_latest_slot(&applied_slot).await?;

        Ok(SyncApplyResult {
            applied: true,
            reason: "applied".to_string(),
            slot: Some(applied_slot),
        })
    }

    pub async fn clear_sync_latest_slot(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM sync_latest_slot")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn upsert_paired_sync_device(
        &self,
        device_id: &str,
        device_name: &str,
        pair_token: &str,
        last_host: Option<&str>,
        last_port: Option<u16>,
    ) -> Result<PairedSyncDevice, sqlx::Error> {
        let now_ms = Self::now_unix_ms();
        let last_port_i64 = last_port.map(i64::from);

        sqlx::query(
            r#"
            INSERT INTO sync_paired_devices (
                device_id, device_name, pair_token, last_host, last_port, created_at_ms, last_seen_ms
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                device_name = excluded.device_name,
                pair_token = excluded.pair_token,
                last_host = COALESCE(excluded.last_host, sync_paired_devices.last_host),
                last_port = COALESCE(excluded.last_port, sync_paired_devices.last_port),
                last_seen_ms = excluded.last_seen_ms
            "#,
        )
        .bind(device_id)
        .bind(device_name)
        .bind(pair_token)
        .bind(last_host)
        .bind(last_port_i64)
        .bind(now_ms)
        .bind(now_ms)
        .execute(&self.pool)
        .await?;

        self.get_paired_sync_device(device_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn list_paired_sync_devices(&self) -> Result<Vec<PairedSyncDevice>, sqlx::Error> {
        let rows = sqlx::query_as::<_, PairedSyncDevice>(
            r#"
            SELECT
                device_id, device_name, pair_token, last_host, last_port, created_at_ms, last_seen_ms
            FROM sync_paired_devices
            ORDER BY last_seen_ms DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn get_paired_sync_device(
        &self,
        device_id: &str,
    ) -> Result<Option<PairedSyncDevice>, sqlx::Error> {
        let row = sqlx::query_as::<_, PairedSyncDevice>(
            r#"
            SELECT
                device_id, device_name, pair_token, last_host, last_port, created_at_ms, last_seen_ms
            FROM sync_paired_devices
            WHERE device_id = ?
            LIMIT 1
            "#,
        )
        .bind(device_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn remove_paired_sync_device(&self, device_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM sync_paired_devices WHERE device_id = ?")
            .bind(device_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn touch_paired_sync_device(
        &self,
        device_id: &str,
        last_host: Option<&str>,
        last_port: Option<u16>,
    ) -> Result<(), sqlx::Error> {
        let now_ms = Self::now_unix_ms();
        let last_port_i64 = last_port.map(i64::from);
        sqlx::query(
            r#"
            UPDATE sync_paired_devices
            SET
                last_seen_ms = ?,
                last_host = COALESCE(?, last_host),
                last_port = COALESCE(?, last_port)
            WHERE device_id = ?
            "#,
        )
        .bind(now_ms)
        .bind(last_host)
        .bind(last_port_i64)
        .bind(device_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn clear_paired_sync_devices(&self) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM sync_paired_devices")
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
        sqlx::query("INSERT OR REPLACE INTO _fts_meta (key, value) VALUES ('fts_version', ?)")
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
        if let Err(e) = sqlx::query("DELETE FROM clipboard_fts WHERE item_id = ?")
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

        let mut filter_sql = String::new();
        append_common_search_filters(
            &mut filter_sql,
            filters,
            "ci.type",
            "ci.code_language",
            "ci.is_pinned",
            "ci.is_favorite",
            "ci.tags",
            "ci.metadata",
            "ci.created_at",
        );

        let sql = format!(
            r#"SELECT ci.id, ci.type,
                      CASE
                          WHEN ci.content IS NOT NULL AND LENGTH(ci.content) > {content_limit}
                              THEN SUBSTR(ci.content, 1, {content_limit})
                          ELSE ci.content
                      END as content,
                      '' as original_content, ci.content_hash,
                      ci.image_paths,
                      CASE
                          WHEN ci.ocr_text IS NOT NULL AND LENGTH(ci.ocr_text) > {ocr_limit}
                              THEN SUBSTR(ci.ocr_text, 1, {ocr_limit})
                          ELSE ci.ocr_text
                      END as ocr_text,
                      ci.code_language, NULL as embedding, ci.tags, ci.user_note,
                      ci.metadata, ci.is_pinned, ci.is_favorite, ci.is_deleted,
                      ci.pinned_at, ci.created_at, ci.updated_at,
                      EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = ci.id) as has_raw_formats,
                      CASE
                          WHEN ci.content IS NOT NULL AND LENGTH(ci.content) > {content_limit}
                              THEN 1 ELSE 0
                      END as content_truncated,
                      CASE
                          WHEN ci.ocr_text IS NOT NULL AND LENGTH(ci.ocr_text) > {ocr_limit}
                              THEN 1 ELSE 0
                      END as ocr_truncated
               FROM clipboard_items ci
               INNER JOIN clipboard_fts fts ON ci.id = fts.item_id
               WHERE ci.is_deleted = 0
               AND clipboard_fts MATCH ?
               {}
               ORDER BY ci.updated_at DESC
               LIMIT ?"#,
            filter_sql,
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS
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
        let sql = format!(
            "SELECT id, type,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN SUBSTR(content, 1, {content_limit})
                        ELSE content
                    END as content,
                    '' as original_content, content_hash,
                    image_paths,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN SUBSTR(ocr_text, 1, {ocr_limit})
                        ELSE ocr_text
                    END as ocr_text,
                    code_language, NULL as embedding, tags, user_note,
                    metadata, is_pinned, is_favorite, is_deleted,
                    pinned_at, created_at, updated_at,
                    EXISTS(SELECT 1 FROM clipboard_raw_formats WHERE item_id = clipboard_items.id) as has_raw_formats,
                    CASE
                        WHEN content IS NOT NULL AND LENGTH(content) > {content_limit}
                            THEN 1 ELSE 0
                    END as content_truncated,
                    CASE
                        WHEN ocr_text IS NOT NULL AND LENGTH(ocr_text) > {ocr_limit}
                            THEN 1 ELSE 0
                    END as ocr_truncated
             FROM clipboard_items WHERE is_deleted = 0
             AND updated_at >= ? AND updated_at < ?
             ORDER BY updated_at ASC",
            content_limit = LIGHT_CONTENT_PREVIEW_CHARS,
            ocr_limit = LIGHT_OCR_PREVIEW_CHARS,
        );

        let items = sqlx::query_as::<_, ClipboardItem>(&sql)
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
        let rows: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT id, type, image_paths, tags FROM clipboard_items
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

        let mut affected_user_tags = HashSet::new();
        rows.iter().for_each(|(_, _, _, tags)| {
            affected_user_tags.extend(parse_user_tags(tags.as_deref()));
        });

        let targets: Vec<CleanupTarget> = rows
            .iter()
            .map(|(id, type_, image_paths, _)| CleanupTarget {
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

        self.sync_user_tag_index_for_tags(&affected_user_tags).await?;

        Ok(targets)
    }

    /// Hard-delete recent unprotected items created after cutoff timestamp.
    pub async fn cleanup_recent_items_since(
        &self,
        cutoff_ts: i64,
    ) -> Result<Vec<CleanupTarget>, sqlx::Error> {
        let rows: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
            r#"SELECT id, type, image_paths, tags FROM clipboard_items
               WHERE is_deleted = 0 AND is_pinned = 0 AND is_favorite = 0
               AND created_at >= ?
               ORDER BY created_at ASC"#,
        )
        .bind(cutoff_ts)
        .fetch_all(&self.pool)
        .await?;

        if rows.is_empty() {
            return Ok(vec![]);
        }

        let mut affected_user_tags = HashSet::new();
        rows.iter().for_each(|(_, _, _, tags)| {
            affected_user_tags.extend(parse_user_tags(tags.as_deref()));
        });

        let targets: Vec<CleanupTarget> = rows
            .iter()
            .map(|(id, type_, image_paths, _)| CleanupTarget {
                id: id.clone(),
                type_: type_.clone(),
                image_paths: image_paths.clone(),
            })
            .collect();

        for target in &targets {
            self.delete_fts(&target.id).await;
            let _ = sqlx::query("DELETE FROM clipboard_raw_formats WHERE item_id = ?")
                .bind(&target.id)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM clipboard_items WHERE id = ?")
                .bind(&target.id)
                .execute(&self.pool)
                .await;
        }

        self.sync_user_tag_index_for_tags(&affected_user_tags).await?;

        Ok(targets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_current(
        source_device_id: &str,
        source_seq: i64,
        logical_ts_ms: i64,
        content_hash: &str,
    ) -> SyncLatestSlot {
        SyncLatestSlot {
            slot_id: SYNC_GLOBAL_SLOT_ID.to_string(),
            payload_json: "{\"v\":1}".to_string(),
            payload_type: "text".to_string(),
            source_device_id: source_device_id.to_string(),
            source_seq,
            logical_ts_ms,
            content_hash: content_hash.to_string(),
            updated_at_ms: logical_ts_ms,
        }
    }

    fn make_incoming(
        source_device_id: &str,
        source_seq: i64,
        logical_ts_ms: i64,
        content_hash: &str,
    ) -> SyncIncomingSlot {
        SyncIncomingSlot {
            payload_json: "{\"v\":1}".to_string(),
            payload_type: "text".to_string(),
            source_device_id: source_device_id.to_string(),
            source_seq,
            logical_ts_ms,
            content_hash: content_hash.to_string(),
        }
    }

    #[test]
    fn compare_prefers_seq_for_same_source() {
        let current = make_current("A", 10, 1000, "hash-a");
        let newer = make_incoming("A", 11, 999, "hash-b");
        let older = make_incoming("A", 9, 2000, "hash-c");

        assert_eq!(
            ClipboardRepository::compare_sync_version(&newer, &current),
            Ordering::Greater
        );
        assert_eq!(
            ClipboardRepository::compare_sync_version(&older, &current),
            Ordering::Less
        );
    }

    #[test]
    fn compare_prefers_logical_ts_across_sources() {
        let current = make_current("A", 100, 1000, "hash-a");
        let newer = make_incoming("B", 1, 1001, "hash-b");
        let older = make_incoming("B", 999, 999, "hash-c");

        assert_eq!(
            ClipboardRepository::compare_sync_version(&newer, &current),
            Ordering::Greater
        );
        assert_eq!(
            ClipboardRepository::compare_sync_version(&older, &current),
            Ordering::Less
        );
    }

    #[test]
    fn compare_uses_device_id_tie_break_when_ts_equal() {
        let current = make_current("device-b", 10, 1000, "hash-a");
        let newer = make_incoming("device-c", 1, 1000, "hash-b");
        let older = make_incoming("device-a", 999, 1000, "hash-c");

        assert_eq!(
            ClipboardRepository::compare_sync_version(&newer, &current),
            Ordering::Greater
        );
        assert_eq!(
            ClipboardRepository::compare_sync_version(&older, &current),
            Ordering::Less
        );
    }

    #[test]
    fn compare_marks_exact_duplicate_as_equal() {
        let current = make_current("A", 10, 1000, "hash-a");
        let duplicate = make_incoming("A", 10, 1000, "hash-a");

        assert_eq!(
            ClipboardRepository::compare_sync_version(&duplicate, &current),
            Ordering::Equal
        );
    }
}
