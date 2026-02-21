import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

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
        await invoke('add_clipboard_item_manual', {
          content: data.content,
          contentType: 'text',
          source: t('quickInput.source'),
          autoFavorite: false
        });

        if (data.tags.length > 0 || data.note) {
          await loadItems();
          const newItems = await invoke('get_recent_items', { limit: 100 });
          const newItem = newItems[0];
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
