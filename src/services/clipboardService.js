import { invoke } from '@tauri-apps/api/core';

export const copyItemToClipboard = async (item) => {
  return invoke('copy_item', { item });
};

export const toggleItemPin = async (id) => {
  return invoke('toggle_pin_item', { id });
};

export const toggleItemFavorite = async (id) => {
  return invoke('toggle_favorite_item', { id });
};

export const updateItem = async (item) => {
  return invoke('update_item', { item });
};

export const deleteItem = async (id) => {
  return invoke('delete_item', { id });
};

export const getRecentItems = async (limit = 100) => {
  return invoke('get_recent_items', { limit });
};
