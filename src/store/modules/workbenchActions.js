import { invoke } from '@tauri-apps/api/core';
import { QUICK_NOTE_SOURCE } from '../../utils/sourceConstants';
import { pushCopyFeedback } from './copyFeedback';
import { hydrateItemsIfNeeded } from './itemHydration';

export const createWorkbenchActions = (set, get) => ({
  addQuickNote: async (content) => {
    if (!content.trim()) return;
    try {
      const { maxPinnedItems, loadItems } = get();
      // 创建新条目
      const itemId = await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: QUICK_NOTE_SOURCE,
        autoFavorite: false,
      });
      if (itemId) {
        await invoke('pin_item', { id: itemId, maxPinned: maxPinnedItems });
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
      const { items } = get();
      const pinnedItems = items.filter((i) => i.is_pinned);
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
      const { items, loadItems } = get();
      const pinnedItems = items.filter((i) => i.is_pinned);
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
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
