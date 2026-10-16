import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { QUICK_INPUT_SOURCE } from '../utils/sourceConstants';

export const QUICK_NOTE_SAVED_EVENT = 'quick-note-saved';

export const saveQuickNote = async (
  content = '',
  source = QUICK_INPUT_SOURCE,
  options = {},
) => {
  const noteContent = typeof content === 'string' ? content : '';

  const {
    autoFavorite = true,
  } = typeof options === 'boolean' ? { autoFavorite: options } : options;

  const itemId = await invoke('add_clipboard_item_manual', {
    content: noteContent,
    contentType: 'text',
    source,
    autoFavorite: Boolean(autoFavorite),
  });

  await emit(QUICK_NOTE_SAVED_EVENT, {
    itemId: itemId ?? null,
    autoFavorite: Boolean(autoFavorite),
  });

  return itemId;
};
