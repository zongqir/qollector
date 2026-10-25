/**
 * Core Clipboard Item model reflecting SQLite & Tauri Rust structs
 */
export interface ClipboardItem {
  id: string;
  type_: 'text' | 'image' | 'file' | string;
  content?: string | null;
  original_content?: string | null;
  content_hash: string;
  image_paths?: string | null;
  ocr_text?: string | null;
  code_language?: string | null;
  embedding?: number[] | null;
  tags?: string | null;
  user_note?: string | null;
  metadata?: string | null;
  is_pinned: boolean;
  is_favorite: boolean;
  is_deleted: boolean;
  pinned_at?: number | null;
  pin_order?: number | null;
  favorite_order?: number | null;
  workbench_id?: string | null;
  created_at: number;
  updated_at: number;
  has_raw_formats?: boolean;
  content_truncated?: boolean;
  ocr_truncated?: boolean;
  content_updated?: boolean;
}

/**
 * Search Filters passed to Tauri search_items backend
 */
export interface SearchFilters {
  query?: string;
  content_types?: string[];
  tags?: string[];
  date_start?: number | null;
  date_end?: number | null;
  is_favorite?: boolean | null;
  is_pinned?: boolean | null;
  workbench_id?: string | null;
  limit?: number;
  offset?: number;
}
