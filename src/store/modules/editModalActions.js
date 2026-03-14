import { invoke } from '@tauri-apps/api/core';
import { QUICK_INPUT_SOURCE } from '../../utils/sourceConstants';
import { hydrateItemIfNeeded, itemNeedsHydration } from './itemHydration';

export const createEditModalActions = (set, get) => ({
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
        const itemId = await invoke('add_clipboard_item_manual', {
          content: data.content,
          contentType: 'text',
          source: QUICK_INPUT_SOURCE,
          autoFavorite: false,
        });
        if (data.tags.length > 0 || data.note) {
          const newItem = await invoke('get_item_by_id', { id: itemId });
          if (newItem) {
            const updatedItem = {
              ...newItem,
              user_note: data.note,
              tags: JSON.stringify(data.tags),
              updated_at: Math.floor(Date.now() / 1000),
            };
            await invoke('update_item', { item: updatedItem });
          }
        }
      } else {
        const nextContent = data.content ?? editingItem.content;
        const contentUpdated = nextContent !== editingItem.content;
        const updatedAt = Math.floor(Date.now() / 1000);
        const updatedItem = {
          ...editingItem,
          content: nextContent,
          content_updated: contentUpdated,
          user_note: data.note,
          tags: JSON.stringify(data.tags),
          updated_at: updatedAt,
        };
        await invoke('update_item', { item: updatedItem });
        set((state) => ({
          items: state.items.map((candidate) => (
            candidate.id === updatedItem.id
              ? {
                ...candidate,
                content: updatedItem.content,
                content_updated: updatedItem.content_updated,
                user_note: updatedItem.user_note,
                tags: updatedItem.tags,
                updated_at: updatedAt,
              }
              : candidate
          )),
          previewItem: state.previewItem?.id === updatedItem.id
            ? {
              ...state.previewItem,
              ...updatedItem,
              content_truncated: false,
            }
            : state.previewItem,
          itemsRevision: state.itemsRevision + 1,
        }));
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
});
