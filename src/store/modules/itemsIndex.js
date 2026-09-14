export const buildItemsById = (items) => {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  items.forEach((item) => {
    if (!item?.id) return;
    map.set(item.id, item);
  });
  return map;
};

export const normalizeWorkbenchBucketId = (workbenchId, defaultWorkbenchId) => {
  const normalized = String(workbenchId || '').trim();
  if (!normalized || normalized === 'default') {
    return 'default';
  }
  if (defaultWorkbenchId && normalized === String(defaultWorkbenchId).trim()) {
    return 'default';
  }
  return normalized;
};

const sortFavoriteItems = (left, right) => {
  const leftOrder = Number(left?.favorite_order);
  const rightOrder = Number(right?.favorite_order);
  const hasLeftOrder = Number.isFinite(leftOrder);
  const hasRightOrder = Number.isFinite(rightOrder);

  if (hasLeftOrder && hasRightOrder && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (hasLeftOrder !== hasRightOrder) {
    return hasLeftOrder ? -1 : 1;
  }

  const favoriteTimeDiff = Number(right?.updated_at || 0) - Number(left?.updated_at || 0);
  if (favoriteTimeDiff !== 0) return favoriteTimeDiff;
  return String(right?.id || '').localeCompare(String(left?.id || ''));
};

const sortPinnedItems = (left, right) => {
  const leftOrder = Number(left?.pin_order);
  const rightOrder = Number(right?.pin_order);
  const hasLeftOrder = Number.isFinite(leftOrder);
  const hasRightOrder = Number.isFinite(rightOrder);

  if (hasLeftOrder && hasRightOrder && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (hasLeftOrder !== hasRightOrder) {
    return hasLeftOrder ? -1 : 1;
  }

  const pinnedTimeDiff = Number(right?.pinned_at || 0) - Number(left?.pinned_at || 0);
  if (pinnedTimeDiff !== 0) return pinnedTimeDiff;
  return String(right?.id || '').localeCompare(String(left?.id || ''));
};

export const buildFavoriteItemIds = (items) => (
  Array.isArray(items)
    ? items
      .filter((item) => item?.is_favorite)
      .sort(sortFavoriteItems)
      .map((item) => item.id)
    : []
);

export const buildPinnedItemIdsByWorkbench = (items) => {
  const grouped = new Map();
  if (!Array.isArray(items)) return grouped;

  items.forEach((item) => {
    if (!item?.is_pinned || !item?.id) return;
    const workbenchId = normalizeWorkbenchBucketId(item.workbench_id);
    const bucket = grouped.get(workbenchId) || [];
    bucket.push(item);
    grouped.set(workbenchId, bucket);
  });

  const idsByWorkbench = new Map();
  grouped.forEach((bucket, workbenchId) => {
    idsByWorkbench.set(
      workbenchId,
      bucket.sort(sortPinnedItems).map((item) => item.id),
    );
  });

  return idsByWorkbench;
};

export const getPinnedItemIdsForWorkbench = (pinnedItemIdsByWorkbench, workbenchId, defaultWorkbenchId) => {
  if (!pinnedItemIdsByWorkbench) return [];
  const normalized = normalizeWorkbenchBucketId(workbenchId, defaultWorkbenchId);
  if (normalized === 'default') {
    const defaultBucket = pinnedItemIdsByWorkbench.get('default') || [];
    const uuidBucket = defaultWorkbenchId ? (pinnedItemIdsByWorkbench.get(defaultWorkbenchId) || []) : [];
    if (uuidBucket.length === 0) return defaultBucket;
    const seen = new Set(defaultBucket);
    return [...defaultBucket, ...uuidBucket.filter((id) => !seen.has(id))];
  }
  return pinnedItemIdsByWorkbench.get(normalized) || [];
};

export const getPinnedItemsForWorkbench = (itemsById, pinnedItemIdsByWorkbench, workbenchId, defaultWorkbenchId) => (
  getPinnedItemIdsForWorkbench(pinnedItemIdsByWorkbench, workbenchId, defaultWorkbenchId)
    .map((id) => itemsById?.get(id))
    .filter(Boolean)
);

export const buildItemDerivations = (items) => ({
  itemsById: buildItemsById(items),
  favoriteItemIds: buildFavoriteItemIds(items),
  pinnedItemIdsByWorkbench: buildPinnedItemIdsByWorkbench(items),
});

export const withIndexedItems = (nextState) => {
  if (!nextState || !Object.prototype.hasOwnProperty.call(nextState, 'items')) {
    return nextState;
  }

  return {
    ...nextState,
    ...buildItemDerivations(nextState.items),
  };
};
