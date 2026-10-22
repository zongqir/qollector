import { invoke } from '@tauri-apps/api/core';

export const copyItemToClipboard = async (item) => {
  return invoke('copy_item', { item });
};

export const toggleItemPin = async (id, options = {}) => {
  const maxPinned = Number.isFinite(Number(options?.maxPinned)) ? Number(options.maxPinned) : undefined;
  const workbenchId = typeof options?.workbenchId === 'string' && options.workbenchId.trim()
    ? options.workbenchId.trim()
    : undefined;
  return invoke('toggle_pin_item', { id, maxPinned, workbenchId });
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

export const pinItem = async (id, options = {}) => {
  const maxPinned = Number.isFinite(Number(options?.maxPinned)) ? Number(options.maxPinned) : undefined;
  const workbenchId = typeof options?.workbenchId === 'string' && options.workbenchId.trim()
    ? options.workbenchId.trim()
    : undefined;
  return invoke('pin_item', { id, maxPinned, workbenchId });
};

export const getWorkbenches = async () => {
  return invoke('get_workbenches');
};

export const createWorkbench = async (name) => {
  return invoke('create_workbench', { name });
};

export const renameWorkbench = async (id, name) => {
  return invoke('rename_workbench', { id, name });
};

export const deleteWorkbench = async (id) => {
  return invoke('delete_workbench', { id });
};

export const getWorkbenchPinnedItems = async (workbenchId = undefined) => {
  return invoke('get_workbench_pinned_items', { workbenchId });
};

export const reorderWorkbenchPinnedItems = async (orderedIds = [], workbenchId = undefined) => {
  return invoke('reorder_workbench_pinned_items', { orderedIds, workbenchId });
};

export const getCollectionFavoriteItems = async () => {
  return invoke('get_collection_favorite_items');
};

export const reorderCollectionFavoriteItems = async (orderedIds = []) => {
  return invoke('reorder_collection_favorite_items', { orderedIds });
};

export const getHistoryGroupCounts = async (startToday, startYesterday, startLast7) => {
  return invoke('get_history_group_counts', { startToday, startYesterday, startLast7 });
};

export const searchItems = async (query, limit = 200, filters = undefined) => {
  return invoke('search_items', { query, limit, filters });
};

export const getUserTags = async (query = '', limit = 80, options = {}) => {
  const normalizedQuery = typeof query === 'string' && query.trim() ? query.trim() : null;
  const onlyFavorite = options?.onlyFavorite === true;
  const onlyPinned = options?.onlyPinned === true;
  return invoke('get_user_tags', {
    query: normalizedQuery,
    limit,
    onlyFavorite,
    onlyPinned,
  });
};
