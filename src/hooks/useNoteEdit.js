import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useNoteEdit(loadItems, t) {
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editNote, setEditNote] = useState('');

  const startEditNote = (item) => {
    setEditingNoteId(item.id);
    setEditNote(item.user_note || '');
  };

  const saveNote = async (item) => {
    try {
      const updatedItem = {
        ...item,
        user_note: editNote,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      setEditingNoteId(null);
      setEditNote('');
    } catch (error) {
      console.error(t('error.saveFailed', { error }));
      alert(t('error.saveFailed', { error }));
    }
  };

  const cancelNoteEdit = () => {
    setEditingNoteId(null);
    setEditNote('');
  };

  return {
    editingNoteId,
    editNote,
    setEditNote,
    startEditNote,
    saveNote,
    cancelNoteEdit,
  };
}
