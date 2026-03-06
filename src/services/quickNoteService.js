import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { QUICK_INPUT_SOURCE } from '../utils/sourceConstants';

export const QUICK_NOTE_SAVED_EVENT = 'quick-note-saved';
export const QUICK_INPUT_WINDOW_STATE_EVENT = 'quick-input-window-state';
export const QUICK_INPUT_OPEN_WORKBENCH_EVENT = 'quick-input-open-workbench';

const resolveMaxPinnedItems = async () => {
  try {
    const config = await invoke('get_general_config');
    const value = Number(config?.max_pinned_items);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  } catch {
    return 10;
  }
};

export const saveQuickNote = async (content, source = QUICK_INPUT_SOURCE) => {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const itemId = await invoke('add_clipboard_item_manual', {
    content: trimmed,
    contentType: 'text',
    source,
    autoFavorite: false,
  });

  if (itemId) {
    const maxPinned = await resolveMaxPinnedItems();
    await invoke('pin_item', { id: itemId, maxPinned });
  }

  await emit(QUICK_NOTE_SAVED_EVENT, {
    itemId: itemId ?? null,
  });

  return itemId;
};
