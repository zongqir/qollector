import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { searchItems } from '../../services/clipboardService';
import { openHistoryEditorWindow } from '../../services/windowService';
import useWorkbenchQuickActions from './hooks/useWorkbenchQuickActions';
import useWorkbenchBatchActions from './hooks/useWorkbenchBatchActions';
import {
  getDateRangeForPreset,
  dateStringToTimestamp,
  dateStringToEndTimestamp,
} from '../../utils/dateHelpers';
import { getTags, getSourceApp, buildSourceTag, buildTypeTag, parseSystemTag } from '../../utils/tagHelpers';

function WorkbenchPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const [showWorkbenchTypeFilter, setShowWorkbenchTypeFilter] = useState(false);
  const [showWorkbenchDateFilter, setShowWorkbenchDateFilter] = useState(false);
  const [showWorkbenchTagFilter, setShowWorkbenchTagFilter] = useState(false);
  const [showWorkbenchSavedViews, setShowWorkbenchSavedViews] = useState(false);
  const [workbenchSavedViewName, setWorkbenchSavedViewName] = useState('');
  const [workbenchTagSearchQuery, setWorkbenchTagSearchQuery] = useState('');
  const [backendPinnedItems, setBackendPinnedItems] = useState(null);
  const selectionAnchorIndexRef = useRef(-1);
  const workbenchTypeWrapperRef = useRef(null);
  const workbenchDateWrapperRef = useRef(null);
  const workbenchTagWrapperRef = useRef(null);
  const workbenchSavedViewWrapperRef = useRef(null);
  const workbenchTagListboxRef = useRef(null);
  const quickNoteSubmittingRef = useRef(false);

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
    searchItems('', 2000, { is_pinned: true })
      .then((results) => {
        if (cancelled) return;
        setBackendPinnedItems(Array.isArray(results) ? results : []);
      })
      .catch((error) => {
        console.error('[Workbench] fetch pinned items failed:', error);
        if (!cancelled) {
          setBackendPinnedItems(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemsRevision]);

  const pinnedBaseItems = useMemo(() => {
    if (Array.isArray(backendPinnedItems)) return backendPinnedItems;
    return items.filter(item => item.is_pinned);
  }, [backendPinnedItems, items]);

  const allPinnedItems = useMemo(() => {
    const pinned = pinnedBaseItems;
    if (!pinnedOrder) return pinned;
    const orderMap = new Map(pinnedOrder.map((id, idx) => [id, idx]));
    return [...pinned].sort((a, b) => {
      const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return aIdx - bIdx;
    });
  }, [pinnedBaseItems, pinnedOrder]);

  const pinnedItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

    return allPinnedItems.filter((item) => {
      if (queryTerms.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceApp = getSourceApp(item.metadata);
        const sourceTag = buildSourceTag(sourceApp, t);
        const typeTag = buildTypeTag(item.type_, t);
        const typeLabel = item.code_language
          ? t('search.typeFilter.code')
          : t(`search.typeFilter.${item.type_ || 'text'}`);

        const searchTarget = [
          item.content,
          item.user_note,
          item.ocr_text,
          itemTags.join(' '),
          sourceApp,
          sourceTag,
          typeTag,
          typeLabel,
          item.type_,
          item.code_language,
        ]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        if (!queryTerms.some(term => searchTarget.includes(term))) return false;
      }

      if (selectedType === 'code') {
        if (!item.code_language) return false;
      } else if (selectedType !== 'all' && item.type_ !== selectedType) {
        return false;
      }

      if (showFavoritesOnly && !item.is_favorite) return false;

      if (selectedTags.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
        const typeTag = buildTypeTag(item.type_, t);
        const allItemTags = [...itemTags, ...(sourceTag ? [sourceTag] : []), ...(typeTag ? [typeTag] : [])];
        if (!selectedTags.some(st => allItemTags.includes(st))) return false;
      }

      if (selectedDateRange) {
        const createdAt = Number(item.created_at || 0);
        if (selectedDateRange.start != null && createdAt < selectedDateRange.start) return false;
        if (selectedDateRange.end != null && createdAt > selectedDateRange.end) return false;
      }

      return true;
    });
  }, [
    allPinnedItems,
    searchQuery,
    selectedType,
    showFavoritesOnly,
    selectedTags,
    selectedDateRange,
    t,
    i18n.language,
  ]);

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
    const userTags = new Set();
    const aiTags = new Set();
    const sourceTags = new Set();
    const typeTags = new Set();

    pinnedBaseItems.forEach((item) => {
      const tags = getTags(item.tags);
      tags.forEach((tag) => {
        if (tag.startsWith('AI:')) aiTags.add(tag);
        else userTags.add(tag);
      });

      const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
      if (sourceTag) sourceTags.add(sourceTag);

      const typeTag = buildTypeTag(item.type_, t);
      if (typeTag) typeTags.add(typeTag);
    });

    return [
      ...Array.from(typeTags).sort(),
      ...Array.from(userTags).sort(),
      ...Array.from(sourceTags).sort(),
      ...Array.from(aiTags).sort(),
    ];
  }, [pinnedBaseItems, t, i18n.language]);

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
    { key: 'today', label: t('toolbar.dateToday'), badge: '1d' },
    { key: 'yesterday', label: t('toolbar.dateYesterday'), badge: '1d' },
    { key: '7d', label: t('toolbar.dateLast7Days'), badge: '7d' },
    { key: '30d', label: t('toolbar.dateLast30Days'), badge: '30d' },
    { key: 'custom', label: t('toolbar.dateCustomRange'), badge: '...' },
  ];
  const datePresetOptions = datePresets.map(({ key, label }) => ({ key, label }));

  const workbenchDateBadgeText = selectedDateRange
    ? (selectedDateRange.preset === 'custom'
      ? '...'
      : datePresets.find(preset => preset.key === selectedDateRange.preset)?.badge || '')
    : '';

  const hasWorkbenchFilters = Boolean(
    searchQuery.trim()
    || selectedType !== 'all'
    || showFavoritesOnly
    || selectedDateRange != null
    || selectedTags.length > 0
    || activeSavedView
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = allPinnedItems.findIndex(i => i.id === active.id);
    const newIndex = allPinnedItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(allPinnedItems.map(i => i.id), oldIndex, newIndex);
    setPinnedOrder(newOrder);
  }, [allPinnedItems]);

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
    const qollectData = e.dataTransfer.getData('application/x-qollect-item');
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

  const handleCardPointerDownCapture = useCallback((item, index, event) => {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
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
  }, [pinnedItems]);

  const handleCardClick = useCallback((item, index, event) => {
    event.stopPropagation();
    workbenchPanelRef.current?.focus();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
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
    setPanelMode('preview', item);
  }, [selectedPinnedIds.length, setPanelMode]);

  const handleCardDoubleClick = useCallback((item, event) => {
    event.stopPropagation();
    if (selectedPinnedIds.length > 0) return;
    if (item.type_ === 'image' || item.type_ === 'file') {
      handleCopy(item, 'workbench');
    } else {
      handleCopyAndAutoPaste(item, 'workbench');
    }
  }, [selectedPinnedIds.length, handleCopyAndAutoPaste, handleCopy]);

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
    openContextMenu(item, index, event);
  }, [openContextMenu]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const panel = workbenchPanelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (!panel.contains(e.target) && !panel.contains(active) && active !== panel) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (pinnedItems.length === 0) return;
        e.preventDefault();
        setSelectedPinnedIds(pinnedItems.map(item => item.id));
        selectionAnchorIndexRef.current = 0;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pinnedItems]);

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
            if (!armDeleteConfirm('deleteSelected')) return;
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
          if (!armDeleteConfirm('delete')) return;
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
        <div className="workbench-empty">
          <div className="workbench-empty-icon">
            <Package size={48} strokeWidth={1} />
          </div>
          <div className="workbench-empty-title">{t('workbench.emptyTitle')}</div>
          <div className="workbench-empty-hint">{t('workbench.emptyHint')}</div>
          <div className="workbench-empty-guide">{t('workbench.workspaceGuide')}</div>
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

        {hasWorkbenchFilters && (
          <button
            className="clear-filter-btn workbench-type-clear-btn"
            onClick={handleClearWorkbenchFilters}
            title={t('toolbar.clearAll')}
          >
            <X size={12} />
            <span>{t('toolbar.clearFilter')}</span>
          </button>
        )}
      </div>

      {pinnedItems.length === 0 ? (
        <div className="workbench-filter-empty">
          <div className="workbench-empty-icon">
            <Package size={42} strokeWidth={1} />
          </div>
          <div className="workbench-empty-title">{t('workbench.noFilteredItems')}</div>
          <button className="clear-filter-btn" onClick={handleClearWorkbenchFilters}>
            <X size={12} /> {t('toolbar.clearFilter')}
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedItems.map(i => i.id)} strategy={rectSortingStrategy}>
            <div className="workbench-cards">
              {pinnedItems.map((item, index) => (
                <SortableWorkbenchCard
                  key={item.id}
                  item={item}
                  isCopied={copiedItemId === item.id && copyFeedbackSource === 'workbench'}
                  isMultiSelected={selectedPinnedIds.includes(item.id)}
                  isSelectionMode={selectedPinnedIds.length > 0}
                  onUnpin={() => togglePin(item)}
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
          onApplyBatchTag={batchActions.applyBatchTag}
          onCloseBatchTagEditor={batchActions.closeBatchTagEditor}
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
    </div>
  );
}

export default WorkbenchPanel;
