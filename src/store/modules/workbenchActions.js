import { invoke } from '@tauri-apps/api/core';
import {
  createWorkbench as createWorkbenchSvc,
  deleteWorkbench as deleteWorkbenchSvc,
  getWorkbenches as getWorkbenchesSvc,
  pinItem as pinItemSvc,
  renameWorkbench as renameWorkbenchSvc,
  toggleItemPin,
} from '../../services/clipboardService';
import { QUICK_NOTE_SOURCE } from '../../utils/sourceConstants';
import { pushCopyFeedback } from './copyFeedback';
import { hydrateItemsIfNeeded } from './itemHydration';
import { getPinnedItemsForWorkbench } from './itemsIndex';
import {
  persistActiveWorkbenchId,
  persistWorkbenchSearchScope,
  WORKBENCH_SEARCH_SCOPE_ALL,
  WORKBENCH_SEARCH_SCOPE_CURRENT,
} from './workbenchState';

const normalizeWorkbenchId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

export const createWorkbenchActions = (set, get) => ({
  loadWorkbenches: async () => {
    try {
      const workbenches = await getWorkbenchesSvc();
      const normalizedList = Array.isArray(workbenches) ? workbenches : [];
      const currentActiveWorkbenchId = normalizeWorkbenchId(get().activeWorkbenchId);
      const nextActiveWorkbenchId = normalizedList.some(workbench => workbench.id === currentActiveWorkbenchId)
        ? currentActiveWorkbenchId
        : normalizeWorkbenchId(
          normalizedList.find(workbench => workbench.is_default)?.id
          || normalizedList[0]?.id,
        );

      persistActiveWorkbenchId(nextActiveWorkbenchId);
      set({
        workbenches: normalizedList,
        activeWorkbenchId: nextActiveWorkbenchId,
        workbenchStateLoaded: true,
      });
      return {
        workbenches: normalizedList,
        activeWorkbenchId: nextActiveWorkbenchId,
      };
    } catch (error) {
      console.error('加载工作台列表失败:', error);
      set({ workbenchStateLoaded: true });
      throw error;
    }
  },

  setActiveWorkbenchId: (workbenchId) => {
    const normalized = normalizeWorkbenchId(workbenchId);
    persistActiveWorkbenchId(normalized);
    set({ activeWorkbenchId: normalized });
  },

  setActiveWorkbenchSearchScope: (scope) => {
    const normalized = scope === WORKBENCH_SEARCH_SCOPE_ALL
      ? WORKBENCH_SEARCH_SCOPE_ALL
      : WORKBENCH_SEARCH_SCOPE_CURRENT;
    persistWorkbenchSearchScope(normalized);
    set({ activeWorkbenchSearchScope: normalized });
  },

  createWorkbench: async (name) => {
    const created = await createWorkbenchSvc(String(name || '').trim());
    const { loadWorkbenches } = get();
    const result = await loadWorkbenches();
    const nextActiveWorkbenchId = normalizeWorkbenchId(created?.id) || result?.activeWorkbenchId || null;
    persistActiveWorkbenchId(nextActiveWorkbenchId);
    set({ activeWorkbenchId: nextActiveWorkbenchId });
    return created;
  },

  renameWorkbench: async (id, name) => {
    await renameWorkbenchSvc(id, name);
    await get().loadWorkbenches();
  },

  deleteWorkbench: async (id) => {
    const fallbackWorkbenchId = await deleteWorkbenchSvc(id);
    const { loadWorkbenches } = get();
    const result = await loadWorkbenches();
    const nextActiveWorkbenchId = normalizeWorkbenchId(fallbackWorkbenchId) || result?.activeWorkbenchId || null;
    persistActiveWorkbenchId(nextActiveWorkbenchId);
    set({ activeWorkbenchId: nextActiveWorkbenchId });
    return nextActiveWorkbenchId;
  },

  addQuickNote: async (content) => {
    if (!content.trim()) return;
    try {
      const { maxPinnedItems, loadItems, activeWorkbenchId } = get();
      // 创建新条目
      const itemId = await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: QUICK_NOTE_SOURCE,
        autoFavorite: false,
      });
      if (itemId) {
        await pinItemSvc(itemId, {
          maxPinned: maxPinnedItems,
          workbenchId: activeWorkbenchId,
        });
      }
      await loadItems();
      return itemId;
    } catch (error) {
      console.error('快速笔记添加失败:', error);
      throw error;
    }
  },

  mergeCopyPinned: async () => {
    try {
      const { itemsById, pinnedItemIdsByWorkbench, activeWorkbenchId } = get();
      const pinnedItems = getPinnedItemsForWorkbench(itemsById, pinnedItemIdsByWorkbench, activeWorkbenchId);
      const hydratedPinnedItems = await hydrateItemsIfNeeded(pinnedItems);
      const merged = hydratedPinnedItems
        .map((item) => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
        .filter(Boolean)
        .join('\n\n');
      if (merged) {
        // 构造临时 item 用于复制
        await invoke('copy_plain_text', { text: merged });
        pushCopyFeedback(set, {
          itemId: 'merge-success',
          source: 'workbench',
          autoPaste: false,
          clearAfterMs: 1000,
        });
      }
    } catch (error) {
      console.error('合并复制失败:', error);
    }
  },

  clearAllPinned: async () => {
    try {
      const { itemsById, pinnedItemIdsByWorkbench, loadItems, activeWorkbenchId } = get();
      const pinnedItems = getPinnedItemsForWorkbench(itemsById, pinnedItemIdsByWorkbench, activeWorkbenchId);
      for (const item of pinnedItems) {
        await toggleItemPin(item.id, { maxPinned: 999, workbenchId: activeWorkbenchId });
      }
      await loadItems();
      set({
        panelMode: 'workbench',
        previewItem: null,
        previewReturnMode: 'workbench',
        compareCandidateIds: [],
        compareItemIds: [],
      });
    } catch (error) {
      console.error('清空收集箱失败:', error);
    }
  },
});
