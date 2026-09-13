import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { QUICK_INPUT_SOURCE } from '../utils/sourceConstants';

export const QUICK_NOTE_SAVED_EVENT = 'quick-note-saved';

const resolveMaxPinnedItems = async () => {
  try {
    const config = await invoke('get_general_config');
    const value = Number(config?.max_pinned_items);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  } catch {
    return 10;
  }
};

export const saveQuickNote = async (
  content,
  source = QUICK_INPUT_SOURCE,
  options = {},
) => {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const {
    autoFavorite = false,
    autoPin = !autoFavorite,
    workbenchId = null,
  } = typeof options === 'boolean' ? { autoFavorite: options } : options;

  const itemId = await invoke('add_clipboard_item_manual', {
    content: trimmed,
    contentType: 'text',
    source,
    autoFavorite: Boolean(autoFavorite),
  });

  if (itemId && autoPin) {
    const maxPinned = await resolveMaxPinnedItems();
    const pinPayload = { id: itemId, maxPinned };
    if (workbenchId) {
      pinPayload.workbenchId = workbenchId;
    }
    await invoke('pin_item', pinPayload);
  }

  await emit(QUICK_NOTE_SAVED_EVENT, {
    itemId: itemId ?? null,
    autoFavorite: Boolean(autoFavorite),
    autoPin: Boolean(autoPin),
    workbenchId: workbenchId ?? null,
  });

  return itemId;
};
