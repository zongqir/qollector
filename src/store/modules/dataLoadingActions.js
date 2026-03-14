import { getRecentItemsLight, getMoreItems } from '../../services/clipboardService';
import { detectAndUpdateCodeLanguage } from '../../services/codeDetectionService';
import {
  getItemsMemoryCap,
  getItemsPageSize,
  logItemsMemoryProbe,
  mergeUniqueById,
} from './historyListRuntime';
import {
  persistHistorySnapshot,
  readHistorySnapshot,
} from './historySnapshot';

let loadItemsRequestSeq = 0;

export const createDataLoadingActions = (set, get) => ({
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

      const { loading } = get();
      const mergedItems = mergeUniqueById([], result);

      console.log('[Perf:Store] Setting items state at', performance.now().toFixed(1), 'ms');
      set((state) => ({
        items: mergedItems,
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
      detectAndUpdateCodeLanguage(mergedItems, (id, lang) => {
        if (requestSeq !== loadItemsRequestSeq) return;
        set((state) => ({
          items: state.items.map((it) =>
            it.id === id ? { ...it, code_language: lang } : it
          ),
        }));
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
        const reachedMemoryCap = merged.length >= memoryCap && more.length >= pageSize;
        if (merged.length > memoryCap) {
          merged = merged.slice(0, memoryCap);
        }
        mergedItemsSnapshot = merged;
        return {
          items: merged,
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
      historyLoadStopReason: null,
      itemsRevision: state.itemsRevision + 1,
      processedItemIds: new Set(),
      panelMode: 'workbench',
      previewItem: null,
      previewReturnMode: 'workbench',
      compareCandidateIds: [],
      compareItemIds: [],
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
      historyLoadStopReason: null,
      loading: snapshot.length === 0,
    });
    console.log('[MemorySuspend] restoring list state after window became visible');
    await get().loadItems();
  },
});
