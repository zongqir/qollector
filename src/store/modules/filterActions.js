import {
  buildFilterPayloadFromState,
  buildWorkbenchFilterPayloadFromState,
  MAX_FILTER_VIEWS,
  normalizeFilterPayload,
  persistSavedFilterViews,
  persistWorkbenchSavedFilterViews,
} from './filterViews';

export const createFilterActions = (set, get) => ({
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedType: (t) => set({ selectedType: t }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setShowFavoritesOnly: (v) => set({ showFavoritesOnly: v }),
  setShowPinnedOnly: (v) => set({ showPinnedOnly: v }),
  setShowTagFilter: (v) => set({ showTagFilter: v }),
  setTagSearchQuery: (q) => set({ tagSearchQuery: q }),
  setSelectedDateRange: (range) => set({ selectedDateRange: range }),
  setShowDateFilter: (v) => set({ showDateFilter: v }),
  setCustomDateStart: (v) => set({ customDateStart: v }),
  setCustomDateEnd: (v) => set({ customDateEnd: v }),
  clearDateFilter: () => set({
    selectedDateRange: null,
    customDateStart: '',
    customDateEnd: '',
    showDateFilter: false,
  }),
  setActiveFilterViewId: (id) => set({ activeFilterViewId: id || null }),
  clearActiveFilterView: () => set({ activeFilterViewId: null }),
  setWorkbenchSearchQuery: (q) => set({ workbenchSearchQuery: q }),
  setWorkbenchSelectedType: (t) => set({ workbenchSelectedType: t }),
  setWorkbenchSelectedTags: (tags) => set({ workbenchSelectedTags: tags }),
  setWorkbenchShowFavoritesOnly: (v) => set({ workbenchShowFavoritesOnly: v }),
  setWorkbenchSelectedDateRange: (range) => set({ workbenchSelectedDateRange: range }),
  setWorkbenchCustomDateStart: (v) => set({ workbenchCustomDateStart: v }),
  setWorkbenchCustomDateEnd: (v) => set({ workbenchCustomDateEnd: v }),
  clearWorkbenchDateFilter: () => set({
    workbenchSelectedDateRange: null,
    workbenchCustomDateStart: '',
    workbenchCustomDateEnd: '',
  }),
  setWorkbenchActiveFilterViewId: (id) => set({ workbenchActiveFilterViewId: id || null }),
  clearWorkbenchActiveFilterView: () => set({ workbenchActiveFilterViewId: null }),

  saveCurrentFilterView: (name) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return { ok: false, reason: 'empty-name' };
    }

    const now = Date.now();
    let savedId = null;
    set((state) => {
      const snapshot = buildFilterPayloadFromState(state);
      const existingIndex = state.savedFilterViews.findIndex(
        (view) => view.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      let nextViews;
      if (existingIndex >= 0) {
        const existing = state.savedFilterViews[existingIndex];
        savedId = existing.id;
        const updated = {
          ...existing,
          name: trimmedName,
          filters: snapshot,
          updatedAt: now,
        };
        nextViews = [
          updated,
          ...state.savedFilterViews.filter((_, idx) => idx !== existingIndex),
        ];
      } else {
        savedId = `view_${now}_${Math.random().toString(36).slice(2, 8)}`;
        nextViews = [
          {
            id: savedId,
            name: trimmedName,
            filters: snapshot,
            createdAt: now,
            updatedAt: now,
          },
          ...state.savedFilterViews,
        ];
      }

      nextViews = nextViews.slice(0, MAX_FILTER_VIEWS);
      persistSavedFilterViews(nextViews);
      return {
        savedFilterViews: nextViews,
        activeFilterViewId: savedId,
      };
    });

    return { ok: true, id: savedId };
  },

  applySavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const { savedFilterViews } = get();
    const target = savedFilterViews.find((view) => view.id === targetId);
    if (!target) return false;

    const payload = normalizeFilterPayload(target.filters);
    set({
      ...payload,
      showTagFilter: false,
      tagSearchQuery: '',
      showDateFilter: false,
      activeFilterViewId: target.id,
    });
    return true;
  },

  deleteSavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;

    set((state) => {
      const nextViews = state.savedFilterViews.filter((view) => view.id !== targetId);
      if (nextViews.length === state.savedFilterViews.length) return {};
      persistSavedFilterViews(nextViews);
      return {
        savedFilterViews: nextViews,
        activeFilterViewId: state.activeFilterViewId === targetId ? null : state.activeFilterViewId,
      };
    });
  },

  saveCurrentWorkbenchFilterView: (name) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return { ok: false, reason: 'empty-name' };
    }

    const now = Date.now();
    let savedId = null;
    set((state) => {
      const snapshot = buildWorkbenchFilterPayloadFromState(state);
      const existingIndex = state.workbenchSavedFilterViews.findIndex(
        (view) => view.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      let nextViews;
      if (existingIndex >= 0) {
        const existing = state.workbenchSavedFilterViews[existingIndex];
        savedId = existing.id;
        const updated = {
          ...existing,
          name: trimmedName,
          filters: snapshot,
          updatedAt: now,
        };
        nextViews = [
          updated,
          ...state.workbenchSavedFilterViews.filter((_, idx) => idx !== existingIndex),
        ];
      } else {
        savedId = `workbench_view_${now}_${Math.random().toString(36).slice(2, 8)}`;
        nextViews = [
          {
            id: savedId,
            name: trimmedName,
            filters: snapshot,
            createdAt: now,
            updatedAt: now,
          },
          ...state.workbenchSavedFilterViews,
        ];
      }

      nextViews = nextViews.slice(0, MAX_FILTER_VIEWS);
      persistWorkbenchSavedFilterViews(nextViews);
      return {
        workbenchSavedFilterViews: nextViews,
        workbenchActiveFilterViewId: savedId,
      };
    });

    return { ok: true, id: savedId };
  },

  applyWorkbenchSavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return false;
    const { workbenchSavedFilterViews } = get();
    const target = workbenchSavedFilterViews.find((view) => view.id === targetId);
    if (!target) return false;

    const payload = normalizeFilterPayload(target.filters);
    set({
      workbenchSearchQuery: payload.searchQuery,
      workbenchSelectedType: payload.selectedType,
      workbenchSelectedTags: payload.selectedTags,
      workbenchShowFavoritesOnly: payload.showFavoritesOnly,
      workbenchSelectedDateRange: payload.selectedDateRange,
      workbenchCustomDateStart: payload.customDateStart,
      workbenchCustomDateEnd: payload.customDateEnd,
      workbenchActiveFilterViewId: target.id,
    });
    return true;
  },

  deleteWorkbenchSavedFilterView: (id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;

    set((state) => {
      const nextViews = state.workbenchSavedFilterViews.filter((view) => view.id !== targetId);
      if (nextViews.length === state.workbenchSavedFilterViews.length) return {};
      persistWorkbenchSavedFilterViews(nextViews);
      return {
        workbenchSavedFilterViews: nextViews,
        workbenchActiveFilterViewId: state.workbenchActiveFilterViewId === targetId ? null : state.workbenchActiveFilterViewId,
      };
    });
  },

  toggleTagFilter: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter((value) => value !== tag)
        : [...selectedTags, tag],
    });
  },

  handleTagClick: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter((value) => value !== tag)
        : [...selectedTags, tag],
    });
  },
});
