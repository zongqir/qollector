import { getRecentItemsLight, getRecentItems, getMoreItems } from '../../services/clipboardService';
import { detectAndUpdateCodeLanguage } from '../../services/codeDetectionService';
import {
  getItemsMemoryCap,
  getItemsPageSize,
  logItemsMemoryProbe,
  mergeUniqueById,
} from './historyListRuntime';
import {
  persistHistorySnapshot,
} from './historySnapshot';
import { buildItemDerivations } from './itemsIndex';

let loadItemsRequestSeq = 0;

const createCodeLanguageBatchUpdater = (set) => {
  let pendingById = new Map();
  let flushTimer = null;

  const flush = () => {
    flushTimer = null;
    if (pendingById.size === 0) return;

    const updates = pendingById;
    pendingById = new Map();

    set((state) => {
      let changed = false;
      const nextItems = state.items.map((item) => {
        const nextLanguage = updates.get(item.id);
        if (!nextLanguage || item.code_language === nextLanguage) {
          return item;
        }
        changed = true;
        return {
          ...item,
          code_language: nextLanguage,
        };
      });

      if (!changed) return {};
      return {
        items: nextItems,
        ...buildItemDerivations(nextItems),
      };
    });
  };

  return (id, language) => {
    if (!id || !language) return;
    pendingById.set(id, language);
    if (flushTimer != null) return;
    flushTimer = setTimeout(flush, 0);
  };
};

export const createDataLoadingActions = (set, get) => ({
  loadItems: async () => {
    const requestSeq = ++loadItemsRequestSeq;
    console.log('[Perf:Store] loadItems START at', performance.now().toFixed(1), 'ms');
    try {
      const pageSize = getItemsPageSize();
      console.log('[Perf:Store] Calling getRecentItemsLight at', performance.now().toFixed(1), 'ms');
      let result;
      try {
        result = await getRecentItemsLight(pageSize);
      } catch (lightError) {
        console.warn('[Perf:Store] getRecentItemsLight failed, falling back to getRecentItems:', lightError);
        result = await getRecentItems(pageSize);
      }
      console.log('[Perf:Store] items returned', result.length, 'items at', performance.now().toFixed(1), 'ms');
      if (requestSeq !== loadItemsRequestSeq) {
        console.log('[Perf:Store] drop stale loadItems result before merge', { requestSeq, latest: loadItemsRequestSeq });
        return;
      }

      const { loading } = get();
      const mergedItems = mergeUniqueById([], result);

      console.log('[Perf:Store] Setting items state at', performance.now().toFixed(1), 'ms');
      set((state) => ({
        items: mergedItems,
        ...buildItemDerivations(mergedItems),
        hasMore: result.length >= pageSize,
        historyLoadStopReason: null,
        itemsRevision: state.itemsRevision + 1,
      }));
      persistHistorySnapshot(mergedItems);

      logItemsMemoryProbe('loadItems', mergedItems, {
        fetched: result.length,
        pageSize,
      });

      console.log('[Perf:Store] Calling detectAndUpdateCodeLanguage at', performance.now().toFixed(1), 'ms');
      const queueCodeLanguageUpdate = createCodeLanguageBatchUpdater(set);
      detectAndUpdateCodeLanguage(mergedItems, (id, lang) => {
        if (requestSeq !== loadItemsRequestSeq) return;
        queueCodeLanguageUpdate(id, lang);
      });

      // AI enrichment for newly-copied items is handled by backend ClipboardManager.
      // Avoid front-end list scanning auto generation here to prevent duplicate AI requests.

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
    const { hasMore, loadingMore, items, itemsRevision } = get();
    if (!hasMore || loadingMore) return;
    set({ loadingMore: true });
    const requestOffset = items.length;
    const requestRevision = itemsRevision;
    const pageSize = getItemsPageSize();
    const memoryCap = getItemsMemoryCap();
    try {
      const more = await getMoreItems(pageSize, requestOffset);
      if (get().itemsRevision !== requestRevision) return;
      let mergedItemsSnapshot = null;
      set((state) => {
        let merged = mergeUniqueById(state.items, more);
        const reachedMemoryCap = merged.length >= memoryCap && more.length >= pageSize;
        if (merged.length > memoryCap) {
          merged = merged.slice(0, memoryCap);
        }
        mergedItemsSnapshot = merged;
        return {
          items: merged,
          ...buildItemDerivations(merged),
          hasMore: more.length >= pageSize && merged.length < memoryCap,
          historyLoadStopReason: reachedMemoryCap
            ? 'memory-cap'
            : (more.length >= pageSize ? null : 'exhausted'),
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
      const queueCodeLanguageUpdate = createCodeLanguageBatchUpdater(set);
      detectAndUpdateCodeLanguage(more, (id, lang) => {
        queueCodeLanguageUpdate(id, lang);
      });
    } catch (error) {
      console.error('加载更多失败:', error);
    } finally {
      set({ loadingMore: false });
    }
  },
});
