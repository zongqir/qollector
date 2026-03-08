const CARD_TAG_PREVIEW_LIMITS = Object.freeze({
  history: Object.freeze({
    default: 3,
    mini: 2,
  }),
  collection: Object.freeze({
    default: 3,
    list: 2,
    mini: 2,
  }),
  workbench: Object.freeze({
    default: 3,
    mini: 2,
  }),
});

export function getCardTagPreviewLimit(area, options = {}) {
  const key = String(area || '').toLowerCase();
  const { isMiniMode = false, isListMode = false } = options;

  if (key === 'history') {
    return isMiniMode ? CARD_TAG_PREVIEW_LIMITS.history.mini : CARD_TAG_PREVIEW_LIMITS.history.default;
  }

  if (key === 'collection') {
    if (isMiniMode) return CARD_TAG_PREVIEW_LIMITS.collection.mini;
    return isListMode ? CARD_TAG_PREVIEW_LIMITS.collection.list : CARD_TAG_PREVIEW_LIMITS.collection.default;
  }

  if (key === 'workbench') {
    return isMiniMode ? CARD_TAG_PREVIEW_LIMITS.workbench.mini : CARD_TAG_PREVIEW_LIMITS.workbench.default;
  }

  return 3;
}
