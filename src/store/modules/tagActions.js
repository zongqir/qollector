import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../../utils/tagHelpers';

export const createTagActions = (set, get) => ({
  startAddTag: (item) => {
    set({ addingTagItemId: item.id, newTagInput: '' });
  },

  cancelAddTag: () => {
    set({ addingTagItemId: null, newTagInput: '' });
  },

  addTagToItem: async (item, tagToAdd) => {
    try {
      const normalizedTag = typeof tagToAdd === 'string' ? tagToAdd.trim() : '';
      if (!normalizedTag) return;
      const latestItem = get().items?.find((i) => i.id === item.id) || item;
      const existingTags = getTags(latestItem.tags);
      if (existingTags.includes(normalizedTag)) {
        get().cancelAddTag();
        return;
      }
      // If promoting an AI tag, clean up the AI: prefix version
      const aiPrefixed = `AI:${normalizedTag}`;
      const filteredExisting = existingTags.filter(t => t !== aiPrefixed);
      const newTags = [...filteredExisting, normalizedTag];
      const updatedItem = {
        ...latestItem,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000),
      };
      await invoke('update_item', { item: updatedItem });
      await get().loadItems();
      get().cancelAddTag();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  },

  removeTagFromItem: async (item, tagToRemove) => {
    try {
      const latestItem = get().items?.find((i) => i.id === item.id) || item;
      const existingTags = getTags(latestItem.tags);
      const newTags = existingTags.filter(t => t !== tagToRemove);
      const updatedItem = {
        ...latestItem,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000),
      };
      await invoke('update_item', { item: updatedItem });
      await get().loadItems();
    } catch (error) {
      console.error('移除标签失败:', error);
    }
  },

  updateItemTags: async (item, newTags) => {
    try {
      const latestItem = get().items?.find((i) => i.id === item.id) || item;
      const updatedItem = {
        ...latestItem,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000),
      };
      await invoke('update_item', { item: updatedItem });
      await get().loadItems();
    } catch (error) {
      console.error('更新标签失败:', error);
    }
  },
});
