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

export const getRecentItemsLight = async (limit = 50) => {
  return invoke('get_recent_items_light', { limit });
};

export const getMoreItems = async (limit = 50, offset = 0) => {
  return invoke('get_more_items', { limit, offset });
};

export const getHistoryGroupCounts = async (startToday, startYesterday, startLast7) => {
  return invoke('get_history_group_counts', { startToday, startYesterday, startLast7 });
};

export const searchItems = async (query, limit = 200, filters = undefined) => {
  return invoke('search_items', { query, limit, filters });
};
