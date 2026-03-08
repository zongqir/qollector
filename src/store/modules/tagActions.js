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
      const existingTags = getTags(item.tags);
      if (existingTags.includes(tagToAdd)) {
        get().cancelAddTag();
        return;
      }
      const newTags = [...existingTags, tagToAdd];
      const updatedItem = {
        ...item,
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
});
