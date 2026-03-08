const CARD_TAG_PREVIEW_LIMITS = Object.freeze({
  history: Object.freeze({
    default: 3,
    mini: 2,
  }),
  collection: Object.freeze({
    default: 4,
    list: 3,
  }),
  workbench: Object.freeze({
    default: 4,
  }),
});

export function getCardTagPreviewLimit(area, options = {}) {
  const key = String(area || '').toLowerCase();
  const { isMiniMode = false, isListMode = false } = options;

  if (key === 'history') {
    return isMiniMode ? CARD_TAG_PREVIEW_LIMITS.history.mini : CARD_TAG_PREVIEW_LIMITS.history.default;
  }

  if (key === 'collection') {
    return isListMode ? CARD_TAG_PREVIEW_LIMITS.collection.list : CARD_TAG_PREVIEW_LIMITS.collection.default;
  }

  if (key === 'workbench') {
    return CARD_TAG_PREVIEW_LIMITS.workbench.default;
  }

  return 3;
}

