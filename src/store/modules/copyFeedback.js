const COPY_FEEDBACK_SOURCES = new Set([
  'history',
  'preview',
  'hover',
  'workbench',
  'collection',
  'global',
]);

export const normalizeCopyFeedbackSource = (source) => {
  if (typeof source !== 'string') return 'global';
  const normalized = source.trim().toLowerCase();
  return COPY_FEEDBACK_SOURCES.has(normalized) ? normalized : 'global';
};

export const pushCopyFeedback = (
  set,
  {
    itemId,
    source = 'global',
    autoPaste = false,
    clearAfterMs = 1000,
    extraState = {},
  },
) => {
  const feedbackSource = normalizeCopyFeedbackSource(source);
  let feedbackToken = null;

  set((state) => {
    feedbackToken = state.copyFeedbackToken + 1;
    return {
      ...extraState,
      copiedItemId: itemId,
      copyFeedbackSource: feedbackSource,
      copyFeedbackToken: feedbackToken,
      lastCopyWasAutoPaste: autoPaste,
    };
  });

  if (clearAfterMs > 0) {
    setTimeout(() => {
      set((state) => {
        if (state.copyFeedbackToken !== feedbackToken) return {};
        return {
          copiedItemId: null,
          copyFeedbackSource: null,
          lastCopyWasAutoPaste: false,
        };
      });
    }, clearAfterMs);
  }

  return feedbackToken;
};
