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
  readCollectionRecentSearches,
  clearHistorySnapshot,
  readHistoryRecentSearches,
  readHistorySnapshot,
  readHistoryStreamEnabled,
  readSavedFilterViews,
  readActiveWorkbenchId,
  readWorkbenchRecentSearches,
  readWorkbenchSearchScope,
  readWorkbenchSavedFilterViews,
} from './modules';

const initialHistorySnapshot = readHistorySnapshot();
const initialHistoryRecentSearches = readHistoryRecentSearches();
const initialCollectionRecentSearches = readCollectionRecentSearches();
const initialSavedFilterViews = readSavedFilterViews();
const initialWorkbenchRecentSearches = readWorkbenchRecentSearches();
const initialWorkbenchSavedFilterViews = readWorkbenchSavedFilterViews();
const initialHistoryStreamEnabled = readHistoryStreamEnabled();
const initialActiveWorkbenchId = readActiveWorkbenchId();
const initialWorkbenchSearchScope = readWorkbenchSearchScope();

const useAppStore = create((set, get) => ({
  ...createBaseState({
    initialHistorySnapshot,
    historyRecentSearches: initialHistoryRecentSearches,
    collectionRecentSearches: initialCollectionRecentSearches,
    savedFilterViews: initialSavedFilterViews,
    workbenchRecentSearches: initialWorkbenchRecentSearches,
    workbenchSavedFilterViews: initialWorkbenchSavedFilterViews,
    historyStreamEnabled: initialHistoryStreamEnabled,
    initialActiveWorkbenchId,
    initialWorkbenchSearchScope,
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
