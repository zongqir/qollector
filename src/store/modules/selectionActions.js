import { invoke } from '@tauri-apps/api/core';
import { deleteItem as deleteItemSvc } from '../../services/clipboardService';
import { getTags, hasReservedTagPrefix } from '../../utils/tagHelpers';
import { pushCopyFeedback } from './copyFeedback';
import { hydrateItemsIfNeeded } from './itemHydration';

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
    const fallbackById = new Map(items.map((item) => [item.id, item]));
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
      set((state) => ({
        items: items.filter((item) => !selectedItemIds.includes(item.id)),
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
    if (selectedItemIds.length === 0) return;
    try {
      const preferredItems = Array.isArray(sourceItems) && sourceItems.length > 0 ? sourceItems : items;
      const preferredById = new Map(preferredItems.map((item) => [item.id, item]));
      const fallbackById = new Map(items.map((item) => [item.id, item]));
      const selectedItems = selectedItemIds
        .map((id) => preferredById.get(id) || fallbackById.get(id))
        .filter(Boolean);
      const hydratedSelectedItems = await hydrateItemsIfNeeded(selectedItems);
      const merged = hydratedSelectedItems
        .map((item) => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
        .filter(Boolean)
        .join('\n');
      if (!merged) return;
      await invoke('copy_plain_text', { text: merged });
      pushCopyFeedback(set, {
        itemId: 'merge-success',
        source: 'history',
        autoPaste: false,
        clearAfterMs: 1000,
        extraState: {
          selectedItemIds: [],
        },
      });
    } catch (error) {
      console.error('merge copy failed:', error);
    }
  },
});
