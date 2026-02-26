import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getTags, hasReservedTagPrefix } from '../utils/tagHelpers';
import {
  getCardBackgroundIdFromMetadata,
  normalizeCardBackgroundId,
  withCardBackgroundInMetadata,
} from '../utils/cardBackgrounds';
import { generateAITagsForItem, autoGenerateAITags as autoGenerateAITagsSvc } from '../services/aiService';
import { getRecentItemsLight, getMoreItems, copyItemToClipboard, deleteItem as deleteItemSvc } from '../services/clipboardService';
import { initOcrService } from '../services/ocrService';
import { detectAndUpdateCodeLanguage } from '../services/codeDetectionService';
import { FREE_PROVIDERS } from '../share/providers';

const PAGE_SIZE = 30;
const MAX_ITEMS_IN_MEMORY = 150;
const LOW_MEMORY_PAGE_SIZE = 20;
const LOW_MEMORY_MAX_ITEMS_IN_MEMORY = 80;
const MEMORY_PROBE_PREFIX = '[MemoryProbe]';
const HISTORY_SNAPSHOT_KEY = 'qollect-history-snapshot-v1';
const HISTORY_SNAPSHOT_MAX_ITEMS = 40;
const HISTORY_SNAPSHOT_MAX_CONTENT_CHARS = 4000;
const HISTORY_SNAPSHOT_MAX_OCR_CHARS = 3000;
const FILTER_VIEWS_STORAGE_KEY = 'qollect-filter-views-v1';
const HISTORY_STREAM_ENABLED_KEY = 'qollect-history-stream-enabled';
const MAX_FILTER_VIEWS = 12;
const MANUAL_ENTRY_SOURCE = 'Quick Input';
const QUICK_NOTE_SOURCE = 'Quick Note';
let loadItemsRequestSeq = 0;

const toLen = (value) => (typeof value === 'string' ? value.length : 0);
const COPY_FEEDBACK_SOURCES = new Set(['history', 'preview', 'hover', 'collection', 'global']);
const normalizeCopyFeedbackSource = (source) => {
  if (typeof source !== 'string') return 'global';
  const normalized = source.trim().toLowerCase();
  return COPY_FEEDBACK_SOURCES.has(normalized) ? normalized : 'global';
};
const detectClientPlatform = () => {
  if (typeof navigator === 'undefined') return 'other';
  const raw = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  if (raw.includes('linux')) return 'linux';
  return 'other';
};
const SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK = detectClientPlatform() === 'windows';
const getItemsMemoryCap = (lowMemoryModeEnabled) => (
  lowMemoryModeEnabled ? LOW_MEMORY_MAX_ITEMS_IN_MEMORY : MAX_ITEMS_IN_MEMORY
);
const getItemsPageSize = (lowMemoryModeEnabled) => (
  lowMemoryModeEnabled ? LOW_MEMORY_PAGE_SIZE : PAGE_SIZE
);

const summarizeItemsForMemory = (items) => {
  let totalContentChars = 0;
  let totalOcrChars = 0;
  let totalNoteChars = 0;
  let maxContentChars = 0;
  let maxOcrChars = 0;
  let longContentItems = 0;
  let longOcrItems = 0;

  for (const item of items) {
    const contentLen = toLen(item?.content);
    const ocrLen = toLen(item?.ocr_text);
    const noteLen = toLen(item?.user_note);

    totalContentChars += contentLen;
    totalOcrChars += ocrLen;
    totalNoteChars += noteLen;

    if (contentLen > maxContentChars) maxContentChars = contentLen;
    if (ocrLen > maxOcrChars) maxOcrChars = ocrLen;
    if (contentLen >= 2000) longContentItems += 1;
    if (ocrLen >= 2000) longOcrItems += 1;
  }

  return {
    items: items.length,
    totalContentChars,
    totalOcrChars,
    totalNoteChars,
    maxContentChars,
    maxOcrChars,
    longContentItems,
    longOcrItems,
  };
};

const logItemsMemoryProbe = (stage, items, extra = {}) => {
  console.log(`${MEMORY_PROBE_PREFIX} ${stage}`, {
    ...summarizeItemsForMemory(items),
    ...extra,
  });
};

const sortByUpdatedAtDesc = (a, b) => {
  const timeDiff = (b?.updated_at || 0) - (a?.updated_at || 0);
  if (timeDiff !== 0) return timeDiff;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
};

const mergeUniqueById = (baseItems, incomingItems) => {
  const map = new Map();
  [...baseItems, ...incomingItems].forEach((item) => {
    if (!item?.id) return;
    const prev = map.get(item.id);
    if (!prev || (item.updated_at || 0) >= (prev.updated_at || 0)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values()).sort(sortByUpdatedAtDesc);
};

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

const readHistorySnapshot = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_SNAPSHOT_KEY);
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

const persistHistorySnapshot = (items) => {
  if (typeof window === 'undefined') return;
  try {
    const snapshot = (Array.isArray(items) ? items : [])
      .map(toHistorySnapshotItem)
      .filter(Boolean)
      .slice(0, HISTORY_SNAPSHOT_MAX_ITEMS);
    localStorage.setItem(HISTORY_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[HistorySnapshot] persist failed:', error);
  }
};

const clearHistorySnapshot = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_SNAPSHOT_KEY);
  } catch (error) {
    console.warn('[HistorySnapshot] clear failed:', error);
  }
};

const FILTER_TYPE_KEYS = new Set(['all', 'text', 'image', 'file', 'link', 'code']);

const normalizeDateRange = (range) => {
  if (!range || typeof range !== 'object') return null;
  const parsedStart = range.start == null ? null : Number(range.start);
  const parsedEnd = range.end == null ? null : Number(range.end);
  return {
    preset: typeof range.preset === 'string' ? range.preset : 'custom',
    start: Number.isFinite(parsedStart) ? parsedStart : null,
    end: Number.isFinite(parsedEnd) ? parsedEnd : null,
  };
};

const normalizeFilterPayload = (payload = {}) => {
  const selectedType = typeof payload.selectedType === 'string' && FILTER_TYPE_KEYS.has(payload.selectedType)
    ? payload.selectedType
    : 'all';
  return {
    searchQuery: typeof payload.searchQuery === 'string' ? payload.searchQuery : '',
    selectedType,
    selectedTags: Array.isArray(payload.selectedTags)
      ? Array.from(new Set(payload.selectedTags.filter(tag => typeof tag === 'string' && tag.trim())))
      : [],
    showFavoritesOnly: Boolean(payload.showFavoritesOnly),
    showPinnedOnly: Boolean(payload.showPinnedOnly),
    selectedDateRange: normalizeDateRange(payload.selectedDateRange),
    customDateStart: typeof payload.customDateStart === 'string' ? payload.customDateStart : '',
    customDateEnd: typeof payload.customDateEnd === 'string' ? payload.customDateEnd : '',
  };
};

const buildFilterPayloadFromState = (state) => normalizeFilterPayload({
  searchQuery: state.searchQuery,
  selectedType: state.selectedType,
  selectedTags: state.selectedTags,
  showFavoritesOnly: state.showFavoritesOnly,
  showPinnedOnly: state.showPinnedOnly,
  selectedDateRange: state.selectedDateRange,
  customDateStart: state.customDateStart,
  customDateEnd: state.customDateEnd,
});

const normalizeSavedFilterView = (entry, fallbackIndex = 0) => {
  if (!entry || typeof entry !== 'object') return null;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return null;
  const createdAt = Number(entry.createdAt) || Date.now();
  const updatedAt = Number(entry.updatedAt) || createdAt;
  const fallbackId = `view_${createdAt}_${fallbackIndex}`;
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : fallbackId,
    name,
    filters: normalizeFilterPayload(entry.filters),
    createdAt,
    updatedAt,
  };
};

const readSavedFilterViews = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FILTER_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, index) => normalizeSavedFilterView(entry, index))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FILTER_VIEWS);
  } catch (error) {
    console.warn('[FilterViews] read failed:', error);
    return [];
  }
};

const readHistoryStreamEnabled = () => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(HISTORY_STREAM_ENABLED_KEY);
    if (raw == null) return true;
    return raw !== 'false';
  } catch (error) {
    console.warn('[HistoryStreamVisibility] read failed:', error);
    return true;
  }
};

const persistHistoryStreamEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STREAM_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('[HistoryStreamVisibility] persist failed:', error);
  }
};

const persistSavedFilterViews = (views) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FILTER_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch (error) {
    console.warn('[FilterViews] persist failed:', error);
  }
};

const itemNeedsHydration = (item) => (
  Boolean(item?.content_truncated || item?.ocr_truncated)
);

const fetchItemByIdSafe = async (id) => {
  if (!id) return null;
  try {
    return await invoke('get_item_by_id', { id });
  } catch (error) {
    console.warn('[ItemHydration] fetch failed:', error);
    return null;
  }
};

const hydrateItemIfNeeded = async (item) => {
  if (!item || !item.id || !itemNeedsHydration(item)) return item;
  const full = await fetchItemByIdSafe(item.id);
  return full || item;
};

const hydrateItemsIfNeeded = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const uniqueById = new Map();
  items.forEach((item) => {
    if (!item?.id || uniqueById.has(item.id)) return;
    uniqueById.set(item.id, item);
  });

  const hydratedById = new Map();
  await Promise.all(Array.from(uniqueById.values()).map(async (item) => {
    if (!itemNeedsHydration(item)) return;
    const full = await fetchItemByIdSafe(item.id);
    if (full?.id) hydratedById.set(full.id, full);
  }));

  return items.map(item => hydratedById.get(item.id) || item);
};

const initialHistorySnapshot = readHistorySnapshot();
// ========== Share cache helpers ==========
// Cache is stored in item.metadata as JSON: { share_cache: { [provider]: { url, expires_at } } }
const getShareCache = (item, provider) => {
  try {
    const meta = JSON.parse(item.metadata || '{}');
    const entry = meta?.share_cache?.[provider];
    if (!entry?.url || !entry?.expires_at) return null;
    if (Date.now() / 1000 > entry.expires_at) return null;
    return entry;
  } catch { return null; }
};

const saveShareCache = async (item, provider, url, ttlSeconds) => {
  try {
    const meta = JSON.parse(item.metadata || '{}');
    if (!meta.share_cache) meta.share_cache = {};
    meta.share_cache[provider] = { url, expires_at: Math.floor(Date.now() / 1000) + ttlSeconds };
    const updatedItem = {
      ...item,
      metadata: JSON.stringify(meta),
      updated_at: item.updated_at, // keep original updated_at
    };
    await invoke('update_item', { item: updatedItem });
    // Also update local item reference so subsequent calls see the cache
    item.metadata = updatedItem.metadata;
  } catch (e) {
    console.error('save share cache failed:', e);
  }
};

const useAppStore = create((set, get) => ({
  // ========== 历史数据 ==========
  items: initialHistorySnapshot,
  loading: initialHistorySnapshot.length === 0,
  hasMore: true,
  loadingMore: false,
  itemsRevision: 0,
  processedItemIds: new Set(),
  isMemorySuspended: false,

  // ========== 右栏面板状态机 ==========
  // 'collection' | 'preview' | 'timeline'
  panelMode: 'collection',
  previewItem: null,

  // ========== 时间旅行状态 ==========
  timelineDate: 'today', // 'today' | 'yesterday'
  timelineItems: [],
  timelineSummary: null,
  timelineLoading: false,
  timelineError: null,
  timelineSummaryCache: {}, // { 'today': { summary: '...', timestamp: 123456 }, 'yesterday': { summary: '...', timestamp: 123456 } }

  // ========== 搜索/筛选 ==========
  searchQuery: '',
  debouncedSearchQuery: '',
  selectedType: 'all',
  selectedTags: [],
  showFavoritesOnly: false,
  showPinnedOnly: false,
  showTagFilter: false,
  tagSearchQuery: '',
  selectedDateRange: null,
  showDateFilter: false,
  customDateStart: '',
  customDateEnd: '',
  savedFilterViews: readSavedFilterViews(),
  activeFilterViewId: null,

  // ========== 多选状态 ==========
  selectedItemIds: [],

  // ========== keyboard focus ==========
  focusedIndex: -1,

  // ========== UI 状态 ==========
  copiedItemId: null,
  copyFeedbackSource: null,
  copyFeedbackToken: 0,
  generatingAI: null,
  ocrProcessing: null,
  showSettings: false,
  settingsInitialTab: null,
  isAlwaysOnTop: false,
  isMiniMode: false,
  pinBeforeMini: false,
  collectionPanelBeforeMini: null,

  // ========== 配置 ==========
  aiEnabled: false,
  ocrEnabled: false,
  licenseStatus: 'Free',
  isProUser: false,
  maxPinnedItems: 10,
  themeMode: 'system',
  isLocked: true,
  hasPassword: false,
  collectionPanelEnabled: true,
  historyStreamEnabled: readHistoryStreamEnabled(),
  lowMemoryModeEnabled: false,
  autoPasteOnDoubleClick: false,
  lastCopyWasAutoPaste: false,
  widgetEnabled: false,
  historyTagShortcutEnabled: true,

  // ========== 悬浮预览 ==========
  hoverPreviewItem: null,
  hoverPreviewPosition: null,

  // ========== 备注编辑 ==========
  editingNoteId: null,
  editNote: '',

  // ========== 标签管理 ==========
  addingTagItemId: null,
  newTagInput: '',

  // ========== 编辑弹窗 ==========
  showEditModal: false,
  editModalMode: 'new',
  editingItem: null,

  // ========== Guided Tour ==========
  tourActive: false,
  tourStep: 0,

  // ========== 分享 ==========
  shareModalItem: null,
  shareResult: null,
  shareLoading: false,
  shareError: null,
  sharePendingConfirm: false,
  sharePendingData: null,
  sharePendingProvider: null,
  shareConfig: null,
  // ========== 面板 Actions ==========
  setPanelMode: (mode, item = null) => {
    if (mode === 'preview' && item) {
      set({ panelMode: 'preview', previewItem: item, timelineItems: [], timelineSummary: null });
      if (itemNeedsHydration(item)) {
        const targetId = item.id;
        hydrateItemIfNeeded(item)
          .then((fullItem) => {
            if (!fullItem?.id || fullItem.id !== targetId) return;
            set((state) => {
              if (state.panelMode !== 'preview' || state.previewItem?.id !== targetId) return {};
              return { previewItem: fullItem };
            });
          })
          .catch((error) => {
            console.warn('[ItemHydration] preview hydration failed:', error);
          });
      }
    } else if (mode === 'timeline') {
      set({ panelMode: 'timeline', previewItem: null });
      // Auto-load timeline data when entering timeline mode
      get().loadTimelineData('today');
    } else {
      set({ panelMode: 'collection', previewItem: null, timelineItems: [], timelineSummary: null });
    }
  },

  switchToCollection: () => {
    set({ panelMode: 'collection', previewItem: null });
  },

  // ========== 时间旅行 Actions ==========
  loadTimelineData: async (date) => {
    set({ timelineLoading: true, timelineError: null, timelineDate: date });
    try {
      const now = new Date();
      let startTimestamp, endTimestamp;

      if (date === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startTimestamp = Math.floor(startOfDay.getTime() / 1000);
        endTimestamp = Math.floor(Date.now() / 1000);
      } else if (date === 'yesterday') {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        const endOfYesterday = new Date(startOfYesterday.getTime() + 24 * 60 * 60 * 1000);
        startTimestamp = Math.floor(startOfYesterday.getTime() / 1000);
        endTimestamp = Math.floor(endOfYesterday.getTime() / 1000);
      }

      const items = await invoke('get_items_by_date_range', {
        startTimestamp,
        endTimestamp,
      });

      set({ timelineItems: items, timelineLoading: false });

      // Auto-generate AI summary if AI is enabled
      const { aiEnabled, timelineDate, timelineSummaryCache } = get();
      if (aiEnabled && items.length > 0) {
        // Check cache
        const cached = timelineSummaryCache[date];
        const now = Date.now();
        const CACHE_DURATION = date === 'yesterday' ? Infinity : 30 * 60 * 1000; // yesterday: forever, today: 30 minutes

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          console.log('[Timeline] Using cached summary for', date);
          set({ timelineSummary: cached.summary });
        } else {
          console.log('[Timeline] Cache miss or expired, generating new summary for', date);
          get().generateTimelineSummary(items, date);
        }
      }
    } catch (error) {
      console.error('load timeline data failed:', error);
      set({ timelineError: String(error), timelineLoading: false });
    }
  },

  generateTimelineSummary: async (items, date) => {
    set({ timelineSummary: null });
    try {
      console.log('[Timeline] Generating AI summary for', items.length, 'items');
      const summary = await invoke('generate_timeline_summary', { items });
      console.log('[Timeline] AI summary generated:', summary);

      // Update cache
      const now = Date.now();
      set((state) => ({
        timelineSummary: summary,
        timelineSummaryCache: {
          ...state.timelineSummaryCache,
          [date]: { summary, timestamp: now }
        }
      }));
    } catch (error) {
      console.error('generate timeline summary failed:', error);
      set({ timelineSummary: null });
    }
  },

  switchTimelineDate: (date) => {
    get().loadTimelineData(date);
  },

  // ========== 收集箱面板开关 ==========
  setCollectionPanelEnabled: (v) => {
    const nextPanelEnabled = Boolean(v);
    const updates = { collectionPanelEnabled: nextPanelEnabled };
    if (!nextPanelEnabled) {
      Object.assign(updates, { hoverPreviewItem: null, hoverPreviewPosition: null });
    }
    set(updates);
  },

  toggleCollectionPanel: async () => {
    const next = !get().collectionPanelEnabled;
    get().setCollectionPanelEnabled(next);
    try {
      const generalConfig = await invoke('get_general_config');
      await invoke('update_general_config', {
        config: { ...generalConfig, collection_panel_enabled: next },
      });
    } catch (error) {
      console.error('persist collection_panel_enabled failed:', error);
    }
  },

  setHistoryStreamEnabled: (v) => {
    const next = Boolean(v);
    const state = get();
    if (state.isMiniMode && !next) {
      return;
    }
    const updates = { historyStreamEnabled: next };
    if (!next && !state.collectionPanelEnabled) {
      updates.collectionPanelEnabled = true;
    }
    set(updates);
    persistHistoryStreamEnabled(next);
  },

  toggleHistoryStream: () => {
    const state = get();
    if (state.isMiniMode) return;
    const visibleNow = state.historyStreamEnabled || !state.collectionPanelEnabled;
    get().setHistoryStreamEnabled(!visibleNow);
  },

  setHoverPreview: (item, position) => {
    set({ hoverPreviewItem: item, hoverPreviewPosition: position });
  },

  clearHoverPreview: () => {
    set({ hoverPreviewItem: null, hoverPreviewPosition: null });
  },

  // ========== 数据加载 Actions ==========
  loadItems: async () => {
    const requestSeq = ++loadItemsRequestSeq;
    console.log('[Perf:Store] loadItems START at', performance.now().toFixed(1), 'ms');
    try {
      const pageSize = getItemsPageSize(get().lowMemoryModeEnabled);
      console.log('[Perf:Store] Calling getRecentItemsLight at', performance.now().toFixed(1), 'ms');
      const result = await getRecentItemsLight(pageSize);
      console.log('[Perf:Store] getRecentItemsLight returned', result.length, 'items at', performance.now().toFixed(1), 'ms');
      if (requestSeq !== loadItemsRequestSeq) {
        console.log('[Perf:Store] drop stale loadItems result before merge', { requestSeq, latest: loadItemsRequestSeq });
        return;
      }

      const { loading, processedItemIds } = get();
      const mergedItems = mergeUniqueById([], result);

      console.log('[Perf:Store] Setting items state at', performance.now().toFixed(1), 'ms');
      set((state) => ({
        items: mergedItems,
        hasMore: result.length >= pageSize,
        itemsRevision: state.itemsRevision + 1,
      }));
      persistHistorySnapshot(mergedItems);

      logItemsMemoryProbe('loadItems', mergedItems, {
        fetched: result.length,
        pageSize,
      });

      console.log('[Perf:Store] Calling detectAndUpdateCodeLanguage at', performance.now().toFixed(1), 'ms');
      detectAndUpdateCodeLanguage(mergedItems, (id, lang) => {
        if (requestSeq !== loadItemsRequestSeq) return;
        set((state) => ({
          items: state.items.map((it) =>
            it.id === id ? { ...it, code_language: lang } : it
          ),
        }));
      });

      if (!loading && get().aiEnabled) {
        if (requestSeq !== loadItemsRequestSeq) return;
        console.log('[Perf:Store] Calling autoGenerateAITagsSvc at', performance.now().toFixed(1), 'ms');
        autoGenerateAITagsSvc(result, processedItemIds, (updater) => {
          if (requestSeq !== loadItemsRequestSeq) return;
          const current = get().processedItemIds;
          const next = typeof updater === 'function' ? updater(current) : updater;
          set({ processedItemIds: next });
        });
      }

      if (loading && requestSeq === loadItemsRequestSeq) {
        console.log('[Perf:Store] Setting loading=false at', performance.now().toFixed(1), 'ms');
        set({ loading: false });
      }

      console.log('[Perf:Store] loadItems COMPLETE at', performance.now().toFixed(1), 'ms');
    } catch (error) {
      if (requestSeq !== loadItemsRequestSeq) return;
      console.error('[Perf:Store] loadItems ERROR at', performance.now().toFixed(1), 'ms:', error);
      if (get().loading) set({ loading: false });
    }
  },

  loadMore: async () => {
    const { hasMore, loadingMore, items, itemsRevision, lowMemoryModeEnabled } = get();
    if (!hasMore || loadingMore) return;
    set({ loadingMore: true });
    const requestOffset = items.length;
    const requestRevision = itemsRevision;
    const pageSize = getItemsPageSize(lowMemoryModeEnabled);
    const memoryCap = getItemsMemoryCap(lowMemoryModeEnabled);
    try {
      const more = await getMoreItems(pageSize, requestOffset);
      if (get().itemsRevision !== requestRevision) return;
      let mergedItemsSnapshot = null;
      set((state) => {
        let merged = mergeUniqueById(state.items, more);
        if (merged.length > memoryCap) {
          merged = merged.slice(0, memoryCap);
        }
        mergedItemsSnapshot = merged;
        return {
          items: merged,
          hasMore: more.length >= pageSize && merged.length < memoryCap,
        };
      });
      if (mergedItemsSnapshot) {
        persistHistorySnapshot(mergedItemsSnapshot);
        logItemsMemoryProbe('loadMore', mergedItemsSnapshot, {
          fetched: more.length,
          offset: requestOffset,
          pageSize,
          hasMoreAfter: more.length >= pageSize,
          memoryCap,
        });
      }
      detectAndUpdateCodeLanguage(more, (id, lang) => {
        set((state) => ({
          items: state.items.map((it) =>
            it.id === id ? { ...it, code_language: lang } : it
          ),
        }));
      });
    } catch (error) {
      console.error('加载更多失败:', error);
    } finally {
      set({ loadingMore: false });
    }
  },

  suspendForMinimize: () => {
    const state = get();
    if (state.isMemorySuspended) return;
    persistHistorySnapshot(state.items);

    set({
      items: [],
      hasMore: true,
      loadingMore: false,
      itemsRevision: state.itemsRevision + 1,
      processedItemIds: new Set(),
      panelMode: 'collection',
      previewItem: null,
      isMemorySuspended: true,
    });
    console.log('[MemorySuspend] detached heavy list state while minimized');
  },

  resumeFromMinimize: async () => {
    const state = get();
    if (!state.isMemorySuspended) return;

    const snapshot = readHistorySnapshot();
    set({
      isMemorySuspended: false,
      items: snapshot,
      hasMore: true,
      loadingMore: false,
      loading: snapshot.length === 0,
    });
    console.log('[MemorySuspend] restoring list state after window became visible');
    await get().loadItems();
  },

  loadConfigs: async () => {
    try {
      const [aiConfig, ocrConfig, generalConfig, hasLock, licenseInfo] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_general_config'),
        invoke('has_lock_password'),
        invoke('get_license_info'),
      ]);
      const licenseStatus = licenseInfo?.status || 'Free';
      set((state) => ({
        aiEnabled: aiConfig.enabled || false,
        ocrEnabled: ocrConfig.enabled || false,
        licenseStatus,
        isProUser: licenseStatus === 'Active',
        maxPinnedItems: generalConfig.max_pinned_items || 10,
        hasPassword: hasLock,
        isLocked: hasLock ? (state.hasPassword ? state.isLocked : true) : false,
        collectionPanelEnabled: generalConfig.collection_panel_enabled !== false,
        lowMemoryModeEnabled: generalConfig.low_memory_mode_enabled || false,
        autoPasteOnDoubleClick: SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK
          && (generalConfig.auto_paste_on_double_click || false),
        widgetEnabled: generalConfig.widget_enabled || false,
        historyTagShortcutEnabled: generalConfig.history_tag_shortcut_enabled !== false,
      }));
      if (generalConfig.theme_mode) {
        set({ themeMode: generalConfig.theme_mode });
      }
      // apply accent color
      const { applyAccentColor } = await import('../hooks/useTheme');
      applyAccentColor(generalConfig.accent_color || 'blue');
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  },

  // ========== 剪贴板操作 ==========
  handleCopy: async (item, source = 'global') => {
    const feedbackSource = normalizeCopyFeedbackSource(source);
    try {
      const itemForCopy = await hydrateItemIfNeeded(item);
      await copyItemToClipboard(itemForCopy);
      let feedbackToken = null;
      set((state) => {
        feedbackToken = state.copyFeedbackToken + 1;
        return {
          copiedItemId: itemForCopy.id,
          copyFeedbackSource: feedbackSource,
          copyFeedbackToken: feedbackToken,
          lastCopyWasAutoPaste: false,
        };
      });
      setTimeout(() => {
        set((state) => {
          if (state.copyFeedbackToken !== feedbackToken) return {};
          return {
            copiedItemId: null,
            copyFeedbackSource: null,
            lastCopyWasAutoPaste: false,
          };
        });
      }, 1000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  },

  handleCopyAndAutoPaste: async (item, source = 'global') => {
    const feedbackSource = normalizeCopyFeedbackSource(source);
    try {
      const itemForCopy = await hydrateItemIfNeeded(item);
      await copyItemToClipboard(itemForCopy);
      let copiedToken = null;
      set((state) => {
        copiedToken = state.copyFeedbackToken + 1;
        return {
          copiedItemId: itemForCopy.id,
          copyFeedbackSource: feedbackSource,
          copyFeedbackToken: copiedToken,
          lastCopyWasAutoPaste: false,
        };
      });
      setTimeout(() => {
        set((state) => {
          if (state.copyFeedbackToken !== copiedToken) return {};
          return {
            copiedItemId: null,
            copyFeedbackSource: null,
            lastCopyWasAutoPaste: false,
          };
        });
      }, 1000);

      if (!SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK || !get().autoPasteOnDoubleClick) {
        return;
      }

      // Only auto-paste for text/html/link types, skip image/file
      if (itemForCopy.type_ === 'image' || itemForCopy.type_ === 'file') {
        return;
      }

      try {
        const pasted = await invoke('try_paste_foreground');
        if (pasted) {
          let pastedToken = null;
          set((state) => {
            pastedToken = state.copyFeedbackToken + 1;
            return {
              copiedItemId: itemForCopy.id,
              copyFeedbackSource: feedbackSource,
              copyFeedbackToken: pastedToken,
              lastCopyWasAutoPaste: true,
            };
          });
          setTimeout(() => {
            set((state) => {
              if (state.copyFeedbackToken !== pastedToken) return {};
              return {
                copiedItemId: null,
                copyFeedbackSource: null,
                lastCopyWasAutoPaste: false,
              };
            });
          }, 1500);
        } else {
          console.info('[AutoPaste] Platform not implemented, copied only');
        }
      } catch (error) {
        console.warn('[AutoPaste] Paste simulation failed, copied only:', error);
      }
    } catch (error) {
      console.error('copy/auto-paste failed:', error);
    }
  },

  handleCopyPlainText: async (text, source = 'global') => {
    const feedbackSource = normalizeCopyFeedbackSource(source);
    try {
      await invoke('copy_plain_text', { text });
      let feedbackToken = null;
      set((state) => {
        feedbackToken = state.copyFeedbackToken + 1;
        return {
          copiedItemId: 'plain-text',
          copyFeedbackSource: feedbackSource,
          copyFeedbackToken: feedbackToken,
          lastCopyWasAutoPaste: false,
        };
      });
      setTimeout(() => {
        set((state) => {
          if (state.copyFeedbackToken !== feedbackToken) return {};
          return {
            copiedItemId: null,
            copyFeedbackSource: null,
          };
        });
      }, 1000);
    } catch (error) {
      console.error('复制纯文本失败:', error);
    }
  },

  togglePin: async (item) => {
    try {
      const { maxPinnedItems } = get();
      const nextPinnedState = await invoke('toggle_pin_item', { id: item.id, maxPinned: maxPinnedItems });
      const now = Math.floor(Date.now() / 1000);

      set((state) => {
        let items = state.items;
        const unpinnedByLimitIds = new Set();

        if (nextPinnedState === true) {
          const alreadyPinned = state.items.filter((it) => it.is_pinned && it.id !== item.id);
          const overflow = alreadyPinned.length + 1 - maxPinnedItems;
          if (overflow > 0) {
            const oldestPinned = [...alreadyPinned]
              .sort((a, b) => {
                const aPinnedAt = a.pinned_at || 0;
                const bPinnedAt = b.pinned_at || 0;
                if (aPinnedAt !== bPinnedAt) return aPinnedAt - bPinnedAt;
                return a.created_at - b.created_at;
              })
              .slice(0, overflow);
            oldestPinned.forEach((it) => unpinnedByLimitIds.add(it.id));
          }
        }

        items = items.map((it) => {
          if (it.id === item.id) {
            return {
              ...it,
              is_pinned: nextPinnedState,
              pinned_at: nextPinnedState ? now : null,
              updated_at: now,
            };
          }

          if (unpinnedByLimitIds.has(it.id)) {
            return {
              ...it,
              is_pinned: false,
              pinned_at: null,
              updated_at: now,
            };
          }

          return it;
        });

        let previewItem = state.previewItem;
        if (previewItem?.id === item.id) {
          previewItem = {
            ...previewItem,
            is_pinned: nextPinnedState,
            pinned_at: nextPinnedState ? now : null,
            updated_at: now,
          };
        } else if (previewItem && unpinnedByLimitIds.has(previewItem.id)) {
          previewItem = {
            ...previewItem,
            is_pinned: false,
            pinned_at: null,
            updated_at: now,
          };
        }

        return {
          items,
          previewItem,
          itemsRevision: state.itemsRevision + 1,
        };
      });
    } catch (error) {
      console.error('toggle pin failed:', error);
    }
  },

  toggleFavorite: async (item) => {
    try {
      await invoke('toggle_favorite_item', { id: item.id });
      const newFavorite = !item.is_favorite;
      set((state) => ({
        items: state.items.map((it) =>
          it.id === item.id ? { ...it, is_favorite: newFavorite } : it
        ),
        previewItem: state.previewItem?.id === item.id
          ? { ...state.previewItem, is_favorite: newFavorite }
          : state.previewItem,
      }));
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  },

  generateAITags: async (item) => {
    const itemForAI = await hydrateItemIfNeeded(item);
    if (!itemForAI?.content) return;
    set({ generatingAI: itemForAI.id });
    try {
      await generateAITagsForItem(itemForAI);
      await get().loadItems();
    } catch (error) {
      console.error('AI 标签生成失败:', error);
    } finally {
      set({ generatingAI: null });
    }
  },
  handleOCR: async (item) => {
    if (!item.image_paths) return;
    set({ ocrProcessing: item.id });
    try {
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw || paths.original;
      await invoke('recognize_and_update', { itemId: item.id, imagePath });
      await get().loadItems();
    } catch (error) {
      console.error('OCR 识别失败:', error);
    } finally {
      set({ ocrProcessing: null });
    }
  },

  handleOpenItem: async (item) => {
    try {
      await invoke('open_item', { id: item.id });
    } catch (error) {
      console.error('打开失败:', error);
    }
  },

  handleRevealInFolder: async (item) => {
    try {
      await invoke('reveal_in_folder', { id: item.id });
    } catch (error) {
      console.error('reveal in folder failed:', error);
    }
  },

  handleOpenUrl: async (url) => {
    if (!url) return;
    try {
      await invoke('open_url', { url });
    } catch (error) {
      console.error('open url failed:', error);
    }
  },

  handleSaveImageAs: async (item) => {
    if (!item || item.type_ !== 'image') return;
    try {
      await invoke('save_image_as', { id: item.id });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || '');
      if (message !== 'CANCELLED') {
        console.error('save image as failed:', error);
      }
    }
  },

  setCardBackground: async (item, backgroundId) => {
    if (!item?.id) return;
    const nextBackgroundId = normalizeCardBackgroundId(backgroundId);
    const currentBackgroundId = getCardBackgroundIdFromMetadata(item.metadata);
    if (nextBackgroundId === currentBackgroundId) return;

    const updatedAt = Math.floor(Date.now() / 1000);
    const nextMetadata = withCardBackgroundInMetadata(item.metadata, nextBackgroundId);
    const updatedItem = {
      ...item,
      metadata: nextMetadata,
      updated_at: updatedAt,
    };

    try {
      await invoke('update_item', { item: updatedItem });
      set((state) => {
        const nextItems = state.items.map((it) => {
          if (it.id !== item.id) return it;
          return {
            ...it,
            metadata: nextMetadata,
            updated_at: updatedAt,
          };
        });
        const nextPreviewItem = state.previewItem?.id === item.id
          ? {
            ...state.previewItem,
            metadata: nextMetadata,
            updated_at: updatedAt,
          }
          : state.previewItem;
        return {
          items: nextItems,
          previewItem: nextPreviewItem,
          itemsRevision: state.itemsRevision + 1,
        };
      });
    } catch (error) {
      console.error('set card background failed:', error);
    }
  },

  deleteItem: async (item) => {
    try {
      await deleteItemSvc(item.id);
      const { items } = get();
      set({
        items: items.filter(i => i.id !== item.id),
        panelMode: 'collection',
        previewItem: null,
      });
    } catch (error) {
      console.error('删除失败:', error);
    }
  },

  setFocusedIndex: (index) => set({ focusedIndex: index }),

  // ========== 备注 Actions ==========
  startEditNote: (item) => {
    set({ editingNoteId: item.id, editNote: item.user_note || '' });
  },

  saveNote: async (item) => {
    try {
      const { editNote, loadItems } = get();
      const updatedItem = {
        ...item,
        user_note: editNote,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      set({ editingNoteId: null, editNote: '' });
    } catch (error) {
      console.error('保存备注失败:', error);
    }
  },

  cancelNoteEdit: () => {
    set({ editingNoteId: null, editNote: '' });
  },

  // ========== 标签 Actions ==========
  startAddTag: (item) => {
    set({ addingTagItemId: item.id, newTagInput: '' });
  },

  cancelAddTag: () => {
    set({ addingTagItemId: null, newTagInput: '' });
  },

  addTagToItem: async (item, tagToAdd) => {
    try {
      const existingTags = getTags(item.tags);
      if (existingTags.includes(tagToAdd)) {
        get().cancelAddTag();
        return;
      }
      const newTags = [...existingTags, tagToAdd];
      const updatedItem = {
        ...item,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await get().loadItems();
      get().cancelAddTag();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  },

  // ========== 多选 Actions ==========
  setSelectedItemIds: (itemIds) => {
    if (!Array.isArray(itemIds)) {
      set({ selectedItemIds: [] });
      return;
    }
    const normalized = Array.from(new Set(itemIds.filter(Boolean)));
    set({ selectedItemIds: normalized });
  },

  toggleSelectItem: (itemId) => {
    const { selectedItemIds } = get();
    if (selectedItemIds.includes(itemId)) {
      set({ selectedItemIds: selectedItemIds.filter(id => id !== itemId) });
    } else {
      set({ selectedItemIds: [...selectedItemIds, itemId] });
    }
  },

  clearSelection: () => {
    set({ selectedItemIds: [] });
  },

  addTagToSelectedItems: async (tagToAdd, sourceItems = null) => {
    const normalizedTag = typeof tagToAdd === 'string' ? tagToAdd.trim() : '';
    if (!normalizedTag) {
      return { ok: false, reason: 'empty-tag' };
    }

    if (hasReservedTagPrefix(normalizedTag)) {
      return { ok: false, reason: 'reserved-prefix' };
    }

    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) {
      return { ok: false, reason: 'empty-selection' };
    }

    const preferredItems = Array.isArray(sourceItems) && sourceItems.length > 0 ? sourceItems : items;
    const preferredById = new Map(preferredItems.map(item => [item.id, item]));
    const fallbackById = new Map(items.map(item => [item.id, item]));
    const selectedItems = selectedItemIds
      .map(id => preferredById.get(id) || fallbackById.get(id))
      .filter(Boolean);

    if (selectedItems.length === 0) {
      return { ok: false, reason: 'items-not-found' };
    }

    const updatedAt = Math.floor(Date.now() / 1000);
    const settledResults = await Promise.allSettled(selectedItems.map(async (item) => {
      const existingTags = getTags(item.tags);
      if (existingTags.includes(normalizedTag)) {
        return { id: item.id, changed: false };
      }

      const tags = JSON.stringify([...existingTags, normalizedTag]);
      const updatedItem = {
        ...item,
        tags,
        updated_at: updatedAt,
      };
      await invoke('update_item', { item: updatedItem });
      return { id: item.id, changed: true, tags, updated_at: updatedAt };
    }));

    const updates = [];
    let updatedCount = 0;
    let unchangedCount = 0;
    let failedCount = 0;
    let firstError = null;

    settledResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        if (result.value.changed) {
          updatedCount += 1;
          updates.push(result.value);
        } else {
          unchangedCount += 1;
        }
      } else {
        failedCount += 1;
        if (!firstError) firstError = result.reason;
      }
    });

    if (updates.length > 0) {
      const updatesById = new Map(updates.map(update => [update.id, update]));
      set((state) => {
        const nextItems = state.items.map((item) => {
          const updated = updatesById.get(item.id);
          if (!updated) return item;
          return {
            ...item,
            tags: updated.tags,
            updated_at: updated.updated_at,
          };
        });

        const nextPreviewItem = state.previewItem && updatesById.has(state.previewItem.id)
          ? {
            ...state.previewItem,
            tags: updatesById.get(state.previewItem.id).tags,
            updated_at: updatesById.get(state.previewItem.id).updated_at,
          }
          : state.previewItem;

        return {
          items: nextItems,
          previewItem: nextPreviewItem,
          itemsRevision: state.itemsRevision + 1,
        };
      });
    }

    return {
      ok: true,
      tag: normalizedTag,
      updatedCount,
      unchangedCount,
      failedCount,
      updates,
      error: firstError ? String(firstError) : null,
    };
  },

  deleteSelectedItems: async () => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return;
    try {
      for (const id of selectedItemIds) {
        await deleteItemSvc(id);
      }
      set({
        items: items.filter(i => !selectedItemIds.includes(i.id)),
        selectedItemIds: [],
        panelMode: 'collection',
        previewItem: null,
      });
    } catch (error) {
      console.error('batch delete failed:', error);
    }
  },

  copySelectedItemsMerged: async (sourceItems = null) => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return;
    try {
      const preferredItems = Array.isArray(sourceItems) && sourceItems.length > 0 ? sourceItems : items;
      const preferredById = new Map(preferredItems.map(item => [item.id, item]));
      const fallbackById = new Map(items.map(item => [item.id, item]));
      const selectedItems = selectedItemIds
        .map(id => preferredById.get(id) || fallbackById.get(id))
        .filter(Boolean);
      const hydratedSelectedItems = await hydrateItemsIfNeeded(selectedItems);
      const merged = hydratedSelectedItems
        .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
        .filter(Boolean)
        .join('\n');
      if (!merged) return;
      await invoke('copy_plain_text', { text: merged });
      let feedbackToken = null;
      set((state) => {
        feedbackToken = state.copyFeedbackToken + 1;
        return {
          copiedItemId: 'merge-success',
          copyFeedbackSource: 'history',
          copyFeedbackToken: feedbackToken,
          selectedItemIds: [],
          lastCopyWasAutoPaste: false,
        };
      });
      setTimeout(() => {
        set((state) => {
          if (state.copyFeedbackToken !== feedbackToken) return {};
          return { copiedItemId: null, copyFeedbackSource: null };
        });
      }, 1000);
    } catch (error) {
      console.error('merge copy failed:', error);
    }
  },

  // ========== 筛选 Actions ==========
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedType: (t) => set({ selectedType: t }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setShowFavoritesOnly: (v) => set({ showFavoritesOnly: v }),
  setShowPinnedOnly: (v) => set({ showPinnedOnly: v }),
  setShowTagFilter: (v) => set({ showTagFilter: v }),
  setTagSearchQuery: (q) => set({ tagSearchQuery: q }),
  setSelectedDateRange: (range) => set({ selectedDateRange: range }),
  setShowDateFilter: (v) => set({ showDateFilter: v }),
  setCustomDateStart: (v) => set({ customDateStart: v }),
  setCustomDateEnd: (v) => set({ customDateEnd: v }),
  clearDateFilter: () => set({ selectedDateRange: null, customDateStart: '', customDateEnd: '', showDateFilter: false }),
  setActiveFilterViewId: (id) => set({ activeFilterViewId: id || null }),
  clearActiveFilterView: () => set({ activeFilterViewId: null }),

  saveCurrentFilterView: (name) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return { ok: false, reason: 'empty-name' };
    }

    const now = Date.now();
    let savedId = null;
    set((state) => {
      const snapshot = buildFilterPayloadFromState(state);
      const existingIndex = state.savedFilterViews.findIndex(
        view => view.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      let nextViews;
      if (existingIndex >= 0) {
        const existing = state.savedFilterViews[existingIndex];
        savedId = existing.id;
        const updated = {
          ...existing,
          name: trimmedName,
          filters: snapshot,
          updatedAt: now,
        };
        nextViews = [
          updated,
          ...state.savedFilterViews.filter((_, idx) => idx !== existingIndex),
        ];
      } else {
        savedId = `view_${now}_${Math.random().toString(36).slice(2, 8)}`;
        nextViews = [
          {
            id: savedId,
            name: trimmedName,
            filters: snapshot,
            createdAt: now,
            updatedAt: now,
          },
          ...state.savedFilterViews,
        ];
      }

      nextViews = nextViews.slice(0, MAX_FILTER_VIEWS);
      persistSavedFilterViews(nextViews);
      return {
        savedFilterViews: nextViews,
        activeFilterViewId: savedId,
      };
    });

    return { ok: true, id: savedId };
  },

  applySavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const { savedFilterViews } = get();
    const target = savedFilterViews.find(view => view.id === targetId);
    if (!target) return false;

    const payload = normalizeFilterPayload(target.filters);
    set({
      ...payload,
      showTagFilter: false,
      tagSearchQuery: '',
      showDateFilter: false,
      activeFilterViewId: target.id,
    });
    return true;
  },

  deleteSavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;

    set((state) => {
      const nextViews = state.savedFilterViews.filter(view => view.id !== targetId);
      if (nextViews.length === state.savedFilterViews.length) return {};
      persistSavedFilterViews(nextViews);
      return {
        savedFilterViews: nextViews,
        activeFilterViewId: state.activeFilterViewId === targetId ? null : state.activeFilterViewId,
      };
    });
  },

  toggleTagFilter: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter(t => t !== tag)
        : [...selectedTags, tag]
    });
  },

  handleTagClick: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter(t => t !== tag)
        : [...selectedTags, tag]
    });
  },

  // ========== 编辑弹窗 Actions ==========
  openEditModal: (item = null) => {
    if (item) {
      set({ editModalMode: 'edit', editingItem: item, showEditModal: true });
      if (itemNeedsHydration(item)) {
        const editingId = item.id;
        hydrateItemIfNeeded(item)
          .then((fullItem) => {
            if (!fullItem?.id || fullItem.id !== editingId) return;
            set((state) => {
              if (!state.showEditModal || state.editModalMode !== 'edit' || state.editingItem?.id !== editingId) return {};
              return { editingItem: fullItem };
            });
          })
          .catch((error) => {
            console.warn('[ItemHydration] edit hydration failed:', error);
          });
      }
    } else {
      set({ editModalMode: 'new', editingItem: null, showEditModal: true });
    }
  },

  handleEditModalSave: async (data) => {
    const { editModalMode, editingItem, loadItems } = get();
    try {
      if (editModalMode === 'new') {
        await invoke('add_clipboard_item_manual', {
          content: data.content,
          contentType: 'text',
          source: MANUAL_ENTRY_SOURCE,
          autoFavorite: false
        });
        if (data.tags.length > 0 || data.note) {
          await loadItems();
          const newItems = await invoke('get_recent_items', { limit: 100 });
          const newItem = newItems[0];
          if (newItem) {
            const updatedItem = {
              ...newItem,
              user_note: data.note,
              tags: JSON.stringify(data.tags),
              updated_at: Math.floor(Date.now() / 1000)
            };
            await invoke('update_item', { item: updatedItem });
          }
        }
      } else {
        const nextContent = data.content ?? editingItem.content;
        const contentUpdated = nextContent !== editingItem.content;
        const updatedItem = {
          ...editingItem,
          content: nextContent,
          content_updated: contentUpdated,
          user_note: data.note,
          tags: JSON.stringify(data.tags),
          updated_at: Math.floor(Date.now() / 1000)
        };
        await invoke('update_item', { item: updatedItem });
      }
      await loadItems();
      set({ showEditModal: false, editingItem: null });
    } catch (error) {
      console.error('保存失败:', error);
    }
  },

  handleEditModalCancel: () => {
    set({ showEditModal: false, editingItem: null });
  },

  // ========== share Actions ==========
  openShareModal: async (item) => {
    set({ shareModalItem: item, shareResult: null, shareLoading: true, shareError: null, sharePendingConfirm: false, sharePendingData: null, sharePendingProvider: null, shareConfig: null });
    try {
      const config = await invoke('get_share_config');

      if (config.provider === 'S3') {
        // S3: user's own storage, upload directly
        const cached = getShareCache(item, 'S3');
        if (cached) {
          const qrCode = await invoke('generate_qr', { text: cached.url });
          set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
          return;
        }
        const result = await invoke('share_via_s3', { itemId: item.id });
        if (result.url) await saveShareCache(item, 'S3', result.url, 365 * 24 * 3600);
        set({ shareResult: result, shareLoading: false });
        return;
      }

      // Step 1: get item data (may return LocalQr directly)
      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false });
        return;
      }

      // NeedUpload: pause and show confirmation
      const provider = FREE_PROVIDERS[config.provider];
      if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

      // Check cache first
      const cached = getShareCache(item, config.provider);
      if (cached) {
        const qrCode = await invoke('generate_qr', { text: cached.url });
        set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
        return;
      }

      // Show confirmation step
      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        sharePendingProvider: config.provider,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },

  confirmShareUpload: async (providerName) => {
    const { shareModalItem: item, sharePendingData: itemData } = get();
    if (!item || !itemData) return;

    const provider = FREE_PROVIDERS[providerName];
    if (!provider) {
      set({ shareError: `Unknown provider: ${providerName}`, sharePendingConfirm: false });
      return;
    }

    set({ sharePendingConfirm: false, shareLoading: true, shareError: null, sharePendingProvider: providerName });

    try {
      const resp = await invoke('upload_to_free_host', {
        url: provider.url,
        fileField: provider.fileField,
        fileDataBase64: itemData.data_base64,
        filename: itemData.filename,
        extraFields: provider.extraFields,
      });

      const downloadUrl = provider.parseResponse(resp.status_code, resp.body);
      const qrCode = await invoke('generate_qr', { text: downloadUrl });
      await saveShareCache(item, providerName, downloadUrl, provider.ttlSeconds);

      set({
        shareResult: { method: 'CloudUpload', qr_code: qrCode, url: downloadUrl },
        shareLoading: false,
      });
    } catch (error) {
      // Upload failed: go back to confirmation so user can switch provider
      set({
        shareError: String(error),
        shareLoading: false,
        sharePendingConfirm: true,
      });
    }
  },

  switchShareProvider: (providerName) => {
    set({ sharePendingProvider: providerName, shareError: null });
  },

  closeShareModal: () => {
    set({ shareModalItem: null, shareResult: null, shareLoading: false, shareError: null, sharePendingConfirm: false, sharePendingData: null, sharePendingProvider: null, shareConfig: null });
  },

  retryShare: async () => {
    const { shareModalItem: item, sharePendingProvider: providerName, sharePendingData } = get();
    if (!item) return;

    // If we have pending data and a provider, go back to confirmation
    if (sharePendingData) {
      set({ shareResult: null, shareError: null, sharePendingConfirm: true, shareLoading: false });
      return;
    }

    // Otherwise full retry
    set({ shareResult: null, shareLoading: true, shareError: null });
    try {
      const config = await invoke('get_share_config');

      if (config.provider === 'S3') {
        const result = await invoke('share_via_s3', { itemId: item.id });
        if (result.url) await saveShareCache(item, 'S3', result.url, 365 * 24 * 3600);
        set({ shareResult: result, shareLoading: false });
        return;
      }

      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false });
        return;
      }

      const provider = FREE_PROVIDERS[config.provider];
      if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

      const cached = getShareCache(item, config.provider);
      if (cached) {
        const qrCode = await invoke('generate_qr', { text: cached.url });
        set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
        return;
      }

      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        sharePendingProvider: config.provider,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },

  // ========== UI Actions ==========
  setShowSettings: (v, tab = null) => set({ showSettings: v, settingsInitialTab: v ? tab : null }),
  setIsAlwaysOnTop: (v) => set({ isAlwaysOnTop: v }),
  setIsMiniMode: (v) => set({ isMiniMode: v }),
  setPinBeforeMini: (v) => set({ pinBeforeMini: v }),
  setCollectionPanelBeforeMini: (v) => set({ collectionPanelBeforeMini: v }),
  setIsLocked: (v) => set({ isLocked: v }),
  setThemeMode: (v) => set({ themeMode: v }),
  setEditNote: (v) => set({ editNote: v }),
  setNewTagInput: (v) => set({ newTagInput: v }),

  // ========== Guided Tour Actions ==========
  startTour: () => set({ tourActive: true, tourStep: 0, showSettings: false }),
  nextTourStep: () => set((s) => ({ tourStep: s.tourStep + 1 })),
  prevTourStep: () => set((s) => ({ tourStep: Math.max(0, s.tourStep - 1) })),
  completeTour: () => {
    set({ tourActive: false, tourStep: 0 });
    localStorage.setItem('qollect-tour-completed', 'true');
  },
  setCopiedItemId: (v, source = 'global') => set((state) => ({
    copiedItemId: v,
    copyFeedbackSource: v ? normalizeCopyFeedbackSource(source) : null,
    copyFeedbackToken: state.copyFeedbackToken + 1,
    lastCopyWasAutoPaste: false,
  })),
  setDebouncedSearchQuery: (v) => set({ debouncedSearchQuery: v }),
  resetRuntimeStateAfterDataReset: () => {
    clearHistorySnapshot();
    set((state) => ({
      items: [],
      loading: false,
      hasMore: true,
      loadingMore: false,
      itemsRevision: state.itemsRevision + 1,
      processedItemIds: new Set(),
      panelMode: 'collection',
      previewItem: null,
      hoverPreviewItem: null,
      hoverPreviewPosition: null,
      selectedItemIds: [],
      copiedItemId: null,
      copyFeedbackSource: null,
      copyFeedbackToken: state.copyFeedbackToken + 1,
      generatingAI: null,
      ocrProcessing: null,
      editingNoteId: null,
      editNote: '',
      addingTagItemId: null,
      newTagInput: '',
      showEditModal: false,
      editingItem: null,
      isMemorySuspended: false,
      hasPassword: false,
    }));
  },

  // ========== 快速笔记 (收集箱) ==========
  addQuickNote: async (content) => {
    if (!content.trim()) return;
    try {
      const { maxPinnedItems, loadItems } = get();
      // 创建新条目
      await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: QUICK_NOTE_SOURCE,
        autoFavorite: false
      });
      // 获取刚创建的条目并 pin 它
      const newItems = await invoke('get_recent_items', { limit: 1 });
      if (newItems[0]) {
        await invoke('toggle_pin_item', { id: newItems[0].id, maxPinned: maxPinnedItems });
      }
      await loadItems();
    } catch (error) {
      console.error('快速笔记添加失败:', error);
    }
  },

  // ========== 合并复制 ==========
  mergeCopyPinned: async () => {
    try {
      const { items } = get();
      const pinnedItems = items.filter(i => i.is_pinned);
      const hydratedPinnedItems = await hydrateItemsIfNeeded(pinnedItems);
      const merged = hydratedPinnedItems
        .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
        .filter(Boolean)
        .join('\n\n');
      if (merged) {
        // 构造临时 item 用于复制
        await invoke('copy_plain_text', { text: merged });
        let feedbackToken = null;
        set((state) => {
          feedbackToken = state.copyFeedbackToken + 1;
          return {
            copiedItemId: 'merge-success',
            copyFeedbackSource: 'collection',
            copyFeedbackToken: feedbackToken,
            lastCopyWasAutoPaste: false,
          };
        });
        setTimeout(() => {
          set((state) => {
            if (state.copyFeedbackToken !== feedbackToken) return {};
            return { copiedItemId: null, copyFeedbackSource: null };
          });
        }, 1000);
      }
    } catch (error) {
      console.error('合并复制失败:', error);
    }
  },

  // ========== 清空收集箱 ==========
  clearAllPinned: async () => {
    try {
      const { items, loadItems } = get();
      const pinnedItems = items.filter(i => i.is_pinned);
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      set({ panelMode: 'collection', previewItem: null });
    } catch (error) {
      console.error('清空收集箱失败:', error);
    }
  },
}));

export default useAppStore;
