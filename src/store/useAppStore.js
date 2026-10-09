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
  SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK,
  SUPPORTS_COPY_ON_SELECT,
  readCollectionRecentSearches,
  clearHistorySnapshot,
  readHistoryRecentSearches,
  readHistorySnapshot,
  readHistoryStreamEnabled,
  readSavedFilterViews,
} from './modules';

const initialHistorySnapshot = readHistorySnapshot();
const initialHistoryRecentSearches = readHistoryRecentSearches();
const initialCollectionRecentSearches = readCollectionRecentSearches();
const initialSavedFilterViews = readSavedFilterViews();
const initialHistoryStreamEnabled = readHistoryStreamEnabled();

const useAppStore = create((set, get) => ({
  ...createBaseState({
    initialHistorySnapshot,
    historyRecentSearches: initialHistoryRecentSearches,
    collectionRecentSearches: initialCollectionRecentSearches,
    savedFilterViews: initialSavedFilterViews,
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
    supportsCopyOnSelect: SUPPORTS_COPY_ON_SELECT,
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
}));

export default useAppStore;
