import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

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

export const saveQuickNote = async (content, source) => {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  await invoke('add_clipboard_item_manual', {
    content: trimmed,
    contentType: 'text',
    source,
    autoFavorite: false,
  });

  const recentItems = await invoke('get_recent_items', { limit: 1 });
  const latestItem = Array.isArray(recentItems) ? recentItems[0] : null;

  if (latestItem?.id) {
    const maxPinned = await resolveMaxPinnedItems();
    try {
      await invoke('pin_item', { id: latestItem.id, maxPinned });
    } catch (error) {
      console.warn('Quick note pin failed:', error);
    }
  }

  await emit(QUICK_NOTE_SAVED_EVENT, {
    itemId: latestItem?.id ?? null,
  });

  return latestItem;
};
