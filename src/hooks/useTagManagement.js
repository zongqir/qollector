import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';

export function useTagManagement(loadItems, t) {
  const [addingTagItemId, setAddingTagItemId] = useState(null);
  const [newTagInput, setNewTagInput] = useState('');

  const startAddTag = (item, e) => {
    if (e) e.stopPropagation();
    setAddingTagItemId(item.id);
    setNewTagInput('');
  };

  const cancelAddTag = () => {
    setAddingTagItemId(null);
    setNewTagInput('');
  };

  const addTagToItem = async (item, tagToAdd) => {
    try {
      const existingTags = getTags(item.tags);
      if (existingTags.includes(tagToAdd)) {
        cancelAddTag();
        return;
      }

      const newTags = [...existingTags, tagToAdd];
      const updatedItem = {
        ...item,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      cancelAddTag();
    } catch (error) {
      console.error(t('error.addTagFailed', { error }));
      alert(t('error.addTagFailed', { error }));
    }
  };

  const handleTagInputKeyDown = (item, e) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      addTagToItem(item, newTagInput.trim());
    } else if (e.key === 'Escape') {
      cancelAddTag();
    }
  };

  return {
    addingTagItemId,
    newTagInput,
    setNewTagInput,
    startAddTag,
    cancelAddTag,
    addTagToItem,
    handleTagInputKeyDown,
  };
}
