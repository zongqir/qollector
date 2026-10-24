import { normalizeCopyFeedbackSource } from './copyFeedback';
import { TOUR_COMPLETED_STORAGE_KEY } from '../../constants/storageKeys';

export const createUiActions = (set) => ({
  setShowSettings: (v, tab = null) => set({ showSettings: v, settingsInitialTab: v ? tab : null }),
  setIsAlwaysOnTop: (v) => set({ isAlwaysOnTop: v }),
  setIsMiniMode: (v) => set({ isMiniMode: v }),
  setPinBeforeMini: (v) => set({ pinBeforeMini: v }),
  setWorkbenchPanelBeforeMini: (v) => set({ workbenchPanelBeforeMini: v }),
  setIsLocked: (v) => set({ isLocked: v }),
  setThemeMode: (v) => set({ themeMode: v }),
  setEditNote: (v) => set({ editNote: v }),
  setNewTagInput: (v) => set({ newTagInput: v }),
  startTour: () => set({ tourActive: true, tourStep: 0, showSettings: false }),
  nextTourStep: () => set((state) => ({ tourStep: state.tourStep + 1 })),
  prevTourStep: () => set((state) => ({ tourStep: Math.max(0, state.tourStep - 1) })),
  completeTour: () => {
    set({ tourActive: false, tourStep: 0 });
    localStorage.setItem(TOUR_COMPLETED_STORAGE_KEY, 'true');
  },
  setCopiedItemId: (v, source = 'global') => set((state) => ({
    copiedItemId: v,
    copyFeedbackSource: v ? normalizeCopyFeedbackSource(source) : null,
    copyFeedbackToken: state.copyFeedbackToken + 1,
    lastCopyWasAutoPaste: false,
  })),
  setDebouncedSearchQuery: (v) => set({ debouncedSearchQuery: v }),
  setEmailRelayConfig: (config) => set({
    emailRelayConfig: config,
    emailRelayEnabled: Boolean(config?.enabled),
  }),
});
