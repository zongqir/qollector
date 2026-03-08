import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  Package,
  Star,
  X,
  Type,
  Image,
  File,
  Link,
  Braces,
  Layers,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import useAppStore from '../../store/useAppStore';
import SortableWorkbenchCard from './SortableWorkbenchCard';
import WorkbenchQuickNoteSection from './WorkbenchQuickNoteSection';
import WorkbenchMultiSelectBar from './WorkbenchMultiSelectBar';
import WorkbenchQuickActionsBar from './WorkbenchQuickActionsBar';
import HistoryContextMenu from '../HistoryStream/HistoryContextMenu';
import useHistoryContextMenu from '../HistoryStream/hooks/useHistoryContextMenu';
import useEscapeDismiss from '../hooks/useEscapeDismiss';
import useClickOutsideDismiss from '../hooks/useClickOutsideDismiss';
import useFilterDropdownCoordinator from '../hooks/useFilterDropdownCoordinator';
import TagFilterControl from '../shared/TagFilterControl';
import SavedViewControl from '../shared/SavedViewControl';
import TypeFilterControl from '../shared/TypeFilterControl';
import DateFilterControl from '../shared/DateFilterControl';
import {
  PanelSummaryActionButton,
  PanelSummaryBadge,
  PanelSummaryFeedback,
  PanelSummaryRow,
  PanelSummaryText,
} from '../shared/PanelSummaryRow';
import {
  getUserTags as getUserTagsSvc,
  getWorkbenchPinnedItems,
  reorderWorkbenchPinnedItems,
  searchItems,
} from '../../services/clipboardService';
import { openHistoryEditorWindow } from '../../services/windowService';
import useWorkbenchQuickActions from './hooks/useWorkbenchQuickActions';
import useWorkbenchBatchActions from './hooks/useWorkbenchBatchActions';
import { INTERNAL_DRAG_MIME } from '../../constants/dragDrop';
import {
  getDateRangeForPreset,
  dateStringToTimestamp,
  dateStringToEndTimestamp,
} from '../../utils/dateHelpers';
import { getTags, getSourceApp, buildSourceTag, buildTypeTag, parseSystemTag } from '../../utils/tagHelpers';
import {
  SORT_MODE_LONG_PRESS_MOVE_PX,
  SORT_MODE_LONG_PRESS_MS,
  shouldIgnoreLongPressTarget,
  openItemPreview,
} from '../../utils/previewInteractionPolicy';
import { isQollectManagedSource } from '../../utils/sourceConstants';
import {
  buildSearchRequest,
  SEARCH_REQUEST_TRIGGER_MODE,
} from '../../utils/searchRequestBuilder';

const WORKBENCH_SEARCH_DEBOUNCE_MS = 260;

function WorkbenchPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const [workbenchSortMode, setWorkbenchSortMode] = useState(false);
  const [workbenchSortAnchorItemId, setWorkbenchSortAnchorItemId] = useState(null);
  const [showSortEntryToast, setShowSortEntryToast] = useState(false);
  const [showWorkbenchTypeFilter, setShowWorkbenchTypeFilter] = useState(false);
  const [showWorkbenchDateFilter, setShowWorkbenchDateFilter] = useState(false);
  const [showWorkbenchTagFilter, setShowWorkbenchTagFilter] = useState(false);
  const [showWorkbenchSavedViews, setShowWorkbenchSavedViews] = useState(false);
  const [workbenchSavedViewName, setWorkbenchSavedViewName] = useState('');
  const [workbenchTagSearchQuery, setWorkbenchTagSearchQuery] = useState('');
  const [debouncedWorkbenchTagSearchQuery, setDebouncedWorkbenchTagSearchQuery] = useState('');
  const [backendWorkbenchUserTags, setBackendWorkbenchUserTags] = useState([]);
  const [workbenchDebouncedSearchQuery, setWorkbenchDebouncedSearchQuery] = useState('');
  const [backendFilteredPinnedIds, setBackendFilteredPinnedIds] = useState(null);
  const [backendPinnedItems, setBackendPinnedItems] = useState(null);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [workbenchFiltering, setWorkbenchFiltering] = useState(false);
  const [workbenchLoadError, setWorkbenchLoadError] = useState('');
  const [workbenchFilterError, setWorkbenchFilterError] = useState('');
  const [workbenchRefreshNonce, setWorkbenchRefreshNonce] = useState(0);
  const [workbenchTimeTick, setWorkbenchTimeTick] = useState(() => Date.now());
  const [transientWorkbenchToast, setTransientWorkbenchToast] = useState('');
  const [pendingUnpinItemId, setPendingUnpinItemId] = useState(null);
  const selectionAnchorIndexRef = useRef(-1);
  const workbenchTypeWrapperRef = useRef(null);
  const workbenchDateWrapperRef = useRef(null);
  const workbenchTagWrapperRef = useRef(null);
  const workbenchSavedViewWrapperRef = useRef(null);
  const workbenchTagListboxRef = useRef(null);
  const quickNoteSubmittingRef = useRef(false);
  const workbenchCardsRef = useRef(null);
  const workbenchCardRefsRef = useRef(new Map());
  const workbenchSortAnchorRef = useRef(null);
  const workbenchSortLongPressTimerRef = useRef(null);
  const workbenchSortEntryToastTimerRef = useRef(null);
  const workbenchToastTimerRef = useRef(null);
  const workbenchUnpinConfirmTimerRef = useRef(null);
  const workbenchSortLongPressPointerRef = useRef({ pointerId: null, x: 0, y: 0 });
  const suppressNextCardClickRef = useRef(false);

  const items = useAppStore(s => s.items);
  const itemsRevision = useAppStore(s => s.itemsRevision);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const addQuickNote = useAppStore(s => s.addQuickNote);
  const togglePin = useAppStore(s => s.togglePin);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const loadItems = useAppStore(s => s.loadItems);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const handleCopyAndAutoPaste = useAppStore(s => s.handleCopyAndAutoPaste);
  const handleCopy = useAppStore(s => s.handleCopy);
  const handleCopyPlainText = useAppStore(s => s.handleCopyPlainText);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleRevealInFolder = useAppStore(s => s.handleRevealInFolder);
  const setCardBackground = useAppStore(s => s.setCardBackground);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const autoPasteOnDoubleClick = useAppStore(s => s.autoPasteOnDoubleClick);
  const deleteItem = useAppStore(s => s.deleteItem);
  const setFocusedIndex = useAppStore(s => s.setFocusedIndex);
  const openEditModal = useAppStore(s => s.openEditModal);
  const searchQuery = useAppStore(s => s.workbenchSearchQuery);
  const selectedType = useAppStore(s => s.workbenchSelectedType);
  const selectedTags = useAppStore(s => s.workbenchSelectedTags);
  const showFavoritesOnly = useAppStore(s => s.workbenchShowFavoritesOnly);
  const selectedDateRange = useAppStore(s => s.workbenchSelectedDateRange);
  const customDateStart = useAppStore(s => s.workbenchCustomDateStart);
  const customDateEnd = useAppStore(s => s.workbenchCustomDateEnd);
  const copyQollectSourceItems = useAppStore(s => s.copyQollectSourceItems);
  const savedFilterViews = useAppStore(s => s.workbenchSavedFilterViews);
  const activeFilterViewId = useAppStore(s => s.workbenchActiveFilterViewId);
  const setSearchQuery = useAppStore(s => s.setWorkbenchSearchQuery);
  const setSelectedType = useAppStore(s => s.setWorkbenchSelectedType);
  const setSelectedTags = useAppStore(s => s.setWorkbenchSelectedTags);
  const setShowFavoritesOnly = useAppStore(s => s.setWorkbenchShowFavoritesOnly);
  const setSelectedDateRange = useAppStore(s => s.setWorkbenchSelectedDateRange);
  const setCustomDateStart = useAppStore(s => s.setWorkbenchCustomDateStart);
  const setCustomDateEnd = useAppStore(s => s.setWorkbenchCustomDateEnd);
  const clearDateFilter = useAppStore(s => s.clearWorkbenchDateFilter);
  const saveCurrentFilterView = useAppStore(s => s.saveCurrentWorkbenchFilterView);
  const applySavedFilterView = useAppStore(s => s.applyWorkbenchSavedFilterView);
  const deleteSavedFilterView = useAppStore(s => s.deleteWorkbenchSavedFilterView);
  const clearActiveFilterView = useAppStore(s => s.clearWorkbenchActiveFilterView);

  useEffect(() => {
    let cancelled = false;
    setWorkbenchLoading(true);
    getWorkbenchPinnedItems()
      .then((results) => {
        if (cancelled) return;
        setBackendPinnedItems(Array.isArray(results) ? results : []);
        setWorkbenchLoadError('');
      })
      .catch((error) => {
        console.error('[Workbench] fetch pinned items failed:', error);
        if (!cancelled) {
          setBackendPinnedItems(null);
          const message = typeof error === 'string' ? error : String(error?.message || error || '');
          setWorkbenchLoadError(message || t('workbench.queryFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkbenchLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemsRevision, workbenchRefreshNonce, t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setWorkbenchDebouncedSearchQuery(searchQuery);
    }, WORKBENCH_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setWorkbenchTimeTick(Date.now());
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedWorkbenchTagSearchQuery(workbenchTagSearchQuery.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [workbenchTagSearchQuery]);

  useEffect(() => {
    let cancelled = false;
    getUserTagsSvc(debouncedWorkbenchTagSearchQuery, 200, { onlyPinned: true })
      .then((tags) => {
        if (cancelled) return;
        if (!Array.isArray(tags)) {
          setBackendWorkbenchUserTags([]);
          return;
        }
        setBackendWorkbenchUserTags(
          tags.filter(tag => typeof tag === 'string' && tag.trim() && !tag.startsWith('AI:')),
        );
      })
      .catch((error) => {
        console.error('[Workbench] load pinned user tags failed:', error);
        if (!cancelled) setBackendWorkbenchUserTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedWorkbenchTagSearchQuery, backendPinnedItems, itemsRevision]);

  const pinnedBaseItems = useMemo(() => {
    if (Array.isArray(backendPinnedItems)) return backendPinnedItems;
    return [...items.filter(item => item.is_pinned)].sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left?.pin_order)) ? Number(left.pin_order) : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(Number(right?.pin_order)) ? Number(right.pin_order) : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return Number(right?.pinned_at || 0) - Number(left?.pinned_at || 0);
    });
  }, [backendPinnedItems, items]);

  const allPinnedItems = useMemo(() => pinnedBaseItems, [pinnedBaseItems]);

  const workbenchBackendFilterRequest = useMemo(() => {
    return buildSearchRequest({
      queryText: workbenchDebouncedSearchQuery,
      selectedType,
      selectedTags,
      showFavoritesOnly,
      selectedDateRange,
      baseFilters: { is_pinned: true },
      triggerMode: SEARCH_REQUEST_TRIGGER_MODE.ADDITIONAL_STRUCTURED_FILTER,
      t,
    });
  }, [
    workbenchDebouncedSearchQuery,
    selectedType,
    showFavoritesOnly,
    selectedTags,
    selectedDateRange,
    t,
    i18n.language,
  ]);

  useEffect(() => {
    if (!workbenchBackendFilterRequest.shouldQueryBackend) {
      setBackendFilteredPinnedIds(null);
      setWorkbenchFiltering(false);
      setWorkbenchFilterError('');
      return;
    }

    let cancelled = false;
    setWorkbenchFiltering(true);
    const limit = Math.max(600, Math.min(6000, allPinnedItems.length + 400));
    searchItems(workbenchBackendFilterRequest.query, limit, workbenchBackendFilterRequest.filters)
      .then((results) => {
        if (cancelled) return;
        const ids = new Set((Array.isArray(results) ? results : []).map((item) => item.id));
        setBackendFilteredPinnedIds(ids);
        setWorkbenchFilterError('');
      })
      .catch((error) => {
        console.error('[Workbench] backend filter search failed:', error);
        if (!cancelled) {
          setBackendFilteredPinnedIds(null);
          const message = typeof error === 'string' ? error : String(error?.message || error || '');
          setWorkbenchFilterError(message || t('workbench.queryFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkbenchFiltering(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workbenchBackendFilterRequest, allPinnedItems.length, itemsRevision, workbenchRefreshNonce, t]);

  const pinnedItems = useMemo(() => {
    if (!(backendFilteredPinnedIds instanceof Set)) {
      return allPinnedItems;
    }
    return allPinnedItems.filter((item) => backendFilteredPinnedIds.has(item.id));
  }, [
    allPinnedItems,
    backendFilteredPinnedIds,
  ]);

  const workbenchBackendError = workbenchFilterError || workbenchLoadError;
  const isWorkbenchBusy = workbenchLoading || workbenchFiltering;

  const selectedPinnedItems = useMemo(() => {
    if (selectedPinnedIds.length === 0) return [];
    const selectedIdSet = new Set(selectedPinnedIds);
    return pinnedItems.filter(item => selectedIdSet.has(item.id));
  }, [selectedPinnedIds, pinnedItems]);

  const allSelectedAreText = useMemo(
    () => selectedPinnedItems.length > 0 && selectedPinnedItems.every(item => item.type_ === 'text'),
    [selectedPinnedItems],
  );

  const batchAiSourceText = useMemo(
    () => selectedPinnedItems
      .map(item => item.content || '')
      .filter(Boolean)
      .join('\n\n'),
    [selectedPinnedItems],
  );

  const canRunBatchAi = aiEnabled && allSelectedAreText && batchAiSourceText.trim().length > 0;
  const allSelectedAreFavorite = selectedPinnedItems.length > 0
    && selectedPinnedItems.every(item => item.is_favorite);
  const allSelectedArePinned = selectedPinnedItems.length > 0
    && selectedPinnedItems.every(item => item.is_pinned);

  const allTags = useMemo(() => {
    const fallbackUserTags = new Set();
    const sourceTags = new Set();
    const typeTags = new Set();

    pinnedBaseItems.forEach((item) => {
      const tags = getTags(item.tags);
      tags.forEach((tag) => {
        if (!tag.startsWith('AI:')) fallbackUserTags.add(tag);
      });

      const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
      if (sourceTag) sourceTags.add(sourceTag);

      const typeTag = buildTypeTag(item.type_, t);
      if (typeTag) typeTags.add(typeTag);
    });

    const localFallbackList = Array.from(fallbackUserTags).sort();
    const seenBackendTags = new Set();
    const normalizedBackendTags = [];
    backendWorkbenchUserTags.forEach((tag) => {
      if (typeof tag !== 'string') return;
      const normalized = tag.trim();
      if (!normalized || seenBackendTags.has(normalized)) return;
      seenBackendTags.add(normalized);
      normalizedBackendTags.push(normalized);
    });
    const userTagList = normalizedBackendTags.length > 0
      ? normalizedBackendTags
      : (!debouncedWorkbenchTagSearchQuery ? localFallbackList : []);

    return [
      ...Array.from(typeTags).sort(),
      ...userTagList,
      ...Array.from(sourceTags).sort(),
    ];
  }, [pinnedBaseItems, backendWorkbenchUserTags, debouncedWorkbenchTagSearchQuery, t, i18n.language]);

  const filteredTagsList = useMemo(() => {
    if (!workbenchTagSearchQuery.trim()) return allTags;
    const query = workbenchTagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, workbenchTagSearchQuery]);

  const typeOptions = [
    { key: 'all', icon: <Layers size={14} /> },
    { key: 'text', icon: <Type size={14} /> },
    { key: 'image', icon: <Image size={14} /> },
    { key: 'file', icon: <File size={14} /> },
    { key: 'link', icon: <Link size={14} /> },
    { key: 'code', icon: <Braces size={14} /> },
  ];
  const selectedTypeOption = typeOptions.find(({ key }) => key === selectedType) || typeOptions[0];
  const workbenchTypeDropdownId = 'workbench-type-filter-dropdown';
  const workbenchDateDropdownId = 'workbench-date-filter-dropdown';
  const workbenchTagDropdownId = 'workbench-tag-filter-dropdown';
  const workbenchTagListboxId = `${workbenchTagDropdownId}-options`;
  const workbenchSavedViewDropdownId = 'workbench-saved-view-dropdown';
  const selectedDatePreset = selectedDateRange?.preset || null;
  const typeFilterOptions = typeOptions.map(({ key, icon }) => ({ key, icon }));
  const parsedTagOptions = useMemo(() => (
    filteredTagsList
      .map((tag) => {
        const parsed = parseSystemTag(tag, {
          sourcePrefix: t('tag.source'),
          typePrefix: t('tag.type'),
        });
        return {
          key: tag,
          tag,
          kind: parsed.kind,
          displayTag: parsed.displayText,
          isAITag: parsed.kind === 'ai',
          isSourceTag: parsed.kind === 'source',
          isUserTag: parsed.kind !== 'ai' && parsed.kind !== 'source',
        };
      })
      .filter((option) => option.kind !== 'type')
  ), [filteredTagsList, t]);
  const visibleTagOptions = parsedTagOptions.slice(0, 20);
  const savedViews = Array.isArray(savedFilterViews) ? savedFilterViews : [];
  const activeSavedView = savedViews.find(view => view.id === activeFilterViewId) || null;

  const datePresets = [
    { key: 'today', label: t('toolbar.dateToday'), badge: t('toolbar.dateBadgeToday') },
    { key: 'yesterday', label: t('toolbar.dateYesterday'), badge: t('toolbar.dateBadgeYesterday') },
    { key: '7d', label: t('toolbar.dateLast7Days'), badge: t('toolbar.dateBadgeLast7Days') },
    { key: '30d', label: t('toolbar.dateLast30Days'), badge: t('toolbar.dateBadgeLast30Days') },
    { key: 'custom', label: t('toolbar.dateCustomRange'), badge: t('toolbar.dateBadgeCustomRange') },
  ];
  const datePresetOptions = datePresets.map(({ key, label }) => ({ key, label }));

  const workbenchDateBadgeText = selectedDateRange
    ? (selectedDateRange.preset === 'custom'
      ? t('toolbar.dateBadgeCustomRange')
      : datePresets.find(preset => preset.key === selectedDateRange.preset)?.badge || '')
    : '';
  const truncatedWorkbenchQuery = useMemo(() => {
    const normalized = typeof searchQuery === 'string' ? searchQuery.trim() : '';
    if (!normalized) return '';
    return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized;
  }, [searchQuery]);

  const hasWorkbenchFilters = Boolean(
    searchQuery.trim()
    || selectedType !== 'all'
    || showFavoritesOnly
    || selectedDateRange != null
    || selectedTags.length > 0
    || activeSavedView
  );
  const workbenchFilterSummaryParts = useMemo(() => {
    const parts = [];
    if (truncatedWorkbenchQuery) {
      parts.push(t('toolbar.keywordFilterActive', { query: truncatedWorkbenchQuery }));
    }
    if (selectedType !== 'all') {
      parts.push(t('search.empty.filterType', { type: t(`search.typeFilter.${selectedType}`) }));
    }
    if (selectedTags.length > 0) {
      parts.push(t('search.empty.filterTags', { count: selectedTags.length }));
    }
    if (selectedDateRange) {
      parts.push(t('toolbar.dateFilterActive'));
    }
    if (showFavoritesOnly) {
      parts.push(t('search.empty.filterFavorites'));
    }
    if (activeSavedView) {
      parts.push(t('search.savedViews.using', { name: activeSavedView.name }));
    }
    return parts;
  }, [
    activeSavedView,
    selectedDateRange,
    selectedTags.length,
    selectedType,
    showFavoritesOnly,
    t,
    truncatedWorkbenchQuery,
  ]);
  const shouldShowWorkbenchSummaryRow = workbenchFilterSummaryParts.length > 0
    || Boolean(workbenchBackendError && pinnedItems.length > 0)
    || (isWorkbenchBusy && pinnedItems.length > 0);
  const isWorkbenchSortMode = workbenchSortMode && selectedPinnedIds.length === 0;
  const workbenchDragEnabled = isWorkbenchSortMode && pinnedItems.length > 1;

  const handleRetryWorkbenchLoad = useCallback(() => {
    setWorkbenchLoadError('');
    setWorkbenchFilterError('');
    setWorkbenchRefreshNonce((current) => current + 1);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const setWorkbenchCardRef = useCallback((itemId, node) => {
    const map = workbenchCardRefsRef.current;
    if (!itemId) return;
    if (node) {
      map.set(itemId, node);
      return;
    }
    map.delete(itemId);
  }, []);

  const clearWorkbenchSortLongPressTimer = useCallback(() => {
    if (workbenchSortLongPressTimerRef.current) {
      clearTimeout(workbenchSortLongPressTimerRef.current);
      workbenchSortLongPressTimerRef.current = null;
    }
  }, []);

  const showWorkbenchSortEntryToast = useCallback(() => {
    setShowSortEntryToast(true);
    if (workbenchSortEntryToastTimerRef.current) {
      clearTimeout(workbenchSortEntryToastTimerRef.current);
    }
    workbenchSortEntryToastTimerRef.current = setTimeout(() => {
      setShowSortEntryToast(false);
      workbenchSortEntryToastTimerRef.current = null;
    }, 1300);
  }, []);

  const handleFinishWorkbenchSortMode = useCallback(() => {
    setWorkbenchSortMode(false);
    setWorkbenchSortAnchorItemId(null);
    setShowSortEntryToast(false);
    clearWorkbenchSortLongPressTimer();
    workbenchSortLongPressPointerRef.current.pointerId = null;
    workbenchSortAnchorRef.current = null;
  }, [clearWorkbenchSortLongPressTimer]);

  const handleDragEnd = useCallback((event) => {
    if (!isWorkbenchSortMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = allPinnedItems.findIndex(i => i.id === active.id);
    const newIndex = allPinnedItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const nextOrderedItems = arrayMove(allPinnedItems, oldIndex, newIndex);
    const orderedIds = nextOrderedItems.map(item => item.id);
    setBackendPinnedItems(nextOrderedItems);
    reorderWorkbenchPinnedItems(orderedIds).catch(async (error) => {
      console.error('[Workbench] persist pinned order failed:', error);
      try {
        const latest = await getWorkbenchPinnedItems();
        setBackendPinnedItems(Array.isArray(latest) ? latest : []);
      } catch (refreshError) {
        console.error('[Workbench] refresh pinned items after reorder failed:', refreshError);
      }
    });
  }, [allPinnedItems, isWorkbenchSortMode]);

  const handleWorkbenchTypeChange = useCallback((nextType) => {
    setSelectedType(nextType);
    setShowWorkbenchTypeFilter(false);
  }, [setSelectedType]);

  const closeWorkbenchTypeFilter = useCallback(() => {
    if (showWorkbenchTypeFilter) {
      setShowWorkbenchTypeFilter(false);
    }
  }, [showWorkbenchTypeFilter]);

  const closeWorkbenchDateFilter = useCallback(() => {
    if (showWorkbenchDateFilter) {
      setShowWorkbenchDateFilter(false);
    }
  }, [showWorkbenchDateFilter]);

  const closeWorkbenchTagFilter = useCallback(() => {
    if (showWorkbenchTagFilter) {
      setShowWorkbenchTagFilter(false);
    }
  }, [showWorkbenchTagFilter]);

  const closeWorkbenchSavedViews = useCallback(() => {
    if (showWorkbenchSavedViews) {
      setShowWorkbenchSavedViews(false);
    }
  }, [showWorkbenchSavedViews]);

  const coordinatedDropdowns = useMemo(() => ({
    saved: {
      isOpen: showWorkbenchSavedViews,
      open: () => setShowWorkbenchSavedViews(true),
      close: closeWorkbenchSavedViews,
    },
    type: {
      isOpen: showWorkbenchTypeFilter,
      open: () => setShowWorkbenchTypeFilter(true),
      close: closeWorkbenchTypeFilter,
    },
    date: {
      isOpen: showWorkbenchDateFilter,
      open: () => setShowWorkbenchDateFilter(true),
      close: closeWorkbenchDateFilter,
    },
    tag: {
      isOpen: showWorkbenchTagFilter,
      open: () => setShowWorkbenchTagFilter(true),
      close: closeWorkbenchTagFilter,
    },
  }), [
    showWorkbenchSavedViews,
    closeWorkbenchSavedViews,
    showWorkbenchTypeFilter,
    closeWorkbenchTypeFilter,
    showWorkbenchDateFilter,
    closeWorkbenchDateFilter,
    showWorkbenchTagFilter,
    closeWorkbenchTagFilter,
  ]);

  const {
    hasOpenDropdown,
    toggleDropdown,
    dismissOpenDropdowns,
  } = useFilterDropdownCoordinator(coordinatedDropdowns);

  const toggleWorkbenchTypeFilter = useCallback(() => {
    toggleDropdown('type');
  }, [toggleDropdown]);

  const toggleWorkbenchDateFilter = useCallback(() => {
    toggleDropdown('date');
  }, [toggleDropdown]);

  const toggleWorkbenchTagFilter = useCallback(() => {
    toggleDropdown('tag');
  }, [toggleDropdown]);

  const toggleWorkbenchSavedViews = useCallback(() => {
    toggleDropdown('saved');
  }, [toggleDropdown]);

  const handleSelectWorkbenchDatePreset = useCallback((preset) => {
    if (preset === 'custom') {
      setSelectedDateRange({ preset: 'custom', start: null, end: null });
      return;
    }

    const range = getDateRangeForPreset(preset);
    if (range) {
      setSelectedDateRange(range);
    }
  }, [setSelectedDateRange]);

  const handleApplyWorkbenchCustomDateRange = useCallback(() => {
    const start = dateStringToTimestamp(customDateStart);
    const end = dateStringToEndTimestamp(customDateEnd);
    if (start != null || end != null) {
      setSelectedDateRange({ preset: 'custom', start, end });
    }
  }, [customDateStart, customDateEnd, setSelectedDateRange]);

  const handleClearWorkbenchDateFilter = useCallback(() => {
    clearDateFilter();
    setShowWorkbenchDateFilter(false);
  }, [clearDateFilter]);

  const handleToggleWorkbenchTag = useCallback((tag) => {
    setSelectedTags(
      selectedTags.includes(tag)
        ? selectedTags.filter(current => current !== tag)
        : [...selectedTags, tag],
    );
  }, [selectedTags, setSelectedTags]);

  const handleWorkbenchTagSearchInputKeyDown = useCallback((event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (visibleTagOptions.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      workbenchTagListboxRef.current?.focusLast?.();
      return;
    }
    workbenchTagListboxRef.current?.focusFirst?.();
  }, [visibleTagOptions.length]);

  const handleSaveWorkbenchView = useCallback(() => {
    const normalizedName = workbenchSavedViewName.trim();
    if (!normalizedName) return;
    const result = saveCurrentFilterView(normalizedName);
    if (result?.ok) {
      setWorkbenchSavedViewName('');
    }
  }, [workbenchSavedViewName, saveCurrentFilterView]);

  const handleClearWorkbenchFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedType('all');
    setSelectedTags([]);
    setWorkbenchTagSearchQuery('');
    setShowWorkbenchTagFilter(false);
    setShowWorkbenchSavedViews(false);
    setShowWorkbenchTypeFilter(false);
    setShowFavoritesOnly(false);
    handleClearWorkbenchDateFilter();
    clearActiveFilterView();
  }, [
    clearActiveFilterView,
    handleClearWorkbenchDateFilter,
    setSearchQuery,
    setSelectedType,
    setSelectedTags,
    setShowFavoritesOnly,
  ]);

  useEffect(() => {
    const pinnedIdSet = new Set(pinnedItems.map(item => item.id));
    setSelectedPinnedIds((current) => {
      const next = current.filter(id => pinnedIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [pinnedItems]);

  useEffect(() => {
    if (selectedPinnedIds.length > 0) return;
    selectionAnchorIndexRef.current = -1;
  }, [selectedPinnedIds.length]);

  useEffect(() => {
    if (!workbenchSortMode) return;
    if (selectedPinnedIds.length > 0) {
      handleFinishWorkbenchSortMode();
    }
  }, [selectedPinnedIds.length, workbenchSortMode, handleFinishWorkbenchSortMode]);

  useEffect(() => {
    if (!workbenchSortMode) return;
    if (pinnedItems.length <= 1) {
      handleFinishWorkbenchSortMode();
    }
  }, [pinnedItems.length, workbenchSortMode, handleFinishWorkbenchSortMode]);

  useClickOutsideDismiss({
    isOpen: showWorkbenchTypeFilter,
    wrapperRef: workbenchTypeWrapperRef,
    onDismiss: () => setShowWorkbenchTypeFilter(false),
  });
  useClickOutsideDismiss({
    isOpen: showWorkbenchDateFilter,
    wrapperRef: workbenchDateWrapperRef,
    onDismiss: () => setShowWorkbenchDateFilter(false),
  });
  useClickOutsideDismiss({
    isOpen: showWorkbenchTagFilter,
    wrapperRef: workbenchTagWrapperRef,
    onDismiss: () => setShowWorkbenchTagFilter(false),
  });
  useClickOutsideDismiss({
    isOpen: showWorkbenchSavedViews,
    wrapperRef: workbenchSavedViewWrapperRef,
    onDismiss: () => setShowWorkbenchSavedViews(false),
  });

  useEscapeDismiss(hasOpenDropdown, dismissOpenDropdowns);

  const isComposingKeyEvent = useCallback(
    (event) => event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229,
    [],
  );

  const handleQuickNoteSubmit = useCallback(async (e) => {
    if (isComposingKeyEvent(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && quickNote.trim()) {
      e.preventDefault();
      if (quickNoteSubmittingRef.current) return;
      quickNoteSubmittingRef.current = true;
      try {
        await addQuickNote(quickNote);
        setQuickNote('');
        setIsExpanded(false);
      } catch (error) {
        console.error('[Workbench] quick note add failed:', error);
      } finally {
        quickNoteSubmittingRef.current = false;
      }
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  }, [quickNote, addQuickNote, isComposingKeyEvent]);

  const handleExpandedSubmit = useCallback(async () => {
    if (!quickNote.trim()) return;
    if (quickNoteSubmittingRef.current) return;
    quickNoteSubmittingRef.current = true;
    try {
      await addQuickNote(quickNote);
      setQuickNote('');
      setIsExpanded(false);
    } catch (error) {
      console.error('[Workbench] expanded quick note add failed:', error);
    } finally {
      quickNoteSubmittingRef.current = false;
    }
  }, [quickNote, addQuickNote]);

  const handleNativeDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleNativeDrop = useCallback(async (e) => {
    e.preventDefault();
    const qollectData = e.dataTransfer.getData(INTERNAL_DRAG_MIME);
    if (qollectData) {
      try {
        const { id } = JSON.parse(qollectData);
        const item = items.find(i => i.id === id);
        if (item && !item.is_pinned) {
          await togglePin(item);
        }
      } catch (err) {
        console.error('Drop pin failed:', err);
      }
    }
  }, [items, togglePin]);

  const handleWorkbenchCardPointerUp = useCallback(() => {
    clearWorkbenchSortLongPressTimer();
    workbenchSortLongPressPointerRef.current.pointerId = null;
  }, [clearWorkbenchSortLongPressTimer]);

  const handleWorkbenchCardPointerMove = useCallback((event) => {
    if (!workbenchSortLongPressTimerRef.current) return;
    const state = workbenchSortLongPressPointerRef.current;
    if (state.pointerId != null && event.pointerId !== state.pointerId) return;
    const dx = Math.abs((event.clientX || 0) - state.x);
    const dy = Math.abs((event.clientY || 0) - state.y);
    if (dx > SORT_MODE_LONG_PRESS_MOVE_PX || dy > SORT_MODE_LONG_PRESS_MOVE_PX) {
      clearWorkbenchSortLongPressTimer();
    }
  }, [clearWorkbenchSortLongPressTimer]);

  const handleWorkbenchCardPointerDown = useCallback((item, event) => {
    if (!item?.id) return;
    if (isWorkbenchSortMode || selectedPinnedIds.length > 0) return;
    if (event.button !== 0) return;
    if (shouldIgnoreLongPressTarget(event.target)) {
      return;
    }
    clearWorkbenchSortLongPressTimer();
    workbenchSortLongPressPointerRef.current = {
      pointerId: event.pointerId ?? null,
      x: event.clientX || 0,
      y: event.clientY || 0,
    };
    workbenchSortLongPressTimerRef.current = setTimeout(() => {
      workbenchSortLongPressTimerRef.current = null;
      suppressNextCardClickRef.current = true;
      const pointerState = workbenchSortLongPressPointerRef.current;
      const card = workbenchCardRefsRef.current.get(item.id);
      if (card) {
        const rect = card.getBoundingClientRect();
        const cardsRect = workbenchCardsRef.current?.getBoundingClientRect?.();
        const offsetYRatio = rect.height > 0
          ? Math.min(1, Math.max(0, (pointerState.y - rect.top) / rect.height))
          : 0.5;
        workbenchSortAnchorRef.current = {
          itemId: item.id,
          pointerClientY: pointerState.y,
          offsetYRatio,
          pointerYInCards: cardsRect ? (pointerState.y - cardsRect.top) : null,
        };
      } else {
        workbenchSortAnchorRef.current = null;
      }
      setWorkbenchSortAnchorItemId(item.id);
      setWorkbenchSortMode(true);
      showWorkbenchSortEntryToast();
    }, SORT_MODE_LONG_PRESS_MS);
  }, [
    clearWorkbenchSortLongPressTimer,
    isWorkbenchSortMode,
    selectedPinnedIds.length,
    showWorkbenchSortEntryToast,
  ]);

  const handleCardPointerDownCapture = useCallback((item, index, event) => {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
    clearWorkbenchSortLongPressTimer();
    workbenchSortLongPressPointerRef.current.pointerId = null;
    event.stopPropagation();
    event.preventDefault();
    workbenchPanelRef.current?.focus();

    if (event.shiftKey) {
      const anchorCandidate = selectionAnchorIndexRef.current >= 0
        ? selectionAnchorIndexRef.current
        : index;
      const anchorIndex = Math.max(0, Math.min(pinnedItems.length - 1, anchorCandidate));
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const rangeIds = pinnedItems.slice(start, end + 1).map(candidate => candidate.id);
      setSelectedPinnedIds(rangeIds);
      selectionAnchorIndexRef.current = anchorIndex;
      return;
    }

    setSelectedPinnedIds((current) => (
      current.includes(item.id)
        ? current.filter(id => id !== item.id)
        : [...current, item.id]
    ));
    selectionAnchorIndexRef.current = index;
  }, [clearWorkbenchSortLongPressTimer, pinnedItems]);

  const handleCardClick = useCallback((item, index, event) => {
    if (suppressNextCardClickRef.current) {
      suppressNextCardClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    workbenchPanelRef.current?.focus();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      return;
    }
    if (isWorkbenchSortMode) {
      event.preventDefault();
      return;
    }
    if (selectedPinnedIds.length > 0) {
      event.preventDefault();
      setSelectedPinnedIds((current) => (
        current.includes(item.id)
          ? current.filter(id => id !== item.id)
          : [...current, item.id]
      ));
      selectionAnchorIndexRef.current = index;
      return;
    }
    selectionAnchorIndexRef.current = index;
    openItemPreview(setPanelMode, item);
  }, [isWorkbenchSortMode, selectedPinnedIds.length, setPanelMode]);

  const showTransientToast = useCallback((message, duration = 1800) => {
    if (!message) return;
    setTransientWorkbenchToast(message);
    if (workbenchToastTimerRef.current) {
      clearTimeout(workbenchToastTimerRef.current);
    }
    workbenchToastTimerRef.current = setTimeout(() => {
      setTransientWorkbenchToast('');
      workbenchToastTimerRef.current = null;
    }, duration);
  }, []);

  const clearPendingUnpinConfirm = useCallback(() => {
    setPendingUnpinItemId(null);
    if (workbenchUnpinConfirmTimerRef.current) {
      clearTimeout(workbenchUnpinConfirmTimerRef.current);
      workbenchUnpinConfirmTimerRef.current = null;
    }
  }, []);

  const handleCardDoubleClick = useCallback(async (item, event) => {
    event.stopPropagation();
    if (isWorkbenchSortMode) return;
    if (selectedPinnedIds.length > 0) return;

    const sourceApp = getSourceApp(item?.metadata);
    if (!copyQollectSourceItems && isQollectManagedSource(sourceApp)) {
      showTransientToast(t('workbench.copySkippedQollectSource'));
      return;
    }

    await handleCopy(item, 'workbench');
  }, [
    isWorkbenchSortMode,
    selectedPinnedIds.length,
    copyQollectSourceItems,
    showTransientToast,
    t,
    handleCopy,
  ]);

  const handleCardUnpin = useCallback(async (item) => {
    if (!item?.id) return;
    if (pendingUnpinItemId !== item.id) {
      setPendingUnpinItemId(item.id);
      if (workbenchUnpinConfirmTimerRef.current) {
        clearTimeout(workbenchUnpinConfirmTimerRef.current);
      }
      workbenchUnpinConfirmTimerRef.current = setTimeout(() => {
        setPendingUnpinItemId((current) => (current === item.id ? null : current));
        workbenchUnpinConfirmTimerRef.current = null;
      }, 2200);
      showTransientToast(t('workbench.removeConfirmHint'));
      return;
    }

    clearPendingUnpinConfirm();
    await togglePin(item);
  }, [pendingUnpinItemId, clearPendingUnpinConfirm, showTransientToast, t, togglePin]);

  useEffect(() => {
    if (!pendingUnpinItemId) return;
    if (pinnedItems.some((item) => item.id === pendingUnpinItemId)) return;
    clearPendingUnpinConfirm();
  }, [pendingUnpinItemId, pinnedItems, clearPendingUnpinConfirm]);

  const clearPinnedSelection = useCallback(() => {
    setSelectedPinnedIds([]);
  }, []);

  const workbenchPanelRef = useRef(null);

  const {
    contextMenuRef,
    contextMenuState,
    openContextMenu,
    closeContextMenu,
    armDeleteConfirm,
  } = useHistoryContextMenu({
    filteredItems: pinnedItems,
    selectedItemIds: selectedPinnedIds,
    selectionAnchorIndexRef,
    setSelectedItemIds: setSelectedPinnedIds,
    setFocusedIndex,
  });

  const handleCardContextMenu = useCallback((item, index, event) => {
    clearWorkbenchSortLongPressTimer();
    workbenchSortLongPressPointerRef.current.pointerId = null;
    openContextMenu(item, index, event);
  }, [clearWorkbenchSortLongPressTimer, openContextMenu]);

  useLayoutEffect(() => {
    if (!isWorkbenchSortMode) return;
    const anchor = workbenchSortAnchorRef.current;
    if (!anchor) return;

    let rafId = 0;
    let attemptCount = 0;
    const maxAttempts = 60;
    const applyAnchorCompensation = () => {
      const cardsEl = workbenchCardsRef.current;
      const cardEl = workbenchCardRefsRef.current.get(anchor.itemId);
      if (!cardsEl || !cardEl) {
        workbenchSortAnchorRef.current = null;
        return;
      }
      const cardsRect = cardsEl.getBoundingClientRect();
      const cardRect = cardEl.getBoundingClientRect();
      const ratioY = Math.min(1, Math.max(0, anchor.offsetYRatio ?? 0.5));
      const desiredY = anchor.pointerYInCards != null
        ? cardsRect.top + anchor.pointerYInCards
        : anchor.pointerClientY;
      const currentY = cardRect.top + (cardRect.height * ratioY);
      const deltaY = currentY - desiredY;

      if (Math.abs(deltaY) > 0.5) {
        const prevScrollTop = cardsEl.scrollTop;
        cardsEl.scrollTop += deltaY;
        const reachedBoundary = Math.abs(cardsEl.scrollTop - prevScrollTop) < 0.5;
        if (reachedBoundary) {
          workbenchSortAnchorRef.current = null;
          return;
        }
      }

      const pointerYInCards = desiredY - cardsRect.top;
      const cardTopInCards = cardRect.top - cardsRect.top;
      const cardBottomInCards = cardRect.bottom - cardsRect.top;
      const verticalSearchHit = pointerYInCards >= cardTopInCards - 14 && pointerYInCards <= cardBottomInCards + 14;

      attemptCount += 1;
      if (attemptCount < maxAttempts && (!verticalSearchHit || Math.abs(deltaY) > 0.35)) {
        rafId = requestAnimationFrame(applyAnchorCompensation);
        return;
      }
      workbenchSortAnchorRef.current = null;
    };

    rafId = requestAnimationFrame(applyAnchorCompensation);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isWorkbenchSortMode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const panel = workbenchPanelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (!panel.contains(e.target) && !panel.contains(active) && active !== panel) return;
      if (e.key === 'Escape' && isWorkbenchSortMode) {
        e.preventDefault();
        handleFinishWorkbenchSortMode();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (pinnedItems.length === 0) return;
        e.preventDefault();
        setSelectedPinnedIds(pinnedItems.map(item => item.id));
        selectionAnchorIndexRef.current = 0;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFinishWorkbenchSortMode, isWorkbenchSortMode, pinnedItems]);

  useEffect(() => (
    () => {
      clearWorkbenchSortLongPressTimer();
    }
  ), [clearWorkbenchSortLongPressTimer]);

  useEffect(() => (
    () => {
      if (workbenchSortEntryToastTimerRef.current) {
        clearTimeout(workbenchSortEntryToastTimerRef.current);
        workbenchSortEntryToastTimerRef.current = null;
      }
      if (workbenchToastTimerRef.current) {
        clearTimeout(workbenchToastTimerRef.current);
        workbenchToastTimerRef.current = null;
      }
      if (workbenchUnpinConfirmTimerRef.current) {
        clearTimeout(workbenchUnpinConfirmTimerRef.current);
        workbenchUnpinConfirmTimerRef.current = null;
      }
    }
  ), []);

  const handleExpandedNoteKeyDown = useCallback((event) => {
    if (isComposingKeyEvent(event)) return;
    if (event.key === 'Enter' && event.ctrlKey && quickNote.trim()) {
      handleExpandedSubmit();
    }
    if (event.key === 'Escape') {
      setIsExpanded(false);
    }
  }, [quickNote, handleExpandedSubmit, isComposingKeyEvent]);

  const batchActions = useWorkbenchBatchActions({
    selectedPinnedItems,
    selectedCount: selectedPinnedIds.length,
    allSelectedAreFavorite,
    allSelectedArePinned,
    canRunBatchAi,
    batchAiSourceText,
    itemsRevision,
    uiLanguage: i18n.language,
    maxPinnedItems,
    loadItems,
    t,
  });

  const quickActions = useWorkbenchQuickActions({
    pinnedItems: allPinnedItems,
    items,
    aiEnabled,
    uiLanguage: i18n.language,
    selectionMode: selectedPinnedIds.length > 0,
    addQuickNote,
    loadItems,
    setPanelMode,
    t,
  });

  const handleContextMenuAction = useCallback(async (actionKey) => {
    const currentItem = contextMenuState?.item;
    if (!currentItem) return;

    const toPlainText = (item) => {
      if (!item) return '';
      if (item.type_ === 'image') {
        return String(item.ocr_text || item.content || '').trim();
      }
      return String(item.content || '').trim();
    };

    try {
      if (contextMenuState?.isMulti) {
        switch (actionKey) {
          case 'copyMerged': {
            const merged = selectedPinnedItems
              .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
              .filter(Boolean)
              .join('\n\n');
            if (merged) {
              await handleCopyPlainText(merged, 'workbench');
            } else {
              await handleCopy(currentItem, 'workbench');
            }
            closeContextMenu();
            return;
          }
          case 'clearSelection':
            clearPinnedSelection();
            closeContextMenu();
            return;
          case 'deleteSelected':
            if (!armDeleteConfirm('deleteSelected')) {
              showTransientToast(t('item.confirmDelete'));
              return;
            }
            for (const item of selectedPinnedItems) {
              await deleteItem(item);
            }
            clearPinnedSelection();
            closeContextMenu();
            return;
          default:
            closeContextMenu();
            return;
        }
      }

      switch (actionKey) {
        case 'copy':
          await handleCopy(currentItem, 'workbench');
          closeContextMenu();
          return;
        case 'copyPlainText': {
          const plainText = toPlainText(currentItem);
          if (plainText) {
            await handleCopyPlainText(plainText, 'workbench');
          } else {
            await handleCopy(currentItem, 'workbench');
          }
          closeContextMenu();
          return;
        }
        case 'quickPaste':
          await handleCopyAndAutoPaste(currentItem, 'workbench');
          closeContextMenu();
          return;
        case 'multiSelect': {
          const nextSelected = selectedPinnedIds.includes(currentItem.id)
            ? selectedPinnedIds
            : [...selectedPinnedIds, currentItem.id];
          setSelectedPinnedIds(nextSelected);
          const contextIndex = pinnedItems.findIndex(candidate => candidate.id === currentItem.id);
          if (contextIndex >= 0) {
            setFocusedIndex(contextIndex);
            selectionAnchorIndexRef.current = contextIndex;
          }
          closeContextMenu();
          return;
        }
        case 'favorite':
          await toggleFavorite(currentItem);
          closeContextMenu();
          return;
        case 'pin':
          await togglePin(currentItem);
          closeContextMenu();
          return;
        case 'editNote':
          openEditModal(currentItem);
          closeContextMenu();
          return;
        case 'openInNewWindow':
          await openHistoryEditorWindow(currentItem.id, t);
          closeContextMenu();
          return;
        case 'open':
          await handleOpenItem(currentItem);
          closeContextMenu();
          return;
        case 'reveal':
          await handleRevealInFolder(currentItem);
          closeContextMenu();
          return;
        case 'delete':
          if (!armDeleteConfirm('delete')) {
            showTransientToast(t('item.confirmDelete'));
            return;
          }
          await deleteItem(currentItem);
          closeContextMenu();
          return;
        default:
          closeContextMenu();
      }
    } catch (error) {
      console.error('[WorkbenchContextMenu] action failed:', actionKey, error);
      closeContextMenu();
    }
  }, [
    contextMenuState,
    selectedPinnedItems,
    handleCopyPlainText,
    handleCopy,
    closeContextMenu,
    clearPinnedSelection,
    armDeleteConfirm,
    deleteItem,
    handleCopyAndAutoPaste,
    selectedPinnedIds,
    pinnedItems,
    setFocusedIndex,
    toggleFavorite,
    togglePin,
    openEditModal,
    t,
    showTransientToast,
    handleOpenItem,
    handleRevealInFolder,
  ]);

  const quickNoteSection = (
    <WorkbenchQuickNoteSection
      isExpanded={isExpanded}
      quickNote={quickNote}
      onQuickNoteChange={setQuickNote}
      onQuickNoteKeyDown={handleQuickNoteSubmit}
      onExpandedKeyDown={handleExpandedNoteKeyDown}
      onExpandedSubmit={handleExpandedSubmit}
      onCollapse={() => setIsExpanded(false)}
      onExpand={() => setIsExpanded(true)}
    />
  );

  if (allPinnedItems.length === 0) {
    return (
      <div className="workbench-panel" ref={workbenchPanelRef} tabIndex={-1} onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
        {quickNoteSection}
        <div className={`workbench-empty state-panel panel-state-stack panel-state-stack--narrow ${workbenchBackendError ? 'error state-panel--error' : ''}`.trim()}>
          <div className="workbench-empty-icon panel-state-icon">
            <Package size={48} strokeWidth={1} />
          </div>
          <div className="workbench-empty-title state-panel__title panel-state-title">
            {workbenchBackendError ? t('workbench.queryFailed') : t('workbench.emptyTitle')}
          </div>
          <div className="workbench-empty-hint state-panel__hint panel-state-text">
            {workbenchBackendError || t('workbench.emptyHint')}
          </div>
          {!workbenchBackendError && (
            <div className="workbench-empty-guide state-panel__hint panel-state-text">{t('workbench.workspaceGuide')}</div>
          )}
          {workbenchBackendError && (
            <button
              type="button"
              className="workbench-retry-btn state-retry-btn panel-state-action-btn"
              onClick={handleRetryWorkbenchLoad}
            >
              {t('workbench.retryLoad')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="workbench-panel" ref={workbenchPanelRef} tabIndex={-1} onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
      {quickNoteSection}
      <div className="workbench-filter-row">
        <div className="workbench-search-box">
          <input
            type="text"
            className="workbench-search-input"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="workbench-search-clear-btn"
              title={t('toolbar.clearFilter')}
              aria-label={t('toolbar.clearFilter')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="workbench-filter-actions">
          <TypeFilterControl
            wrapperRef={workbenchTypeWrapperRef}
            wrapperClassName="workbench-type-filter-wrapper"
            isOpen={showWorkbenchTypeFilter}
            onToggle={toggleWorkbenchTypeFilter}
            onClose={closeWorkbenchTypeFilter}
            controlsId={workbenchTypeDropdownId}
            selectedType={selectedType}
            selectedTypeIcon={selectedTypeOption.icon}
            showSelectedTypeText
            selectedTypeText={t(`search.typeFilter.${selectedType}`)}
            options={typeFilterOptions}
            onSelectType={handleWorkbenchTypeChange}
            typeLabelText={t('toolbar.filterType')}
            getOptionLabel={(key) => t(`search.typeFilter.${key}`)}
          />

          <button
            onClick={() => setShowFavoritesOnly(current => !current)}
            className={`header-icon-btn ${showFavoritesOnly ? 'active fav-active' : ''}`}
            title={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
            aria-label={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
            aria-pressed={showFavoritesOnly}
          >
            <Star size={15} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
          </button>

          {allTags.length > 0 && (
            <TagFilterControl
              wrapperRef={workbenchTagWrapperRef}
              triggerClassName="workbench-tag-filter-wrapper"
              isOpen={showWorkbenchTagFilter}
              onToggle={toggleWorkbenchTagFilter}
              onClose={closeWorkbenchTagFilter}
              controlsId={workbenchTagDropdownId}
              listboxId={workbenchTagListboxId}
              listboxRef={workbenchTagListboxRef}
              selectedTags={selectedTags}
              tagSearchQuery={workbenchTagSearchQuery}
              onTagSearchChange={setWorkbenchTagSearchQuery}
              onTagSearchInputKeyDown={handleWorkbenchTagSearchInputKeyDown}
              visibleTagOptions={visibleTagOptions}
              totalTagOptionsCount={parsedTagOptions.length}
              onToggleTag={handleToggleWorkbenchTag}
              onClearTags={() => setSelectedTags([])}
              labelText={t('toolbar.filterTags')}
              searchPlaceholderText={t('toolbar.searchTags')}
              noTagsFoundText={t('toolbar.noTagsFound')}
              moreTagsHintText={(count) => t('toolbar.moreTagsHint', { count })}
              clearAllText={t('toolbar.clearAll')}
            />
          )}

          <DateFilterControl
            wrapperRef={workbenchDateWrapperRef}
            isOpen={showWorkbenchDateFilter}
            onToggle={toggleWorkbenchDateFilter}
            onClose={closeWorkbenchDateFilter}
            controlsId={workbenchDateDropdownId}
            hasSelection={Boolean(selectedDateRange)}
            badgeText={workbenchDateBadgeText}
            dateFilterText={t('toolbar.dateFilter')}
            datePresetOptions={datePresetOptions}
            selectedDatePreset={selectedDatePreset}
            onSelectDatePreset={handleSelectWorkbenchDatePreset}
            selectedDateRange={selectedDateRange}
            customDateStart={customDateStart}
            customDateEnd={customDateEnd}
            onCustomDateStartChange={setCustomDateStart}
            onCustomDateEndChange={setCustomDateEnd}
            onApplyCustomDateRange={handleApplyWorkbenchCustomDateRange}
            onClearDateFilter={handleClearWorkbenchDateFilter}
            dateStartText={t('toolbar.dateStart')}
            dateEndText={t('toolbar.dateEnd')}
            dateApplyText={t('toolbar.dateApply')}
            clearDateFilterText={t('toolbar.clearDateFilter')}
          />

          <SavedViewControl
            wrapperRef={workbenchSavedViewWrapperRef}
            triggerClassName="workbench-saved-view-wrapper"
            isOpen={showWorkbenchSavedViews}
            onToggle={toggleWorkbenchSavedViews}
            onClose={closeWorkbenchSavedViews}
            controlsId={workbenchSavedViewDropdownId}
            savedViews={savedViews}
            activeFilterViewId={activeFilterViewId}
            activeSavedView={activeSavedView}
            savedViewName={workbenchSavedViewName}
            onSavedViewNameChange={setWorkbenchSavedViewName}
            onSaveView={handleSaveWorkbenchView}
            onApplySavedView={applySavedFilterView}
            onDeleteSavedView={deleteSavedFilterView}
            onClearActiveSavedView={clearActiveFilterView}
            titleText={t('search.savedViews.title')}
            namePlaceholderText={t('search.savedViews.namePlaceholder')}
            saveCurrentText={t('search.savedViews.saveCurrent')}
            emptyText={t('search.savedViews.empty')}
            activeText={t('search.savedViews.active')}
            deleteText={t('search.savedViews.delete')}
            clearActiveText={t('search.savedViews.clearActive')}
          />

          {isWorkbenchSortMode && (
            <button
              type="button"
              className="workbench-sort-toggle active"
              onClick={handleFinishWorkbenchSortMode}
              title={t('workbench.finishSortMode')}
              aria-label={t('workbench.finishSortMode')}
              aria-pressed
            >
              <ArrowUpDown size={12} />
              <span>{t('workbench.finishSortMode')}</span>
            </button>
          )}
        </div>
      </div>
      {shouldShowWorkbenchSummaryRow && (
        <PanelSummaryRow className="workbench-filter-summary">
          <PanelSummaryBadge className="workbench-filter-count panel-summary-item--count">
            {t('workbench.countLabel', { count: pinnedItems.length })}
          </PanelSummaryBadge>
          {isWorkbenchBusy && (
            <PanelSummaryBadge className="is-busy panel-summary-item--status">{t('search.searching')}</PanelSummaryBadge>
          )}
          {workbenchFilterSummaryParts.length > 0 && (
            <PanelSummaryText className="workbench-filter-summary-text panel-summary-item--primary">
              {workbenchFilterSummaryParts.join(' · ')}
            </PanelSummaryText>
          )}
          {workbenchBackendError && pinnedItems.length > 0 && (
            <PanelSummaryFeedback
              className="workbench-filter-feedback panel-summary-item--feedback"
              role="status"
              ariaLive="polite"
              title={workbenchBackendError}
            >
              {t('workbench.queryFailed')}
            </PanelSummaryFeedback>
          )}
          {hasWorkbenchFilters && (
            <PanelSummaryActionButton
              className="clear-filter-btn workbench-summary-clear-btn panel-summary-item--action"
              onClick={handleClearWorkbenchFilters}
              title={t('toolbar.clearAll')}
            >
              <X size={12} />
              <span>{t('toolbar.clearFilter')}</span>
            </PanelSummaryActionButton>
          )}
        </PanelSummaryRow>
      )}

      {pinnedItems.length === 0 ? (
        <div className={`workbench-filter-empty state-panel panel-state-stack panel-state-stack--narrow ${workbenchBackendError ? 'error state-panel--error' : ''}`.trim()}>
          <div className="workbench-empty-icon panel-state-icon">
            <Package size={42} strokeWidth={1} />
          </div>
          <div className="workbench-empty-title state-panel__title panel-state-title">
            {workbenchBackendError ? t('workbench.queryFailed') : t('workbench.noFilteredItems')}
          </div>
          <div className="workbench-empty-hint state-panel__hint panel-state-text">
            {workbenchBackendError || t('workbench.emptyHint')}
          </div>
          {workbenchBackendError ? (
            <button
              type="button"
              className="workbench-retry-btn state-retry-btn panel-state-action-btn"
              onClick={handleRetryWorkbenchLoad}
            >
              {t('workbench.retryLoad')}
            </button>
          ) : (
            <button className="clear-filter-btn panel-state-action-btn" onClick={handleClearWorkbenchFilters}>
              <X size={12} /> {t('toolbar.clearFilter')}
            </button>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedItems.map(i => i.id)} strategy={rectSortingStrategy}>
            <div ref={workbenchCardsRef} className={`workbench-cards ${isWorkbenchSortMode ? 'sort-mode' : ''}`}>
              {pinnedItems.map((item, index) => (
                <SortableWorkbenchCard
                  key={item.id}
                  item={item}
                  timeTick={workbenchTimeTick}
                  isCopied={copiedItemId === item.id && copyFeedbackSource === 'workbench'}
                  isMultiSelected={selectedPinnedIds.includes(item.id)}
                  isSortMode={isWorkbenchSortMode}
                  isSortAnchor={isWorkbenchSortMode && workbenchSortAnchorItemId === item.id}
                  isSelectionMode={selectedPinnedIds.length > 0}
                  sortableDisabled={!workbenchDragEnabled || selectedPinnedIds.length > 0}
                  isUnpinConfirmArmed={pendingUnpinItemId === item.id}
                  onUnpin={() => handleCardUnpin(item)}
                  onSetCardRef={(node) => setWorkbenchCardRef(item.id, node)}
                  onCardPointerDown={(event) => handleWorkbenchCardPointerDown(item, event)}
                  onCardPointerMove={handleWorkbenchCardPointerMove}
                  onCardPointerUp={handleWorkbenchCardPointerUp}
                  onCardPointerCancel={handleWorkbenchCardPointerUp}
                  onCardPointerLeave={handleWorkbenchCardPointerUp}
                  onPointerDownCapture={(event) => handleCardPointerDownCapture(item, index, event)}
                  onClick={(event) => handleCardClick(item, index, event)}
                  onDoubleClick={(event) => handleCardDoubleClick(item, event)}
                  onContextMenu={(event) => handleCardContextMenu(item, index, event)}
                  onOpenItem={handleOpenItem}
                  onSetCardBackground={setCardBackground}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <HistoryContextMenu
        state={contextMenuState}
        menuRef={contextMenuRef}
        t={t}
        maxPinnedItems={maxPinnedItems}
        enableQuickPaste={autoPasteOnDoubleClick}
        onAction={handleContextMenuAction}
      />

      {selectedPinnedIds.length > 0 ? (
        <WorkbenchMultiSelectBar
          selectedCount={selectedPinnedIds.length}
          showBatchTagEditor={batchActions.showBatchTagEditor}
          onToggleBatchTagEditor={batchActions.handleToggleBatchTagEditor}
          batchTagPending={batchActions.batchTagPending}
          batchFlagPending={batchActions.batchFlagPending}
          batchAiRunningTask={batchActions.batchAiRunningTask}
          onBatchFavoriteToggle={batchActions.handleBatchFavoriteToggle}
          allSelectedAreFavorite={allSelectedAreFavorite}
          onBatchPinToggle={batchActions.handleBatchPinToggle}
          allSelectedArePinned={allSelectedArePinned}
          onMergeCopy={batchActions.handleMergeCopySelected}
          canRunBatchAi={canRunBatchAi}
          onBatchAiAction={batchActions.handleBatchAiAction}
          onClearSelection={clearPinnedSelection}
          batchTagEditorRef={batchActions.batchTagEditorRef}
          batchTagInput={batchActions.batchTagInput}
          onBatchTagInputChange={batchActions.handleBatchTagInputChange}
          onBatchTagInputKeyDown={batchActions.handleBatchTagInputKeyDown}
          canApplyBatchTag={batchActions.canApplyBatchTag}
          onApplyBatchTag={batchActions.applyBatchTag}
          activeBatchTagSuggestion={batchActions.activeBatchTagSuggestion}
          onCloseBatchTagEditor={batchActions.closeBatchTagEditor}
          filteredBatchTagSuggestions={batchActions.filteredBatchTagSuggestions}
          batchTagSuggestionsRef={batchActions.batchTagSuggestionsRef}
          batchTagActiveSuggestionIndex={batchActions.batchTagActiveSuggestionIndex}
          setBatchTagActiveSuggestionIndex={batchActions.setBatchTagActiveSuggestionIndex}
          multiSelectFeedback={batchActions.multiSelectFeedback}
        />
      ) : (
        <WorkbenchQuickActionsBar
          t={t}
          setPanelMode={setPanelMode}
          quickOutputTask={quickActions.quickOutputTask}
          quickOutputRunning={quickActions.quickOutputRunning}
          showQuickOutputMenu={quickActions.showQuickOutputMenu}
          setShowQuickOutputMenu={quickActions.setShowQuickOutputMenu}
          quickOutputMenuRef={quickActions.quickOutputMenuRef}
          quickOutputTasks={quickActions.quickOutputTasks}
          showWorkbenchMoreMenu={quickActions.showWorkbenchMoreMenu}
          setShowWorkbenchMoreMenu={quickActions.setShowWorkbenchMoreMenu}
          workbenchMoreMenuRef={quickActions.workbenchMoreMenuRef}
          activeAction={quickActions.activeAction}
          feedback={quickActions.feedback}
          lastClearedPinnedIds={quickActions.lastClearedPinnedIds}
          hasSnapshot={quickActions.hasSnapshot}
          handleRunQuickOutput={quickActions.handleRunQuickOutput}
          handleQuickOutputMenuSelect={quickActions.handleQuickOutputMenuSelect}
          handleSaveSnapshot={quickActions.handleSaveSnapshot}
          handleRestoreSnapshot={quickActions.handleRestoreSnapshot}
          handleExportWorkbench={quickActions.handleExportWorkbench}
          handleDedupeWorkbench={quickActions.handleDedupeWorkbench}
          handleClearAll={quickActions.handleClearAll}
          handleUndoClearAll={quickActions.handleUndoClearAll}
        />
      )}
      {(isWorkbenchSortMode && showSortEntryToast) || transientWorkbenchToast ? (
        <div className="workbench-entry-toast" role="status" aria-live="polite">
          {isWorkbenchSortMode && showSortEntryToast
            ? t('workbench.releaseThenDragHint')
            : transientWorkbenchToast}
        </div>
      ) : null}
    </div>
  );
}

export default WorkbenchPanel;
