import { buildItemDerivations } from './itemsIndex';

export const createRuntimeActions = (set, clearHistorySnapshot) => ({
  resetRuntimeStateAfterDataReset: () => {
    clearHistorySnapshot();
    set((state) => ({
      items: [],
      ...buildItemDerivations([]),
      loading: false,
      hasMore: true,
      loadingMore: false,
      historyLoadStopReason: null,
      itemsRevision: state.itemsRevision + 1,
      processedItemIds: new Set(),
      panelMode: 'idle',
      previewItem: null,
      previewReturnMode: 'preview',
      compareCandidateIds: [],
      compareItemIds: [],
      hoverPreviewItem: null,
      hoverPreviewPosition: null,
      selectedItemIds: [],
      copiedItemId: null,
      copyFeedbackSource: null,
      copyFeedbackToken: state.copyFeedbackToken + 1,
      generatingAI: null,
      ocrProcessing: null,
      editingNoteId: null,
      editNote: '',
      addingTagItemId: null,
      newTagInput: '',
      showEditModal: false,
      editingItem: null,
      hasPassword: false,
    }));
  },
});
