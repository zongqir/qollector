import { HISTORY_SNAPSHOT_STORAGE_KEY } from '../../constants/storageKeys';

const HISTORY_SNAPSHOT_MAX_ITEMS = 40;
const HISTORY_SNAPSHOT_MAX_CONTENT_CHARS = 4000;
const HISTORY_SNAPSHOT_MAX_OCR_CHARS = 3000;

const truncateText = (value, limit) => {
  if (typeof value !== 'string') return value;
  if (value.length <= limit) return value;
  return value.slice(0, limit);
};

const toHistorySnapshotItem = (item) => {
  if (!item || !item.id) return null;
  const contentTruncatedInSnapshot = typeof item.content === 'string'
    && item.content.length > HISTORY_SNAPSHOT_MAX_CONTENT_CHARS;
  const ocrTruncatedInSnapshot = typeof item.ocr_text === 'string'
    && item.ocr_text.length > HISTORY_SNAPSHOT_MAX_OCR_CHARS;
  return {
    ...item,
    original_content: '',
    embedding: null,
    content: truncateText(item.content, HISTORY_SNAPSHOT_MAX_CONTENT_CHARS),
    ocr_text: truncateText(item.ocr_text, HISTORY_SNAPSHOT_MAX_OCR_CHARS),
    content_truncated: Boolean(item.content_truncated || contentTruncatedInSnapshot),
    ocr_truncated: Boolean(item.ocr_truncated || ocrTruncatedInSnapshot),
    content_updated: false,
  };
};

export const readHistorySnapshot = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toHistorySnapshotItem)
      .filter(Boolean)
      .slice(0, HISTORY_SNAPSHOT_MAX_ITEMS);
  } catch (error) {
    console.warn('[HistorySnapshot] read failed:', error);
    return [];
  }
};

export const persistHistorySnapshot = (items) => {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = (Array.isArray(items) ? items : [])
      .map(toHistorySnapshotItem)
      .filter(Boolean)
      .slice(0, HISTORY_SNAPSHOT_MAX_ITEMS);
    localStorage.setItem(HISTORY_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[HistorySnapshot] persist failed:', error);
  }
};

export const clearHistorySnapshot = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_SNAPSHOT_STORAGE_KEY);
  } catch (error) {
    console.warn('[HistorySnapshot] clear failed:', error);
  }
};
