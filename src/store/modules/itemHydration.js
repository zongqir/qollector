import { invoke } from '@tauri-apps/api/core';

export const itemNeedsHydration = (item) => (
  Boolean(item?.content_truncated || item?.ocr_truncated)
);

export const fetchItemByIdSafe = async (id) => {
  if (!id) return null;
  try {
    return await invoke('get_item_by_id', { id });
  } catch (error) {
    console.warn('[ItemHydration] fetch failed:', error);
    return null;
  }
};

export const hydrateItemIfNeeded = async (item) => {
  if (!item || !item.id || !itemNeedsHydration(item)) return item;
  const full = await fetchItemByIdSafe(item.id);
  return full || item;
};

export const hydrateItemsIfNeeded = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const uniqueById = new Map();
  items.forEach((item) => {
    if (!item?.id || uniqueById.has(item.id)) return;
    uniqueById.set(item.id, item);
  });

  const hydratedById = new Map();
  await Promise.all(Array.from(uniqueById.values()).map(async (item) => {
    if (!itemNeedsHydration(item)) return;
    const full = await fetchItemByIdSafe(item.id);
    if (full?.id) hydratedById.set(full.id, full);
  }));

  return items.map((item) => hydratedById.get(item.id) || item);
};
