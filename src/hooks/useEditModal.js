import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { QUICK_INPUT_SOURCE } from '../utils/sourceConstants';

export function useEditModal(loadItems, t) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [editModalMode, setEditModalMode] = useState('new');
  const [editingItem, setEditingItem] = useState(null);

  const openEditModal = (item = null) => {
    if (item) {
      setEditModalMode('edit');
      setEditingItem(item);
    } else {
      setEditModalMode('new');
      setEditingItem(null);
    }
    setShowEditModal(true);
  };

  const handleEditModalSave = async (data) => {
    try {
      if (editModalMode === 'new') {
        const itemId = await invoke('add_clipboard_item_manual', {
          content: data.content,
          contentType: 'text',
          source: QUICK_INPUT_SOURCE,
          autoFavorite: false
        });

        if (data.tags.length > 0 || data.note) {
          const newItem = await invoke('get_item_by_id', { id: itemId });
          if (newItem) {
            const updatedItem = {
              ...newItem,
              user_note: data.note,
              tags: JSON.stringify(data.tags),
              updated_at: Math.floor(Date.now() / 1000)
            };
            await invoke('update_item', { item: updatedItem });
          }
        }
      } else {
        const nextContent = data.content ?? editingItem.content;
        const contentUpdated = nextContent !== editingItem.content;
        const updatedItem = {
          ...editingItem,
          content: nextContent,
          content_updated: contentUpdated,
          user_note: data.note,
          tags: JSON.stringify(data.tags),
          updated_at: Math.floor(Date.now() / 1000)
        };
        await invoke('update_item', { item: updatedItem });
      }

      await loadItems();
      setShowEditModal(false);
      setEditingItem(null);
    } catch (error) {
      console.error(t('error.saveFailed', { error }));
      alert(t('error.saveFailed', { error }));
    }
  };

  const handleEditModalCancel = () => {
    setShowEditModal(false);
    setEditingItem(null);
  };

  return {
    showEditModal,
    editModalMode,
    editingItem,
    openEditModal,
    handleEditModalSave,
    handleEditModalCancel,
  };
}
