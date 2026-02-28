import { useRef, useEffect, useMemo, useCallback, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import useAppStore from '../../store/useAppStore';
import SearchBar from '../SearchBar';
import HistoryVirtualRow from './HistoryVirtualRow';
import MultiSelectBar from './MultiSelectBar';
import useHistoryEmptyDiagnostic from './hooks/useHistoryEmptyDiagnostic';
import useHistoryBatchActions from './hooks/useHistoryBatchActions';
import useHistoryKeyboardNavigation from './hooks/useHistoryKeyboardNavigation';
import useHistoryRowInteractions from './hooks/useHistoryRowInteractions';
import { getTags, getSourceApp, buildSourceTag, buildTypeTag } from '../../utils/tagHelpers';
import { getDateRangeForPreset, dateStringToTimestamp, dateStringToEndTimestamp } from '../../utils/dateHelpers';
import { searchItems } from '../../services/clipboardService';

const MEMORY_PROBE_PREFIX = '[MemoryProbe]';
const toLen = (value) => (typeof value === 'string' ? value.length : 0);

const VirtuosoScroller = forwardRef(function VirtuosoScroller(props, ref) {
  const { className = '', ...rest } = props;
  return <div ref={ref} className={`history-stream-scroller ${className}`.trim()} {...rest} />;
});

function detectClientPlatform() {
  if (typeof navigator === 'undefined') return 'other';
  const raw = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  if (raw.includes('linux')) return 'linux';
  return 'other';
}

const SUPPORTS_NATIVE_EXTERNAL_DRAG = ['windows', 'macos'].includes(detectClientPlatform());
const HISTORY_GROUP_ORDER = ['today', 'yesterday', 'last7', 'older'];

const normalizeText = (value) => (typeof value === 'string' ? value : '');
const tokenizeSearchQuery = (query) => normalizeText(query).toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 6);

const findFirstMatch = (text, terms) => {
  const normalized = normalizeText(text);
  if (!normalized || !Array.isArray(terms) || terms.length === 0) return null;
  const normalizedLower = normalized.toLowerCase();
  let best = null;
  terms.forEach((term) => {
    if (!term) return;
    const index = normalizedLower.indexOf(term);
    if (index < 0) return;
    if (!best || index < best.index) {
      best = { term, index };
    }
  });
  return best;
};

const buildSnippet = (text, match, radius = 46) => {
  const rawText = normalizeText(text).replace(/\s+/g, ' ').trim();
  if (!rawText) return '';
  if (!match || typeof match.index !== 'number' || !match.term) {
    return rawText.slice(0, 120);
  }
  const start = Math.max(0, match.index - radius);
  const end = Math.min(rawText.length, match.index + match.term.length + radius);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < rawText.length ? '...' : '';
  return `${prefix}${rawText.slice(start, end)}${suffix}`;
};

const buildDayBoundaries = (nowMs) => {
  const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
  now.setHours(0, 0, 0, 0);
  const startToday = Math.floor(now.getTime() / 1000);
  const startYesterday = startToday - 86400;
  const startLast7 = startToday - (86400 * 6);
  return { startToday, startYesterday, startLast7 };
};

const getHistoryGroupKey = (timestampSec, boundaries) => {
  const ts = Number(timestampSec || 0);
  if (ts >= boundaries.startToday) return 'today';
  if (ts >= boundaries.startYesterday) return 'yesterday';
  if (ts >= boundaries.startLast7) return 'last7';
  return 'older';
};

const sameDateRange = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (a.preset || '') === (b.preset || '')
    && (a.start ?? null) === (b.start ?? null)
    && (a.end ?? null) === (b.end ?? null);
};

const sameStringArray = (a, b) => {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  if (arrA.length !== arrB.length) return false;
  for (let i = 0; i < arrA.length; i += 1) {
    if (arrA[i] !== arrB[i]) return false;
  }
  return true;
};

const sameFilterSnapshot = (left, right) => (
  normalizeText(left?.searchQuery) === normalizeText(right?.searchQuery)
  && normalizeText(left?.selectedType || 'all') === normalizeText(right?.selectedType || 'all')
  && sameStringArray(left?.selectedTags, right?.selectedTags)
  && Boolean(left?.showFavoritesOnly) === Boolean(right?.showFavoritesOnly)
  && Boolean(left?.showPinnedOnly) === Boolean(right?.showPinnedOnly)
  && sameDateRange(left?.selectedDateRange, right?.selectedDateRange)
  && normalizeText(left?.customDateStart) === normalizeText(right?.customDateStart)
  && normalizeText(left?.customDateEnd) === normalizeText(right?.customDateEnd)
);

const itemMatchesFilterSnapshot = (item, snapshot, t) => {
  const queryTerms = tokenizeSearchQuery(snapshot?.searchQuery || '');
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

    if (!queryTerms.some(term => searchTarget.includes(term))) {
      return false;
    }
  }

  const selectedType = normalizeText(snapshot?.selectedType || 'all');
  if (selectedType === 'code') {
    if (!item.code_language) return false;
  } else if (selectedType !== 'all' && item.type_ !== selectedType) {
    return false;
  }

  if (snapshot?.showFavoritesOnly && !item.is_favorite) return false;
  if (snapshot?.showPinnedOnly && !item.is_pinned) return false;

  const selectedTags = Array.isArray(snapshot?.selectedTags) ? snapshot.selectedTags : [];
  if (selectedTags.length > 0) {
    const itemTags = getTags(item.tags);
    const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
    const typeTag = buildTypeTag(item.type_, t);
    const allItemTags = [...itemTags, ...(sourceTag ? [sourceTag] : []), ...(typeTag ? [typeTag] : [])];
    if (!selectedTags.some(tag => allItemTags.includes(tag))) return false;
  }

  const selectedDateRange = snapshot?.selectedDateRange;
  if (selectedDateRange) {
    const createdAt = Number(item.created_at || 0);
    const start = selectedDateRange.start != null ? Number(selectedDateRange.start) : null;
    const end = selectedDateRange.end != null ? Number(selectedDateRange.end) : null;
    if (start != null && createdAt < start) return false;
    if (end != null && createdAt > end) return false;
  }

  return true;
};

function HistoryStream({ style }) {
  const { t, i18n } = useTranslation();
  const selectionAnchorIndexRef = useRef(-1);
  const filterProbeRef = useRef(null);
  const lastFilterProbeLogAtRef = useRef(0);
  const hasTopTrackerInitRef = useRef(false);
  const prevTopItemIdRef = useRef(null);
  const compareFeedbackTimerRef = useRef(null);

  const items = useAppStore(s => s.items);
  const loading = useAppStore(s => s.loading);
  const searchQuery = useAppStore(s => s.searchQuery);
  const debouncedSearchQuery = useAppStore(s => s.debouncedSearchQuery);
  const selectedType = useAppStore(s => s.selectedType);
  const selectedTags = useAppStore(s => s.selectedTags);
  const showFavoritesOnly = useAppStore(s => s.showFavoritesOnly);
  const showPinnedOnly = useAppStore(s => s.showPinnedOnly);
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const previewItem = useAppStore(s => s.previewItem);
  const panelMode = useAppStore(s => s.panelMode);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const selectedItemIds = useAppStore(s => s.selectedItemIds);
  const compareCandidateIds = useAppStore(s => s.compareCandidateIds);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const itemsRevision = useAppStore(s => s.itemsRevision);

  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const setSelectedTags = useAppStore(s => s.setSelectedTags);
  const setShowFavoritesOnly = useAppStore(s => s.setShowFavoritesOnly);
  const setShowPinnedOnly = useAppStore(s => s.setShowPinnedOnly);
  const setShowTagFilter = useAppStore(s => s.setShowTagFilter);
  const setTagSearchQuery = useAppStore(s => s.setTagSearchQuery);
  const showTagFilter = useAppStore(s => s.showTagFilter);
  const tagSearchQuery = useAppStore(s => s.tagSearchQuery);
  const selectedDateRange = useAppStore(s => s.selectedDateRange);
  const showDateFilter = useAppStore(s => s.showDateFilter);
  const customDateStart = useAppStore(s => s.customDateStart);
  const customDateEnd = useAppStore(s => s.customDateEnd);
  const savedFilterViews = useAppStore(s => s.savedFilterViews);
  const activeFilterViewId = useAppStore(s => s.activeFilterViewId);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const toggleTagFilter = useAppStore(s => s.toggleTagFilter);
  const setSelectedDateRange = useAppStore(s => s.setSelectedDateRange);
  const setShowDateFilter = useAppStore(s => s.setShowDateFilter);
  const setCustomDateStart = useAppStore(s => s.setCustomDateStart);
  const setCustomDateEnd = useAppStore(s => s.setCustomDateEnd);
  const clearDateFilter = useAppStore(s => s.clearDateFilter);
  const saveCurrentFilterView = useAppStore(s => s.saveCurrentFilterView);
  const applySavedFilterView = useAppStore(s => s.applySavedFilterView);
  const deleteSavedFilterView = useAppStore(s => s.deleteSavedFilterView);
  const clearActiveFilterView = useAppStore(s => s.clearActiveFilterView);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const handleCopyAndAutoPaste = useAppStore(s => s.handleCopyAndAutoPaste);
  const handleCopy = useAppStore(s => s.handleCopy);
  const switchToCollection = useAppStore(s => s.switchToCollection);
  const loadMore = useAppStore(s => s.loadMore);
  const loadItems = useAppStore(s => s.loadItems);
  const togglePin = useAppStore(s => s.togglePin);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleRevealInFolder = useAppStore(s => s.handleRevealInFolder);
  const setCardBackground = useAppStore(s => s.setCardBackground);
  const toggleSelectItem = useAppStore(s => s.toggleSelectItem);
  const setSelectedItemIds = useAppStore(s => s.setSelectedItemIds);
  const clearSelection = useAppStore(s => s.clearSelection);
  const addTagToSelectedItems = useAppStore(s => s.addTagToSelectedItems);
  const deleteSelectedItems = useAppStore(s => s.deleteSelectedItems);
  const copySelectedItemsMerged = useAppStore(s => s.copySelectedItemsMerged);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);
  const setCollectionPanelEnabled = useAppStore(s => s.setCollectionPanelEnabled);
  const setHoverPreview = useAppStore(s => s.setHoverPreview);
  const clearHoverPreview = useAppStore(s => s.clearHoverPreview);
  const hoverPreviewItem = useAppStore(s => s.hoverPreviewItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);
  const focusedIndex = useAppStore(s => s.focusedIndex);
  const setFocusedIndex = useAppStore(s => s.setFocusedIndex);
  const openEditModal = useAppStore(s => s.openEditModal);
  const startTour = useAppStore(s => s.startTour);
  const previewItemId = previewItem?.id;
  const shouldUseHoverPreview = isMiniMode || !collectionPanelEnabled;

  const virtuosoRef = useRef(null);

  const setDebouncedSearchQuery = useAppStore(s => s.setDebouncedSearchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, setDebouncedSearchQuery]);

  const [backendSearchResults, setBackendSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const [visibleRangeStartIndex, setVisibleRangeStartIndex] = useState(0);
  const [compareFeedback, setCompareFeedback] = useState(null);

  const showCompareFeedback = useCallback((type, text) => {
    setCompareFeedback({ type, text });
    if (compareFeedbackTimerRef.current) {
      clearTimeout(compareFeedbackTimerRef.current);
    }
    compareFeedbackTimerRef.current = setTimeout(() => {
      setCompareFeedback(null);
      compareFeedbackTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTimeTick(Date.now());
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => () => {
    if (compareFeedbackTimerRef.current) {
      clearTimeout(compareFeedbackTimerRef.current);
      compareFeedbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (selectedItemIds.length > 0) return;
    setCompareFeedback(null);
    if (compareFeedbackTimerRef.current) {
      clearTimeout(compareFeedbackTimerRef.current);
      compareFeedbackTimerRef.current = null;
    }
  }, [selectedItemIds.length]);

  useEffect(() => {
    const query = debouncedSearchQuery.trim();
    if (!query) {
      setBackendSearchResults(null);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    searchItems(query, 200)
      .then((results) => {
        if (!cancelled) setBackendSearchResults(results);
      })
      .catch((err) => {
        console.error('[FTS] backend search failed:', err);
        if (!cancelled) setBackendSearchResults(null);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => { cancelled = true; };
  }, [debouncedSearchQuery, itemsRevision]);

  const allTags = useMemo(() => {
    const userTags = new Set();
    const aiTags = new Set();
    const sourceTags = new Set();
    const typeTags = new Set();

    items.forEach(item => {
      const tags = getTags(item.tags);
      tags.forEach(tag => {
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
  }, [items, t, i18n.language]);

  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

  const handleSelectDatePreset = useCallback((preset) => {
    if (preset === 'custom') {
      setSelectedDateRange({ preset: 'custom', start: null, end: null });
    } else {
      const range = getDateRangeForPreset(preset);
      if (range) setSelectedDateRange(range);
    }
  }, [setSelectedDateRange]);

  const handleApplyCustomDateRange = useCallback(() => {
    const start = dateStringToTimestamp(customDateStart);
    const end = dateStringToEndTimestamp(customDateEnd);
    if (start != null || end != null) {
      setSelectedDateRange({ preset: 'custom', start, end });
    }
  }, [customDateStart, customDateEnd, setSelectedDateRange]);

  const activeFilterView = useMemo(() => (
    savedFilterViews.find(view => view.id === activeFilterViewId) || null
  ), [savedFilterViews, activeFilterViewId]);

  useEffect(() => {
    if (!activeFilterView) return;

    const currentSnapshot = {
      searchQuery,
      selectedType,
      selectedTags,
      showFavoritesOnly,
      showPinnedOnly,
      selectedDateRange,
      customDateStart,
      customDateEnd,
    };

    if (!sameFilterSnapshot(activeFilterView.filters, currentSnapshot)) {
      clearActiveFilterView();
    }
  }, [
    activeFilterView,
    searchQuery,
    selectedType,
    selectedTags,
    showFavoritesOnly,
    showPinnedOnly,
    selectedDateRange,
    customDateStart,
    customDateEnd,
    clearActiveFilterView,
  ]);

  const filteredItems = useMemo(() => {
    const startedAt = performance.now();
    let scannedItems = 0;
    let scannedChars = 0;
    const normalizedQuery = debouncedSearchQuery.trim().toLowerCase();
    const hasSearch = normalizedQuery.length > 0;

    // When searching, use backend FTS results as base; otherwise use loaded items
    const baseItems = (hasSearch && backendSearchResults) ? backendSearchResults : items;

    let result = baseItems.filter(item => {
      scannedItems += 1;
      scannedChars += toLen(item.content) + toLen(item.ocr_text) + toLen(item.user_note);

      if (showFavoritesOnly && !item.is_favorite) return false;
      if (showPinnedOnly && !item.is_pinned) return false;
      if (selectedType === 'code') {
        if (!item.code_language) return false;
      } else if (selectedType !== 'all' && item.type_ !== selectedType) {
        return false;
      }

      if (selectedTags.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
        const typeTag = buildTypeTag(item.type_, t);
        const allItemTags = [...itemTags, ...(sourceTag ? [sourceTag] : []), ...(typeTag ? [typeTag] : [])];
        if (!selectedTags.some(st => allItemTags.includes(st))) return false;
      }

      if (selectedDateRange) {
        if (selectedDateRange.start != null && item.created_at < selectedDateRange.start) return false;
        if (selectedDateRange.end != null && item.created_at > selectedDateRange.end) return false;
      }

      // Text matching is handled by backend FTS when searching
      return true;
    });

    // Keep pinned-only results sorted by pin time (newest first).
    if (showPinnedOnly) {
      result.sort((a, b) => (b.pinned_at || 0) - (a.pinned_at || 0));
    }

    filterProbeRef.current = {
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      totalItems: baseItems.length,
      resultItems: result.length,
      scannedItems,
      scannedChars,
      hasSearch,
      searchChars: normalizedQuery.length,
      selectedTags: selectedTags.length,
      selectedType,
      showFavoritesOnly,
      showPinnedOnly,
      backendSearch: hasSearch && backendSearchResults != null,
    };

    return result;
  }, [items, backendSearchResults, selectedTags, selectedType, debouncedSearchQuery, showFavoritesOnly, showPinnedOnly, selectedDateRange, t, i18n.language]);

  const searchTerms = useMemo(() => tokenizeSearchQuery(debouncedSearchQuery), [debouncedSearchQuery]);

  const searchExplainById = useMemo(() => {
    if (searchTerms.length === 0) return new Map();

    const explains = new Map();
    filteredItems.forEach((item) => {
      const matchedSources = [];
      let snippet = '';
      let highlightTerm = searchTerms[0];

      const assignSnippet = (text, match) => {
        if (snippet || !match) return;
        snippet = buildSnippet(text, match);
        highlightTerm = match.term;
      };

      const contentMatch = findFirstMatch(item.content, searchTerms);
      if (contentMatch) {
        matchedSources.push('content');
        assignSnippet(item.content, contentMatch);
      }

      const noteMatch = findFirstMatch(item.user_note, searchTerms);
      if (noteMatch) {
        matchedSources.push('note');
        assignSnippet(item.user_note, noteMatch);
      }

      const ocrMatch = findFirstMatch(item.ocr_text, searchTerms);
      if (ocrMatch) {
        matchedSources.push('ocr');
        assignSnippet(item.ocr_text, ocrMatch);
      }

      const tags = getTags(item.tags);
      const matchedTag = tags.find(tag => findFirstMatch(tag, searchTerms));
      if (matchedTag) {
        matchedSources.push('tag');
        assignSnippet(matchedTag, findFirstMatch(matchedTag, searchTerms));
      }

      const sourceApp = getSourceApp(item.metadata);
      const sourceMatch = findFirstMatch(sourceApp, searchTerms);
      if (sourceMatch) {
        matchedSources.push('source');
        assignSnippet(sourceApp, sourceMatch);
      }

      const typeLabel = item.code_language
        ? t('search.typeFilter.code')
        : t(`search.typeFilter.${item.type_ || 'text'}`);
      const typeMatch = findFirstMatch(typeLabel, searchTerms);
      if (typeMatch) {
        matchedSources.push('type');
        assignSnippet(typeLabel, typeMatch);
      }

      if (matchedSources.length === 0) {
        matchedSources.push('content');
      }

      explains.set(item.id, {
        sources: matchedSources.slice(0, 4),
        snippet: snippet || buildSnippet(item.content || item.user_note || item.ocr_text, null),
        highlightTerm,
      });
    });

    return explains;
  }, [filteredItems, searchTerms, t, i18n.language]);

  const dayBoundaries = useMemo(() => buildDayBoundaries(timeTick), [timeTick]);

  const historyGrouping = useMemo(() => {
    const groupByIndex = [];
    const isGroupStart = [];
    const firstIndexByGroup = {};
    const countByGroup = {
      today: 0,
      yesterday: 0,
      last7: 0,
      older: 0,
    };

    filteredItems.forEach((item, index) => {
      const timestamp = Number(item.updated_at || item.created_at || 0);
      const groupKey = getHistoryGroupKey(timestamp, dayBoundaries);
      groupByIndex[index] = groupKey;
      countByGroup[groupKey] += 1;
      if (firstIndexByGroup[groupKey] == null) {
        firstIndexByGroup[groupKey] = index;
        isGroupStart[index] = true;
      } else {
        isGroupStart[index] = false;
      }
    });

    const availableGroups = HISTORY_GROUP_ORDER.filter(groupKey => firstIndexByGroup[groupKey] != null);
    return {
      groupByIndex,
      isGroupStart,
      firstIndexByGroup,
      countByGroup,
      availableGroups,
    };
  }, [filteredItems, dayBoundaries]);

  const activeVisibleGroup = useMemo(() => {
    if (filteredItems.length === 0) return null;
    const safeIndex = Math.max(0, Math.min(filteredItems.length - 1, visibleRangeStartIndex));
    return historyGrouping.groupByIndex[safeIndex] || historyGrouping.availableGroups[0] || null;
  }, [filteredItems.length, visibleRangeStartIndex, historyGrouping]);

  const { emptyDiagnostic, handleResetAllFilters } = useHistoryEmptyDiagnostic({
    searchTermsLength: searchTerms.length,
    backendSearchResults,
    itemsLength: items.length,
    selectedType,
    selectedTags,
    showFavoritesOnly,
    showPinnedOnly,
    selectedDateRange,
    t,
    setSearchQuery,
    setSelectedType,
    setSelectedTags,
    setShowFavoritesOnly,
    setShowPinnedOnly,
    setShowTagFilter,
    setTagSearchQuery,
    clearDateFilter,
    clearActiveFilterView,
  });

  const recentUsableSavedView = useMemo(() => {
    const shouldRecommendRestore = filteredItems.length === 0
      && emptyDiagnostic.mode !== 'first-use'
      && Array.isArray(savedFilterViews)
      && savedFilterViews.length > 0;
    if (!shouldRecommendRestore) return null;

    const rankedViews = [...savedFilterViews].sort(
      (left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0),
    );

    for (const view of rankedViews) {
      if (!view?.id || view.id === activeFilterViewId) continue;
      if (!view?.filters) continue;
      const hasAnyMatch = items.some(item => itemMatchesFilterSnapshot(item, view.filters, t));
      if (hasAnyMatch) return view;
    }

    return null;
  }, [
    filteredItems.length,
    emptyDiagnostic.mode,
    savedFilterViews,
    activeFilterViewId,
    items,
    t,
    i18n.language,
  ]);

  const handleRestoreRecentSavedView = useCallback(() => {
    if (!recentUsableSavedView?.id) return;
    applySavedFilterView(recentUsableSavedView.id);
  }, [recentUsableSavedView, applySavedFilterView]);

  const {
    showBatchTagEditor,
    batchTagEditorRef,
    batchTagSuggestionsRef,
    batchTagInput,
    batchTagPending,
    batchTagFeedback,
    batchTagActiveSuggestionIndex,
    setBatchTagActiveSuggestionIndex,
    batchAiRunningTask,
    batchAiFeedback,
    batchFlagPending,
    filteredBatchTagSuggestions,
    activeBatchTagSuggestion,
    canApplyBatchTag,
    canRunBatchAi,
    allSelectedAreFavorite,
    allSelectedArePinned,
    openBatchTagEditor,
    closeBatchTagEditor,
    applyBatchTag,
    handleBatchFavoriteToggle,
    handleBatchPinToggle,
    handleBatchAiAction,
    handleBatchTagInputKeyDown,
    handleBatchTagInputChange,
  } = useHistoryBatchActions({
    items,
    filteredItems,
    selectedItemIds,
    aiEnabled,
    maxPinnedItems,
    loadItems,
    addTagToSelectedItems,
    setBackendSearchResults,
    setFocusedIndex,
    selectionAnchorIndexRef,
    t,
    i18nLanguage: i18n.language,
  });

  useEffect(() => {
    const probe = filterProbeRef.current;
    if (!probe) return;

    const now = Date.now();
    if (now - lastFilterProbeLogAtRef.current < 800) return;

    const shouldLog =
      probe.hasSearch ||
      probe.selectedTags > 0 ||
      probe.selectedType !== 'all' ||
      probe.showFavoritesOnly ||
      probe.showPinnedOnly ||
      probe.totalItems >= 100 ||
      probe.elapsedMs >= 8;

    if (!shouldLog) return;

    lastFilterProbeLogAtRef.current = now;
    console.log(`${MEMORY_PROBE_PREFIX} filter`, probe);
  }, [filteredItems, debouncedSearchQuery, selectedTags, selectedType, showFavoritesOnly, showPinnedOnly, selectedDateRange, items.length]);

  const topFilteredItem = filteredItems[0] || null;
  const topFilteredItemSignature = topFilteredItem
    ? `${topFilteredItem.id}:${topFilteredItem.updated_at ?? ''}`
    : null;

  useEffect(() => {
    if (!hasTopTrackerInitRef.current) {
      hasTopTrackerInitRef.current = true;
      prevTopItemIdRef.current = topFilteredItemSignature;
      return;
    }

    const previousTopItemSignature = prevTopItemIdRef.current;
    prevTopItemIdRef.current = topFilteredItemSignature;

    if (!topFilteredItemSignature || topFilteredItemSignature === previousTopItemSignature) {
      return;
    }

    if (selectedItemIds.length > 0) {
      return;
    }

    const hasSearchOrFilters =
      !!debouncedSearchQuery.trim() ||
      selectedTags.length > 0 ||
      selectedType !== 'all' ||
      showFavoritesOnly ||
      showPinnedOnly ||
      !!selectedDateRange;
    if (hasSearchOrFilters) {
      return;
    }

    virtuosoRef.current?.scrollToIndex?.({
      index: 0,
      align: 'start',
      behavior: 'smooth',
    });
  }, [
    topFilteredItemSignature,
    selectedItemIds.length,
    debouncedSearchQuery,
    selectedTags.length,
    selectedType,
    showFavoritesOnly,
    showPinnedOnly,
    selectedDateRange,
  ]);

  const {
    handleCardClick,
    handleCardDoubleClick,
    handleStartExternalDrag,
    handleDragStart,
    handleStreamClick,
  } = useHistoryRowInteractions({
    filteredItems,
    selectedItemIds,
    panelMode,
    previewItemId,
    focusedIndex,
    shouldUseHoverPreview,
    hoverPreviewItem,
    selectionAnchorIndexRef,
    supportsNativeExternalDrag: SUPPORTS_NATIVE_EXTERNAL_DRAG,
    setSelectedItemIds,
    setFocusedIndex,
    setPanelMode,
    toggleSelectItem,
    clearSelection,
    setHoverPreview,
    clearHoverPreview,
    handleCopyAndAutoPaste,
    handleCopy,
    switchToCollection,
  });

  const { handleSearchInputKeyDown } = useHistoryKeyboardNavigation({
    filteredItems,
    focusedIndex,
    setFocusedIndex,
    shouldUseHoverPreview,
    setHoverPreview,
    setPanelMode,
    handleCopy,
    handleCopyAndAutoPaste,
    clearHoverPreview,
    selectedItemIds,
    historyTagShortcutEnabled,
    panelMode,
    setSelectedItemIds,
    toggleSelectItem,
    openBatchTagEditor,
    deleteSelectedItems,
    copySelectedItemsMerged,
    clearSelection,
    selectionAnchorIndexRef,
    historyGrouping,
    virtuosoRef,
  });

  const rowGap = isMiniMode ? 3 : 4;

  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const handleJumpToGroup = useCallback((groupKey) => {
    const targetIndex = historyGrouping.firstIndexByGroup[groupKey];
    if (typeof targetIndex !== 'number') return;
    virtuosoRef.current?.scrollToIndex?.({
      index: targetIndex,
      align: 'start',
      behavior: 'smooth',
    });
    setFocusedIndex(targetIndex);
  }, [historyGrouping, setFocusedIndex]);

  const handleRangeChanged = useCallback((range) => {
    const nextStart = Number(range?.startIndex);
    if (!Number.isFinite(nextStart)) return;
    setVisibleRangeStartIndex(nextStart);
  }, []);

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const computeItemKey = useCallback((index) => filteredItems[index]?.id ?? index, [filteredItems]);

  const buildRowViewModel = useCallback((index) => {
    const item = filteredItems[index];
    if (!item) return null;
    const groupKey = historyGrouping.groupByIndex[index];
    return {
      item,
      index,
      groupKey,
      showGroupHeader: Boolean(historyGrouping.isGroupStart[index]),
      groupCount: historyGrouping.countByGroup[groupKey] || 0,
      searchExplain: searchExplainById.get(item.id) || null,
      isSelected: panelMode === 'preview' && previewItem?.id === item.id,
      isMultiSelected: selectedItemIdSet.has(item.id),
      isFocused: focusedIndex === index,
    };
  }, [
    filteredItems,
    historyGrouping,
    searchExplainById,
    panelMode,
    previewItem?.id,
    selectedItemIdSet,
    focusedIndex,
  ]);

  const rowCommonProps = useMemo(() => ({
    rowGap,
    t,
    copiedItemId,
    copyFeedbackSource,
    timeTick,
    onDragStart: handleDragStart,
    supportsNativeExternalDrag: SUPPORTS_NATIVE_EXTERNAL_DRAG,
    onStartExternalDrag: handleStartExternalDrag,
    onTogglePin: togglePin,
    onToggleFavorite: toggleFavorite,
    onOpenItem: handleOpenItem,
    onRevealInFolder: handleRevealInFolder,
    onSetCardBackground: setCardBackground,
    onTagClick: handleTagClick,
  }), [
    rowGap,
    t,
    copiedItemId,
    copyFeedbackSource,
    timeTick,
    handleDragStart,
    handleStartExternalDrag,
    togglePin,
    toggleFavorite,
    handleOpenItem,
    handleRevealInFolder,
    setCardBackground,
    handleTagClick,
  ]);

  const renderVirtualRow = useCallback((index) => {
    const rowViewModel = buildRowViewModel(index);
    if (!rowViewModel) return null;
    return (
      <HistoryVirtualRow
        {...rowCommonProps}
        {...rowViewModel}
        onCardClick={handleCardClick}
        onCardDoubleClick={handleCardDoubleClick}
      />
    );
  }, [
    buildRowViewModel,
    rowCommonProps,
    handleCardClick,
    handleCardDoubleClick,
  ]);

  const handleToggleFavoritesOnly = useCallback(() => {
    setShowFavoritesOnly(!showFavoritesOnly);
  }, [setShowFavoritesOnly, showFavoritesOnly]);

  const handleTogglePinnedOnly = useCallback(() => {
    setShowPinnedOnly(!showPinnedOnly);
  }, [setShowPinnedOnly, showPinnedOnly]);

  const handleClearSelectedTags = useCallback(() => {
    setSelectedTags([]);
  }, [setSelectedTags]);

  const handleToggleTagFilterVisible = useCallback(() => {
    setShowTagFilter(!showTagFilter);
  }, [setShowTagFilter, showTagFilter]);

  const handleOpenSettingsPanel = useCallback(() => {
    setShowSettings(true);
  }, [setShowSettings]);

  const handleToggleDateFilterVisible = useCallback(() => {
    setShowDateFilter(!showDateFilter);
  }, [setShowDateFilter, showDateFilter]);

  const searchBarProps = useMemo(() => ({
    searchQuery,
    onSearchChange: setSearchQuery,
    selectedType,
    onTypeChange: setSelectedType,
    showFavoritesOnly,
    onToggleFavorites: handleToggleFavoritesOnly,
    showPinnedOnly,
    onTogglePinned: handleTogglePinnedOnly,
    isMiniMode,
    selectedTags,
    onClearTags: handleClearSelectedTags,
    showTagFilter,
    onToggleTagFilter: handleToggleTagFilterVisible,
    allTags,
    filteredTagsList,
    tagSearchQuery,
    onTagSearchChange: setTagSearchQuery,
    onToggleTag: toggleTagFilter,
    onOpenSettings: handleOpenSettingsPanel,
    selectedDateRange,
    showDateFilter,
    onToggleDateFilter: handleToggleDateFilterVisible,
    onClearDateFilter: clearDateFilter,
    onSelectDatePreset: handleSelectDatePreset,
    customDateStart,
    customDateEnd,
    onCustomDateStartChange: setCustomDateStart,
    onCustomDateEndChange: setCustomDateEnd,
    onApplyCustomDateRange: handleApplyCustomDateRange,
    onSearchKeyDown: handleSearchInputKeyDown,
    savedFilterViews,
    activeFilterViewId,
    onSaveCurrentView: saveCurrentFilterView,
    onApplySavedView: applySavedFilterView,
    onDeleteSavedView: deleteSavedFilterView,
    onClearActiveSavedView: clearActiveFilterView,
  }), [
    searchQuery,
    setSearchQuery,
    selectedType,
    setSelectedType,
    showFavoritesOnly,
    handleToggleFavoritesOnly,
    showPinnedOnly,
    handleTogglePinnedOnly,
    isMiniMode,
    selectedTags,
    handleClearSelectedTags,
    showTagFilter,
    handleToggleTagFilterVisible,
    allTags,
    filteredTagsList,
    tagSearchQuery,
    setTagSearchQuery,
    toggleTagFilter,
    handleOpenSettingsPanel,
    selectedDateRange,
    showDateFilter,
    handleToggleDateFilterVisible,
    clearDateFilter,
    handleSelectDatePreset,
    customDateStart,
    customDateEnd,
    setCustomDateStart,
    setCustomDateEnd,
    handleApplyCustomDateRange,
    handleSearchInputKeyDown,
    savedFilterViews,
    activeFilterViewId,
    saveCurrentFilterView,
    applySavedFilterView,
    deleteSavedFilterView,
    clearActiveFilterView,
  ]);

  const handleToggleBatchTagEditor = useCallback(() => {
    if (showBatchTagEditor) {
      closeBatchTagEditor();
      return;
    }
    openBatchTagEditor();
  }, [showBatchTagEditor, closeBatchTagEditor, openBatchTagEditor]);

  const handleMergeCopySelected = useCallback(() => {
    copySelectedItemsMerged(filteredItems);
  }, [copySelectedItemsMerged, filteredItems]);

  const selectedItemsForCompare = useMemo(() => {
    if (selectedItemIds.length < 2) return [];
    const selectedIdSet = new Set(selectedItemIds);
    const orderedByVisible = filteredItems.filter(item => selectedIdSet.has(item.id));
    if (orderedByVisible.length >= 2) return orderedByVisible;

    const fallbackById = new Map(items.map(item => [item.id, item]));
    return selectedItemIds
      .map(id => fallbackById.get(id))
      .filter(Boolean);
  }, [selectedItemIds, filteredItems, items]);

  const selectedCompareCandidateIds = useMemo(
    () => selectedItemsForCompare.map(item => item.id),
    [selectedItemsForCompare],
  );

  const handleCompareSelected = useCallback(() => {
    if (selectedItemsForCompare.length < 2) return;
    const targetItems = selectedItemsForCompare;
    if (isMiniMode) {
      showCompareFeedback('warning', t('panel.compareNeedFullMode'));
      return;
    }
    if (!collectionPanelEnabled) {
      setCollectionPanelEnabled(true);
      showCompareFeedback('success', t('panel.comparePanelAutoOpened'));
    }
    setPanelMode('compare', targetItems);
  }, [
    selectedItemsForCompare,
    isMiniMode,
    collectionPanelEnabled,
    setCollectionPanelEnabled,
    showCompareFeedback,
    t,
    setPanelMode,
  ]);

  useEffect(() => {
    if (panelMode !== 'compare') return;
    if (selectedItemsForCompare.length < 2) return;
    if (sameStringArray(selectedCompareCandidateIds, compareCandidateIds)) return;
    setPanelMode('compare', selectedItemsForCompare);
  }, [
    panelMode,
    selectedItemsForCompare,
    selectedCompareCandidateIds,
    compareCandidateIds,
    setPanelMode,
  ]);

  const handleQuickCompareTopVisible = useCallback((targetItems) => {
    if (!Array.isArray(targetItems) || targetItems.length < 2) return;
    if (isMiniMode) {
      showCompareFeedback('warning', t('panel.compareNeedFullMode'));
      return;
    }
    if (!collectionPanelEnabled) {
      setCollectionPanelEnabled(true);
      showCompareFeedback('success', t('panel.comparePanelAutoOpened'));
    }
    setPanelMode('compare', targetItems.slice(0, 2));
  }, [
    isMiniMode,
    collectionPanelEnabled,
    setCollectionPanelEnabled,
    showCompareFeedback,
    t,
    setPanelMode,
  ]);

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleQuickCompareShortcut = (event) => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (isEditableElement(event.target)) return;
      if (event.key !== '2') return;
      if (selectedItemIds.length > 0) return;
      if (filteredItems.length < 2) return;
      event.preventDefault();
      handleQuickCompareTopVisible(filteredItems.slice(0, 2));
    };

    window.addEventListener('keydown', handleQuickCompareShortcut);
    return () => window.removeEventListener('keydown', handleQuickCompareShortcut);
  }, [selectedItemIds.length, filteredItems, handleQuickCompareTopVisible]);

  const selectedCount = selectedItemIds.length;
  const multiSelectBarProps = useMemo(() => ({
    selectedCount,
    showBatchTagEditor,
    onToggleBatchTagEditor: handleToggleBatchTagEditor,
    onBatchFavoriteToggle: handleBatchFavoriteToggle,
    allSelectedAreFavorite,
    onBatchPinToggle: handleBatchPinToggle,
    allSelectedArePinned,
    onMergeCopy: handleMergeCopySelected,
    canCompareSelected: selectedItemsForCompare.length >= 2,
    onCompareSelected: handleCompareSelected,
    canRunBatchAi,
    onBatchAiAction: handleBatchAiAction,
    batchFlagPending,
    batchAiRunningTask,
    onDeleteSelected: deleteSelectedItems,
    batchTagEditorRef,
    batchTagInput,
    onBatchTagInputChange: handleBatchTagInputChange,
    handleBatchTagInputKeyDown,
    canApplyBatchTag,
    applyBatchTag,
    activeBatchTagSuggestion,
    batchTagPending,
    closeBatchTagEditor,
    filteredBatchTagSuggestions,
    batchTagSuggestionsRef,
    batchTagActiveSuggestionIndex,
    setBatchTagActiveSuggestionIndex,
    compareFeedback,
    batchTagFeedback,
    batchAiFeedback,
  }), [
    selectedCount,
    showBatchTagEditor,
    handleToggleBatchTagEditor,
    handleBatchFavoriteToggle,
    allSelectedAreFavorite,
    handleBatchPinToggle,
    allSelectedArePinned,
    handleMergeCopySelected,
    selectedItemsForCompare.length,
    handleCompareSelected,
    canRunBatchAi,
    handleBatchAiAction,
    batchFlagPending,
    batchAiRunningTask,
    deleteSelectedItems,
    batchTagEditorRef,
    batchTagInput,
    handleBatchTagInputChange,
    handleBatchTagInputKeyDown,
    canApplyBatchTag,
    applyBatchTag,
    activeBatchTagSuggestion,
    batchTagPending,
    closeBatchTagEditor,
    filteredBatchTagSuggestions,
    batchTagSuggestionsRef,
    batchTagActiveSuggestionIndex,
    setBatchTagActiveSuggestionIndex,
    compareFeedback,
    batchTagFeedback,
    batchAiFeedback,
  ]);

  return (
    <div className="history-stream" style={style} onClick={handleStreamClick}>
      <SearchBar {...searchBarProps} />

      <div className="history-stream-content">
        {historyGrouping.availableGroups.length > 1 && (
          <div className="history-group-jump" onClick={(event) => event.stopPropagation()}>
            {historyGrouping.availableGroups.map((groupKey) => (
              <button
                key={groupKey}
                type="button"
                className={`history-group-jump-btn ${activeVisibleGroup === groupKey ? 'active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleJumpToGroup(groupKey);
                }}
                title={`${t(`history.groups.${groupKey}`)} (${historyGrouping.countByGroup[groupKey]})`}
                aria-label={`${t(`history.groups.${groupKey}`)} (${historyGrouping.countByGroup[groupKey]})`}
                aria-pressed={activeVisibleGroup === groupKey}
              >
                <span>{t(`history.groups.${groupKey}`)}</span>
                <span className="history-group-jump-count">{historyGrouping.countByGroup[groupKey]}</span>
              </button>
            ))}
          </div>
        )}
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <div className="loading-text">{t('app.loading')}</div>
          </div>
        ) : isSearching ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <div className="loading-text">{t('search.searching')}</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty empty-diagnostic" role="status" aria-live="polite">
            <div className="empty-content">
              <div className="empty-title">{emptyDiagnostic.title}</div>
              {emptyDiagnostic.description && (
                <div className="empty-detail">{emptyDiagnostic.description}</div>
              )}
              {emptyDiagnostic.mode === 'first-use' && (
                <div className="empty-actions-row">
                  <button
                    type="button"
                    className="empty-action-btn"
                    onClick={() => openEditModal()}
                    aria-label={t('search.empty.startQuickCapture')}
                  >
                    {t('search.empty.startQuickCapture')}
                  </button>
                  <button
                    type="button"
                    className="empty-action-btn ghost"
                    onClick={() => startTour()}
                    aria-label={t('search.empty.replayGuide')}
                  >
                    {t('search.empty.replayGuide')}
                  </button>
                </div>
              )}
              {emptyDiagnostic.mode !== 'first-use' && recentUsableSavedView && (
                <>
                  <div className="empty-actions-row">
                    <button
                      type="button"
                      className="empty-action-btn"
                      onClick={handleRestoreRecentSavedView}
                    >
                      {t('search.empty.restoreRecentView')}
                    </button>
                    {emptyDiagnostic.canReset && (
                      <button
                        type="button"
                        className="empty-action-btn ghost"
                        onClick={handleResetAllFilters}
                      >
                        {t('search.empty.clearAllFilters')}
                      </button>
                    )}
                  </div>
                  <div className="empty-detail">
                    {t('search.empty.restoreRecentViewHint', { name: recentUsableSavedView.name })}
                  </div>
                </>
              )}
              {emptyDiagnostic.canReset && !recentUsableSavedView && (
                <button type="button" className="empty-action-btn" onClick={handleResetAllFilters}>
                  {t('search.empty.clearAllFilters')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="history-stream-virtuoso"
            components={{ Scroller: VirtuosoScroller }}
            totalCount={filteredItems.length}
            computeItemKey={computeItemKey}
            itemContent={renderVirtualRow}
            endReached={handleEndReached}
            rangeChanged={handleRangeChanged}
            increaseViewportBy={{ top: 200, bottom: 400 }}
          />
        )}
      </div>

      {showFavoritesOnly && (
        <div className="history-stream-helper-text">
          {t('collection.longTermStorageHint')}
        </div>
      )}

      {selectedCount > 0 && (
        <MultiSelectBar {...multiSelectBarProps} />
      )}
    </div>
  );
}

export default HistoryStream;
