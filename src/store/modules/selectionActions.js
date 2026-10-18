import { invoke } from '@tauri-apps/api/core';
import { deleteItem as deleteItemSvc } from '../../services/clipboardService';
import { saveQuickNote } from '../../services/quickNoteService';
import { QUICK_INPUT_SOURCE } from '../../utils/sourceConstants';
import { getTags, hasReservedTagPrefix } from '../../utils/tagHelpers';
import { pushCopyFeedback } from './copyFeedback';
import { hydrateItemsIfNeeded } from './itemHydration';
import { buildItemDerivations } from './itemsIndex';

const sortItemsByChronologicalAscending = (items) => (
  [...items].sort((a, b) => {
    const timeA = Number(a.created_at || a.updated_at || 0);
    const timeB = Number(b.created_at || b.updated_at || 0);
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  })
);

export const createSelectionActions = (set, get) => ({
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
      set({ selectedItemIds: selectedItemIds.filter((id) => id !== itemId) });
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
    const preferredById = new Map(preferredItems.map((item) => [item.id, item]));
    const fallbackById = get().itemsById;
    const selectedItems = selectedItemIds
      .map((id) => preferredById.get(id) || fallbackById.get(id))
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
      const updatesById = new Map(updates.map((update) => [update.id, update]));
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
          ...buildItemDerivations(nextItems),
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
      const selectedIdSet = new Set(selectedItemIds);
      const nextItems = items.filter((item) => !selectedIdSet.has(item.id));
      set((state) => ({
        items: nextItems,
        ...buildItemDerivations(nextItems),
        selectedItemIds: [],
        panelMode: 'workbench',
        previewItem: null,
        previewReturnMode: 'workbench',
        compareCandidateIds: [],
        compareItemIds: [],
        itemsRevision: state.itemsRevision + 1,
      }));
    } catch (error) {
      console.error('batch delete failed:', error);
    }
  },

  copySelectedItemsMerged: async (sourceItems = null) => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return { ok: false, count: 0 };
    try {
      const preferredItems = Array.isArray(sourceItems) && sourceItems.length > 0 ? sourceItems : items;
      const preferredById = new Map(preferredItems.map((item) => [item.id, item]));
      const fallbackById = get().itemsById;
      const selectedItems = selectedItemIds
        .map((id) => preferredById.get(id) || fallbackById.get(id))
        .filter(Boolean);
      if (selectedItems.length === 0) return { ok: false, count: 0 };

      // 时间正序（最早复制的排在最前面，最新复制的排在最后面）
      const chronologicalItems = sortItemsByChronologicalAscending(selectedItems);
      const hydratedSelectedItems = await hydrateItemsIfNeeded(chronologicalItems);
      const merged = hydratedSelectedItems
        .map((item) => (item.content || (item.type_ === 'image' ? item.ocr_text || '' : '')).trim())
        .filter(Boolean)
        .join('\n\n');
      if (!merged) return { ok: false, count: 0 };

      await invoke('copy_plain_text', { text: merged });
      pushCopyFeedback(set, {
        itemId: `merged-${hydratedSelectedItems.length}`,
        source: 'history',
        autoPaste: false,
        clearAfterMs: 1200,
        extraState: {
          selectedItemIds: [],
        },
      });
      return { ok: true, count: hydratedSelectedItems.length };
    } catch (error) {
      console.error('merge copy failed:', error);
      return { ok: false, count: 0 };
    }
  },

  mergeSelectedItemsToNote: async (sourceItems = null) => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return { ok: false, count: 0 };
    try {
      const preferredItems = Array.isArray(sourceItems) && sourceItems.length > 0 ? sourceItems : items;
      const preferredById = new Map(preferredItems.map((item) => [item.id, item]));
      const fallbackById = get().itemsById;
      const selectedItems = selectedItemIds
        .map((id) => preferredById.get(id) || fallbackById.get(id))
        .filter(Boolean);
      if (selectedItems.length === 0) return { ok: false, count: 0 };

      // 时间正序（最早复制的排在最前面，最新复制的排在最后面）
      const chronologicalItems = sortItemsByChronologicalAscending(selectedItems);
      const hydratedSelectedItems = await hydrateItemsIfNeeded(chronologicalItems);
      const mergedContent = hydratedSelectedItems
        .map((item) => (item.content || (item.type_ === 'image' ? item.ocr_text || '' : '')).trim())
        .filter(Boolean)
        .join('\n\n');
      if (!mergedContent) return { ok: false, count: 0 };

      await saveQuickNote(mergedContent, QUICK_INPUT_SOURCE, {
        autoFavorite: true,
      });
      set({ selectedItemIds: [] });
      await get().loadItems();
      return { ok: true, count: hydratedSelectedItems.length };
    } catch (error) {
      console.error('merge to note failed:', error);
      return { ok: false, count: 0 };
    }
  },
});
