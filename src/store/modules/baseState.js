import { buildItemDerivations } from './itemsIndex';

export const createBaseState = ({
  initialHistorySnapshot,
  historyRecentSearches,
  collectionRecentSearches,
  savedFilterViews,
  historyStreamEnabled,
}) => {
  const itemDerivations = buildItemDerivations(initialHistorySnapshot);
  return ({
  // ========== 历史数据 ==========
  items: initialHistorySnapshot,
  ...itemDerivations,
  loading: initialHistorySnapshot.length === 0,
  hasMore: true,
  loadingMore: false,
  historyLoadStopReason: null,
  itemsRevision: 0,
  processedItemIds: new Set(),
  isMemorySuspended: false,
  memorySuspendVersion: 0,
  memoryResumeVersion: 0,

  // ========== 右栏面板状态机 ==========
  // 'preview' | 'compare' | 'timeline'
  panelMode: 'preview',
  previewItem: null,
  previewReturnMode: 'preview',
  previewReturnViewMode: 'all',
  compareCandidateIds: [],
  compareItemIds: [],

  // ========== 时间旅行状态 ==========
  timelineDate: 'today', // 'today' | 'yesterday'
  timelineItems: [],
  timelineSummary: null,
  timelineLoading: false,
  timelineError: null,
  timelineSummaryCache: {}, // { 'today': { summary: '...', timestamp: 123456 }, 'yesterday': { summary: '...', timestamp: 123456 } }

  // ========== 搜索/筛选 ==========
  searchQuery: '',
  debouncedSearchQuery: '',
  historyRecentSearches,
  collectionSearchQuery: '',
  collectionRecentSearches,
  selectedType: 'all',
  selectedTags: [],
  showFavoritesOnly: false,
  showPinnedOnly: false,
  showTagFilter: false,
  tagSearchQuery: '',
  selectedDateRange: null,
  showDateFilter: false,
  customDateStart: '',
  customDateEnd: '',
  savedFilterViews,
  activeFilterViewId: null,

  // ========== 多选状态 ==========
  selectedItemIds: [],

  // ========== keyboard focus ==========
  focusedIndex: -1,

  // ========== UI 状态 ==========
  copiedItemId: null,
  copyFeedbackSource: null,
  copyFeedbackToken: 0,
  generatingAI: null,
  ocrProcessing: null,
  showSettings: false,
  settingsInitialTab: null,
  isAlwaysOnTop: false,
  isMiniMode: false,
  pinBeforeMini: false,
  workbenchPanelBeforeMini: null,

  // ========== 配置 ==========
  aiEnabled: false,
  ocrEnabled: false,
  licenseStatus: 'Free',
  isProUser: false,
  maxPinnedItems: 10,
  themeMode: 'system',
  isLocked: true,
  hasPassword: false,
  workbenchPanelEnabled: true,
  historyStreamEnabled,
  lowMemoryModeEnabled: false,
  autoPasteOnDoubleClick: false,
  copyOnSelectEnabled: false,
  copyOnSelectDoubleClickEnabled: true,
  quickActionBubbleEnabled: false,
  copyQollectSourceItems: false,
  lastCopyWasAutoPaste: false,
  widgetEnabled: false,
  historyTagShortcutEnabled: true,
  autoCleanupEnabled: true,
  cleanupMaxItems: 50000,
  cleanupMaxAgeDays: 90,
  startupFavoritesViewEnabled: false,
  autoLayoutSwitchEnabled: true,

  // ========== 悬浮预览 ==========
  hoverPreviewItem: null,
  hoverPreviewPosition: null,

  // ========== 备注编辑 ==========
  editingNoteId: null,
  editNote: '',

  // ========== 标签管理 ==========
  addingTagItemId: null,
  newTagInput: '',

  // ========== 编辑弹窗 ==========
  showEditModal: false,
  editModalMode: 'new',
  editingItem: null,
  editModalInitialFocus: null,

  // ========== Guided Tour ==========
  tourActive: false,
  tourStep: 0,

  // ========== 分享 ==========
  shareModalItem: null,
  shareResult: null,
  shareLoading: false,
  shareError: null,
  sharePendingConfirm: false,
  sharePendingData: null,
  sharePendingProvider: null,
  shareConfig: null,
  });
};
