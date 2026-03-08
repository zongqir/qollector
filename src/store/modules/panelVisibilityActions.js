import { invoke } from '@tauri-apps/api/core';
import { persistHistoryStreamEnabled } from './historyStreamVisibility';

export const createPanelVisibilityActions = (set, get) => ({
  setWorkbenchPanelEnabled: (v) => {
    const nextPanelEnabled = Boolean(v);
    const updates = { workbenchPanelEnabled: nextPanelEnabled };
    if (!nextPanelEnabled) {
      Object.assign(updates, { hoverPreviewItem: null, hoverPreviewPosition: null });
    }
    set(updates);
  },

  toggleWorkbenchPanel: async () => {
    const next = !get().workbenchPanelEnabled;
    get().setWorkbenchPanelEnabled(next);
    try {
      const generalConfig = await invoke('get_general_config');
      await invoke('update_general_config', {
        config: { ...generalConfig, workbench_panel_enabled: next },
      });
    } catch (error) {
      console.error('persist workbench panel visibility failed:', error);
    }
  },

  setHistoryStreamEnabled: (v) => {
    const next = Boolean(v);
    const state = get();
    if (state.isMiniMode && !next) {
      return;
    }
    const updates = { historyStreamEnabled: next };
    if (!next && !state.workbenchPanelEnabled) {
      updates.workbenchPanelEnabled = true;
    }
    set(updates);
    persistHistoryStreamEnabled(next);
  },

  toggleHistoryStream: () => {
    const state = get();
    if (state.isMiniMode) return;
    const visibleNow = state.historyStreamEnabled || !state.workbenchPanelEnabled;
    get().setHistoryStreamEnabled(!visibleNow);
  },

  setHoverPreview: (item, position) => {
    set({ hoverPreviewItem: item, hoverPreviewPosition: position });
  },

  clearHoverPreview: () => {
    set({ hoverPreviewItem: null, hoverPreviewPosition: null });
  },
});
