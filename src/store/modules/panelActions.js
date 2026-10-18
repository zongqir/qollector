import {
  normalizeCompareCandidateIds,
  normalizeCompareItemIds,
} from './compareSelection';
import {
  hydrateItemIfNeeded,
  itemNeedsHydration,
} from './itemHydration';

const inferPreviewReturnViewMode = (state) => {
  if (!state.workbenchPanelEnabled) return 'left';
  if (!state.historyStreamEnabled) return 'right';
  return 'all';
};

export const createPanelActions = (set, get) => ({
  setPanelMode: (mode, item = null, options = {}) => {
    if (mode === 'preview' && item) {
      const currentState = get();
      const explicitReturnViewMode = typeof options.returnViewMode === 'string'
        ? options.returnViewMode
        : null;
      if (currentState.panelMode === 'preview' && currentState.previewItem?.id === item.id) {
        get().backFromPreview();
        return;
      }
      set((state) => {
        const keepCompareContext = state.panelMode === 'compare' && state.compareItemIds.length >= 2;
        return {
          panelMode: 'preview',
          previewItem: item,
          previewReturnMode: keepCompareContext ? 'compare' : 'preview',
          previewReturnViewMode: explicitReturnViewMode || inferPreviewReturnViewMode(state),
          compareCandidateIds: keepCompareContext ? state.compareCandidateIds : [],
          compareItemIds: keepCompareContext ? state.compareItemIds : [],
          timelineItems: [],
          timelineSummary: null,
        };
      });
      if (itemNeedsHydration(item)) {
        const targetId = item.id;
        hydrateItemIfNeeded(item)
          .then((fullItem) => {
            if (!fullItem?.id || fullItem.id !== targetId) return;
            set((state) => {
              if (state.panelMode !== 'preview' || state.previewItem?.id !== targetId) return {};
              return { previewItem: fullItem };
            });
          })
          .catch((error) => {
            console.warn('[ItemHydration] preview hydration failed:', error);
          });
      }
    } else if (mode === 'compare') {
      const compareCandidateIds = normalizeCompareCandidateIds(item);
      const fallbackCompareItemIds = normalizeCompareItemIds(compareCandidateIds);
      if (fallbackCompareItemIds.length < 2) {
        set({
          panelMode: 'idle',
          previewItem: null,
          previewReturnMode: 'preview',
          previewReturnViewMode: 'left',
          compareCandidateIds: [],
          compareItemIds: [],
          timelineItems: [],
          timelineSummary: null,
        });
        return;
      }
      set((state) => {
        const candidateSet = new Set(compareCandidateIds);
        const canKeepCurrentPair = (
          state.panelMode === 'compare'
          && state.compareItemIds.length >= 2
          && state.compareItemIds.every((id) => candidateSet.has(id))
        );
        return {
          panelMode: 'compare',
          previewItem: null,
          previewReturnMode: 'preview',
          previewReturnViewMode: inferPreviewReturnViewMode(state),
          compareCandidateIds,
          compareItemIds: canKeepCurrentPair ? state.compareItemIds : fallbackCompareItemIds,
          timelineItems: [],
          timelineSummary: null,
        };
      });
    } else if (mode === 'timeline') {
      set({
        panelMode: 'timeline',
        previewItem: null,
        previewReturnMode: 'preview',
        previewReturnViewMode: inferPreviewReturnViewMode(get()),
        compareCandidateIds: [],
        compareItemIds: [],
      });
      // Auto-load timeline data when entering timeline mode
      get().loadTimelineData('today');
    } else {
      set({
        panelMode: 'idle',
        previewItem: null,
        previewReturnMode: 'preview',
        previewReturnViewMode: inferPreviewReturnViewMode(get()),
        compareCandidateIds: [],
        compareItemIds: [],
        timelineItems: [],
        timelineSummary: null,
      });
    }
  },

  setCompareItemIds: (itemsOrIds) => {
    const compareItemIds = normalizeCompareItemIds(itemsOrIds);
    if (compareItemIds.length < 2) return;
    set((state) => {
      const fallbackCandidateIds = normalizeCompareCandidateIds(itemsOrIds);
      const candidateIds = state.compareCandidateIds.length >= 2
        ? state.compareCandidateIds
        : fallbackCandidateIds;
      const candidateSet = new Set(candidateIds);
      if (!compareItemIds.every((id) => candidateSet.has(id))) {
        return {};
      }
      return {
        compareCandidateIds: candidateIds,
        compareItemIds,
      };
    });
  },

  backFromPreview: () => {
    set((state) => {
      if (
        state.panelMode === 'preview'
        && state.previewReturnMode === 'compare'
        && state.compareItemIds.length >= 2
      ) {
        return {
          panelMode: 'compare',
          previewItem: null,
          previewReturnMode: 'preview',
          previewReturnViewMode: inferPreviewReturnViewMode(state),
        };
      }
      const returnViewMode = state.previewReturnViewMode || inferPreviewReturnViewMode(state);
      const updates = {
        panelMode: 'idle',
        previewItem: null,
        previewReturnMode: 'preview',
        compareCandidateIds: [],
        compareItemIds: [],
      };
      if (returnViewMode === 'left') {
        updates.workbenchPanelEnabled = false;
        updates.historyStreamEnabled = true;
      } else if (returnViewMode === 'right') {
        updates.workbenchPanelEnabled = true;
        updates.historyStreamEnabled = false;
      } else if (returnViewMode === 'all') {
        updates.workbenchPanelEnabled = true;
        updates.historyStreamEnabled = true;
      }
      return updates;
    });
  },

  switchToWorkbench: () => {
    set({
      panelMode: 'idle',
      previewItem: null,
      previewReturnMode: 'preview',
      previewReturnViewMode: inferPreviewReturnViewMode(get()),
      compareCandidateIds: [],
      compareItemIds: [],
    });
  },
});
