import { invoke } from '@tauri-apps/api/core';
import { generateAITagsForItem } from '../../services/aiService';
import {
  copyItemToClipboard,
  deleteItem as deleteItemSvc,
} from '../../services/clipboardService';
import {
  getCardBackgroundIdFromMetadata,
  normalizeCardBackgroundId,
  withCardBackgroundInMetadata,
} from '../../utils/cardBackgrounds';
import { getSourceApp } from '../../utils/tagHelpers';
import { isQollectManagedSource } from '../../utils/sourceConstants';
import { SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK } from './platformSupport';
import { pushCopyFeedback } from './copyFeedback';
import { hydrateItemIfNeeded } from './itemHydration';

const shouldSkipInternalSourceCopy = (item, allowInternalCopy) => {
  if (allowInternalCopy) return false;
  const sourceApp = getSourceApp(item?.metadata);
  return isQollectManagedSource(sourceApp);
};

export const createItemActions = (set, get) => ({
  handleCopy: async (item, source = 'global') => {
    try {
      const itemForCopy = await hydrateItemIfNeeded(item);
      if (shouldSkipInternalSourceCopy(itemForCopy, get().copyQollectSourceItems)) {
        return false;
      }
      await copyItemToClipboard(itemForCopy);
      pushCopyFeedback(set, {
        itemId: itemForCopy.id,
        source,
        autoPaste: false,
        clearAfterMs: 1000,
      });
      return true;
    } catch (error) {
      console.error('复制失败:', error);
      return false;
    }
  },

  handleCopyAndAutoPaste: async (item, source = 'global') => {
    try {
      const itemForCopy = await hydrateItemIfNeeded(item);
      if (shouldSkipInternalSourceCopy(itemForCopy, get().copyQollectSourceItems)) {
        return false;
      }
      await copyItemToClipboard(itemForCopy);
      pushCopyFeedback(set, {
        itemId: itemForCopy.id,
        source,
        autoPaste: false,
        clearAfterMs: 1000,
      });

      if (!SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK || !get().autoPasteOnDoubleClick) {
        return true;
      }

      // Only auto-paste for text/html/link types, skip image/file
      if (itemForCopy.type_ === 'image' || itemForCopy.type_ === 'file') {
        return true;
      }

      try {
        const pasted = await invoke('try_paste_foreground');
        if (pasted) {
          pushCopyFeedback(set, {
            itemId: itemForCopy.id,
            source,
            autoPaste: true,
            clearAfterMs: 1500,
          });
        } else {
          console.info('[AutoPaste] Platform not implemented, copied only');
        }
      } catch (error) {
        console.warn('[AutoPaste] Paste simulation failed, copied only:', error);
      }
      return true;
    } catch (error) {
      console.error('copy/auto-paste failed:', error);
      return false;
    }
  },

  handleCopyPlainText: async (text, source = 'global') => {
    try {
      await invoke('copy_plain_text', { text });
      pushCopyFeedback(set, {
        itemId: 'plain-text',
        source,
        autoPaste: false,
        clearAfterMs: 1000,
      });
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

        const maxPinOrder = state.items.reduce((maxOrder, candidate) => {
          if (!candidate.is_pinned || candidate.id === item.id || unpinnedByLimitIds.has(candidate.id)) {
            return maxOrder;
          }
          const value = Number(candidate.pin_order);
          if (!Number.isFinite(value)) return maxOrder;
          return value > maxOrder ? value : maxOrder;
        }, 0);
        const nextPinOrder = nextPinnedState ? maxPinOrder + 1 : null;

        items = items.map((it) => {
          if (it.id === item.id) {
            return {
              ...it,
              is_pinned: nextPinnedState,
              pinned_at: nextPinnedState ? now : null,
              pin_order: nextPinnedState ? nextPinOrder : null,
              updated_at: now,
            };
          }

          if (unpinnedByLimitIds.has(it.id)) {
            return {
              ...it,
              is_pinned: false,
              pinned_at: null,
              pin_order: null,
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
            pin_order: nextPinnedState ? nextPinOrder : null,
            updated_at: now,
          };
        } else if (previewItem && unpinnedByLimitIds.has(previewItem.id)) {
          previewItem = {
            ...previewItem,
            is_pinned: false,
            pinned_at: null,
            pin_order: null,
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
      set((state) => {
        const shiftFavoriteOrder = (candidate) => {
          if (!newFavorite || candidate?.id === item.id || !candidate?.is_favorite) {
            return candidate;
          }
          const currentOrder = Number(candidate.favorite_order);
          const nextOrder = Number.isFinite(currentOrder) && currentOrder > 0
            ? currentOrder + 1
            : 2;
          return { ...candidate, favorite_order: nextOrder };
        };

        const nextItems = state.items.map((it) => {
          if (it.id === item.id) {
            return { ...it, is_favorite: newFavorite, favorite_order: newFavorite ? 1 : null };
          }
          return shiftFavoriteOrder(it);
        });

        let nextPreviewItem = state.previewItem;
        if (nextPreviewItem?.id === item.id) {
          nextPreviewItem = {
            ...nextPreviewItem,
            is_favorite: newFavorite,
            favorite_order: newFavorite ? 1 : null,
          };
        } else if (nextPreviewItem) {
          nextPreviewItem = shiftFavoriteOrder(nextPreviewItem);
        }

        return {
          items: nextItems,
          previewItem: nextPreviewItem,
          itemsRevision: state.itemsRevision + 1,
        };
      });
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
      set((state) => ({
        items: state.items.filter((candidate) => candidate.id !== item.id),
        panelMode: 'workbench',
        previewItem: null,
        previewReturnMode: 'workbench',
        compareCandidateIds: [],
        compareItemIds: [],
        itemsRevision: state.itemsRevision + 1,
      }));
    } catch (error) {
      console.error('删除失败:', error);
    }
  },

  setFocusedIndex: (index) => set({ focusedIndex: index }),
});
