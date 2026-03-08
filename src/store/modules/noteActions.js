import { invoke } from '@tauri-apps/api/core';

export const createNoteActions = (set, get) => ({
  startEditNote: (item) => {
    set({ editingNoteId: item.id, editNote: item.user_note || '' });
  },

  saveNote: async (item) => {
    try {
      const { editNote, loadItems } = get();
      const updatedItem = {
        ...item,
        user_note: editNote,
        updated_at: Math.floor(Date.now() / 1000),
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      set({ editingNoteId: null, editNote: '' });
    } catch (error) {
      console.error('保存备注失败:', error);
    }
  },

  cancelNoteEdit: () => {
    set({ editingNoteId: null, editNote: '' });
  },
});
