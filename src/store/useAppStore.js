import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { applyAccentColor } from '../hooks/useTheme';
import {
  createBaseState,
  createDataLoadingActions,
  createEditModalActions,
  createFilterActions,
  createItemActions,
  createLoadConfigsAction,
  createNoteActions,
  createPanelActions,
  createPanelVisibilityActions,
  createRuntimeActions,
  createSelectionActions,
  createShareActions,
  createTagActions,
  createTimelineActions,
  createUiActions,
  createWorkbenchActions,
  SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK,
  clearHistorySnapshot,
  readHistorySnapshot,
  readHistoryStreamEnabled,
  readSavedFilterViews,
  readWorkbenchSavedFilterViews,
} from './modules';

const initialHistorySnapshot = readHistorySnapshot();
const initialSavedFilterViews = readSavedFilterViews();
const initialWorkbenchSavedFilterViews = readWorkbenchSavedFilterViews();
const initialHistoryStreamEnabled = readHistoryStreamEnabled();

const useAppStore = create((set, get) => ({
  ...createBaseState({
    initialHistorySnapshot,
    savedFilterViews: initialSavedFilterViews,
    workbenchSavedFilterViews: initialWorkbenchSavedFilterViews,
    historyStreamEnabled: initialHistoryStreamEnabled,
  }),
  ...createPanelActions(set, get),

  ...createTimelineActions(set, get),

  ...createPanelVisibilityActions(set, get),

  ...createDataLoadingActions(set, get),

  loadConfigs: createLoadConfigsAction({
    set,
    invoke,
    applyAccentColor,
    supportsAutoPasteOnDoubleClick: SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK,
  }),

  ...createItemActions(set, get),

  ...createNoteActions(set, get),

  ...createTagActions(set, get),

  ...createSelectionActions(set, get),

  ...createFilterActions(set, get),

  ...createEditModalActions(set, get),

  ...createShareActions(set, get),

  ...createUiActions(set),
  ...createRuntimeActions(set, clearHistorySnapshot),

  ...createWorkbenchActions(set, get),
}));

export default useAppStore;
