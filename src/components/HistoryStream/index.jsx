import { useRef, useEffect, useMemo, useCallback, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { invoke } from '@tauri-apps/api/core';
import useAppStore from '../../store/useAppStore';
import SearchBar from '../SearchBar';
import CollectionBoard from '../CollectionBoard';
import HistoryVirtualRow from './HistoryVirtualRow';
import HistoryContextMenu from './HistoryContextMenu';
import QuickTagPopover from '../shared/QuickTagPopover';
import MultiSelectBar from './MultiSelectBar';
import useHistoryEmptyDiagnostic from './hooks/useHistoryEmptyDiagnostic';
import useHistoryBatchActions from './hooks/useHistoryBatchActions';
import useHistoryContextMenu from './hooks/useHistoryContextMenu';
import useHistoryKeyboardNavigation from './hooks/useHistoryKeyboardNavigation';
import useHistoryRowInteractions from './hooks/useHistoryRowInteractions';
import { getTags, getSourceApp, buildSourceTag, buildTypeTag } from '../../utils/tagHelpers';
import { QUICK_INPUT_SOURCE } from '../../utils/sourceConstants';
import { openItemPreview } from '../../utils/previewInteractionPolicy';
import { buildSearchRequest } from '../../utils/searchRequestBuilder';
import { getUserTags, searchItems } from '../../services/clipboardService';
import { sendClipboardItemViaEmail } from '../../services/emailRelayService';

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
const VIRTUOSO_INCREASE_VIEWPORT = { top: 200, bottom: 400 };
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

const buildSearchExplain = (item, searchTerms, t) => {
  if (!item?.id || !Array.isArray(searchTerms) || searchTerms.length === 0) return null;

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
  const matchedTag = tags.find((tag) => findFirstMatch(tag, searchTerms));
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

  return {
    sources: matchedSources.slice(0, 4),
    snippet: snippet || buildSnippet(item.content || item.user_note || item.ocr_text, null),
    highlightTerm,
  };
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
  const quickAddFeedbackTimerRef = useRef(null);
  const addFromSearchButtonRef = useRef(null);
  const addToHistoryFromSearchButtonRef = useRef(null);
  const quickAddPendingRef = useRef(false);
  const quickAddUndoPendingRef = useRef(false);

  const items = useAppStore(s => s.items);
  const loading = useAppStore(s => s.loading);
  const loadingMore = useAppStore(s => s.loadingMore);
  const historyLoadStopReason = useAppStore(s => s.historyLoadStopReason);
  const searchQuery = useAppStore(s => s.searchQuery);
  const collectionSearchQuery = useAppStore(s => s.collectionSearchQuery);
  const debouncedSearchQuery = useAppStore(s => s.debouncedSearchQuery);
  const historyRecentSearches = useAppStore(s => s.historyRecentSearches);
  const collectionRecentSearches = useAppStore(s => s.collectionRecentSearches);
  const selectedType = useAppStore(s => s.selectedType);
  const selectedTags = useAppStore(s => s.selectedTags);
  const showFavoritesOnly = useAppStore(s => s.showFavoritesOnly);
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const previewItem = useAppStore(s => s.previewItem);
  const panelMode = useAppStore(s => s.panelMode);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const selectedItemIds = useAppStore(s => s.selectedItemIds);
  const compareCandidateIds = useAppStore(s => s.compareCandidateIds);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const emailRelayEnabled = useAppStore(s => s.emailRelayEnabled);
  const autoCleanupEnabled = useAppStore(s => s.autoCleanupEnabled);
  const cleanupMaxItems = useAppStore(s => s.cleanupMaxItems);
  const cleanupMaxAgeDays = useAppStore(s => s.cleanupMaxAgeDays);
  const startupFavoritesViewEnabled = useAppStore(s => s.startupFavoritesViewEnabled);
  const itemsRevision = useAppStore(s => s.itemsRevision);
  const itemsById = useAppStore(s => s.itemsById);

  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setCollectionSearchQuery = useAppStore(s => s.setCollectionSearchQuery);
  const addHistoryRecentSearch = useAppStore(s => s.addHistoryRecentSearch);
  const removeHistoryRecentSearch = useAppStore(s => s.removeHistoryRecentSearch);
  const clearHistoryRecentSearches = useAppStore(s => s.clearHistoryRecentSearches);
  const addCollectionRecentSearch = useAppStore(s => s.addCollectionRecentSearch);
  const removeCollectionRecentSearch = useAppStore(s => s.removeCollectionRecentSearch);
  const clearCollectionRecentSearches = useAppStore(s => s.clearCollectionRecentSearches);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const setSelectedTags = useAppStore(s => s.setSelectedTags);
  const setShowFavoritesOnly = useAppStore(s => s.setShowFavoritesOnly);
  const setShowTagFilter = useAppStore(s => s.setShowTagFilter);
  const setTagSearchQuery = useAppStore(s => s.setTagSearchQuery);
  const showTagFilter = useAppStore(s => s.showTagFilter);
  const tagSearchQuery = useAppStore(s => s.tagSearchQuery);
  const selectedDateRange = useAppStore(s => s.selectedDateRange);
  const showDateFilter = useAppStore(s => s.showDateFilter);
  const savedFilterViews = useAppStore(s => s.savedFilterViews);
  const activeFilterViewId = useAppStore(s => s.activeFilterViewId);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const toggleTagFilter = useAppStore(s => s.toggleTagFilter);
  const setShowDateFilter = useAppStore(s => s.setShowDateFilter);
  const clearDateFilter = useAppStore(s => s.clearDateFilter);
  const clearActiveFilterView = useAppStore(s => s.clearActiveFilterView);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const handleCopyAndAutoPaste = useAppStore(s => s.handleCopyAndAutoPaste);
  const handleCopy = useAppStore(s => s.handleCopy);
  const handleCopyPlainText = useAppStore(s => s.handleCopyPlainText);
  const switchToWorkbench = useAppStore(s => s.switchToWorkbench);
  const loadMore = useAppStore(s => s.loadMore);
  const loadItems = useAppStore(s => s.loadItems);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleRevealInFolder = useAppStore(s => s.handleRevealInFolder);
  const openShareModal = useAppStore(s => s.openShareModal);
  const setCardBackground = useAppStore(s => s.setCardBackground);
  const toggleSelectItem = useAppStore(s => s.toggleSelectItem);
  const setSelectedItemIds = useAppStore(s => s.setSelectedItemIds);
  const clearSelection = useAppStore(s => s.clearSelection);
  const addTagToItem = useAppStore(s => s.addTagToItem);
  const removeTagFromItem = useAppStore(s => s.removeTagFromItem);
  const addTagToSelectedItems = useAppStore(s => s.addTagToSelectedItems);
  const [quickTagPopoverState, setQuickTagPopoverState] = useState(null);
  const deleteSelectedItems = useAppStore(s => s.deleteSelectedItems);
  const copySelectedItemsMerged = useAppStore(s => s.copySelectedItemsMerged);
  const mergeSelectedItemsToNote = useAppStore(s => s.mergeSelectedItemsToNote);
  const workbenchPanelEnabled = useAppStore(s => s.workbenchPanelEnabled);
  const setWorkbenchPanelEnabled = useAppStore(s => s.setWorkbenchPanelEnabled);
  const autoPasteOnDoubleClick = useAppStore(s => s.autoPasteOnDoubleClick);
  const deleteItem = useAppStore(s => s.deleteItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);
  const focusedIndex = useAppStore(s => s.focusedIndex);
  const setFocusedIndex = useAppStore(s => s.setFocusedIndex);
  const openEditModal = useAppStore(s => s.openEditModal);
  const startTour = useAppStore(s => s.startTour);
  const previewItemId = previewItem?.id;
  const isCollectionMode = showFavoritesOnly;
  const activeTopSearchQuery = isCollectionMode ? collectionSearchQuery : searchQuery;
  const activeTopRecentSearches = isCollectionMode ? collectionRecentSearches : historyRecentSearches;

  const virtuosoRef = useRef(null);

  const setDebouncedSearchQuery = useAppStore(s => s.setDebouncedSearchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, setDebouncedSearchQuery]);

  useEffect(() => {
    const normalizedQuery = typeof debouncedSearchQuery === 'string' ? debouncedSearchQuery.trim() : '';
    if (!normalizedQuery) return;
    addHistoryRecentSearch(normalizedQuery);
  }, [addHistoryRecentSearch, debouncedSearchQuery]);

  useEffect(() => {
    const normalizedCollectionQuery = typeof collectionSearchQuery === 'string' ? collectionSearchQuery.trim() : '';
    if (!isCollectionMode || !normalizedCollectionQuery) return;
    const timer = window.setTimeout(() => {
      addCollectionRecentSearch(normalizedCollectionQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [addCollectionRecentSearch, collectionSearchQuery, isCollectionMode]);

  useEffect(() => {
    if (showDateFilter) {
      setShowDateFilter(false);
    }
    if (selectedDateRange) {
      clearDateFilter();
    }
    if (activeFilterViewId) {
      clearActiveFilterView();
    }
  }, [
    showDateFilter,
    selectedDateRange,
    activeFilterViewId,
    setShowDateFilter,
    clearDateFilter,
    clearActiveFilterView,
  ]);

  const [backendSearchResults, setBackendSearchResults] = useState(null);
  const [backendSearchError, setBackendSearchError] = useState('');
  const [backendSearchRefreshNonce, setBackendSearchRefreshNonce] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [backendUserTags, setBackendUserTags] = useState([]);
  const [debouncedTagSearchQuery, setDebouncedTagSearchQuery] = useState('');
  const [timeTick, setTimeTick] = useState(() => Date.now());
  const [visibleRangeStartIndex, setVisibleRangeStartIndex] = useState(0);
  const [compareFeedback, setCompareFeedback] = useState(null);
  const [quickAddFeedback, setQuickAddFeedback] = useState(null);
  const [quickAddPending, setQuickAddPending] = useState(false);
  const [quickAddMode, setQuickAddMode] = useState(null);
  const [quickAddUndoPending, setQuickAddUndoPending] = useState(false);
  const [collectionVisibleItems, setCollectionVisibleItems] = useState([]);

  useEffect(() => {
    quickAddPendingRef.current = quickAddPending;
  }, [quickAddPending]);

  useEffect(() => {
    quickAddUndoPendingRef.current = quickAddUndoPending;
  }, [quickAddUndoPending]);

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

  const clearQuickAddFeedbackTimer = useCallback(() => {
    if (!quickAddFeedbackTimerRef.current) return;
    clearTimeout(quickAddFeedbackTimerRef.current);
    quickAddFeedbackTimerRef.current = null;
  }, []);

  const showQuickAddFeedback = useCallback((payload, duration = 2200) => {
    clearQuickAddFeedbackTimer();
    setQuickAddFeedback(payload);
    if (duration <= 0) return;
    quickAddFeedbackTimerRef.current = setTimeout(() => {
      setQuickAddFeedback(null);
      quickAddFeedbackTimerRef.current = null;
    }, duration);
  }, [clearQuickAddFeedbackTimer]);

  const focusSearchInput = useCallback(() => {
    const input = document.getElementById('history-search-input');
    if (!input) return;
    input.focus();
    const length = input.value?.length ?? 0;
    input.setSelectionRange?.(length, length);
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
    if (quickAddFeedbackTimerRef.current) {
      clearTimeout(quickAddFeedbackTimerRef.current);
      quickAddFeedbackTimerRef.current = null;
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

  const backendSearchRequest = useMemo(() => {
    return buildSearchRequest({
      queryText: debouncedSearchQuery,
      selectedType,
      selectedTags,
      showFavoritesOnly,
      selectedDateRange,
      t,
    });
  }, [
    debouncedSearchQuery,
    selectedType,
    selectedTags,
    showFavoritesOnly,
    selectedDateRange,
    t,
    i18n.language,
  ]);

  useEffect(() => {
    if (!backendSearchRequest.shouldQueryBackend) {
      setBackendSearchResults(null);
      setBackendSearchError('');
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const limit = Math.max(800, Math.min(6000, items.length + 400));
    searchItems(backendSearchRequest.query, limit, backendSearchRequest.filters)
      .then((results) => {
        if (!cancelled) {
          setBackendSearchResults(Array.isArray(results) ? results : []);
          setBackendSearchError('');
        }
      })
      .catch((err) => {
        console.error('[History] backend filtered search failed:', err);
        if (!cancelled) {
          const message = typeof err === 'string' ? err : String(err?.message || err || '');
          setBackendSearchError(message || t('search.queryFailed'));
          setBackendSearchResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => { cancelled = true; };
  }, [backendSearchRequest, items.length, itemsRevision, backendSearchRefreshNonce, t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTagSearchQuery(tagSearchQuery.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [tagSearchQuery]);

  useEffect(() => {
    if (showFavoritesOnly) {
      setBackendUserTags([]);
      return;
    }

    let cancelled = false;
    getUserTags(debouncedTagSearchQuery, 120)
      .then((tags) => {
        if (cancelled) return;
        if (!Array.isArray(tags)) {
          setBackendUserTags([]);
          return;
        }
        setBackendUserTags(tags.filter(tag => typeof tag === 'string' && tag.trim() && !tag.startsWith('AI:')));
      })
      .catch((error) => {
        console.error('[History] load user tags failed:', error);
        if (!cancelled) setBackendUserTags([]);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedTagSearchQuery, showFavoritesOnly, itemsRevision]);

  const pureUserTags = useMemo(() => {
    const fallbackUserTags = new Set();
    items.forEach(item => {
      const tags = getTags(item.tags);
      tags.forEach(tag => {
        if (!tag.startsWith('AI:')) fallbackUserTags.add(tag);
      });
    });

    const localFallbackList = Array.from(fallbackUserTags).sort();
    const seenBackendTags = new Set();
    const normalizedBackendTags = [];
    backendUserTags.forEach((tag) => {
      if (typeof tag !== 'string') return;
      const normalized = tag.trim();
      if (!normalized || seenBackendTags.has(normalized)) return;
      seenBackendTags.add(normalized);
      normalizedBackendTags.push(normalized);
    });

    return normalizedBackendTags.length > 0
      ? normalizedBackendTags
      : (!debouncedTagSearchQuery ? localFallbackList : []);
  }, [items, backendUserTags, debouncedTagSearchQuery]);

  const allTags = useMemo(() => {
    const sourceTags = new Set();
    const typeTags = new Set();

    items.forEach(item => {
      const sourceTag = buildSourceTag(getSourceApp(item.metadata), t);
      if (sourceTag) sourceTags.add(sourceTag);

      const typeTag = buildTypeTag(item.type_, t);
      if (typeTag) typeTags.add(typeTag);
    });

    return [
      ...Array.from(typeTags).sort(),
      ...pureUserTags,
      ...Array.from(sourceTags).sort(),
    ];
  }, [items, pureUserTags, t, i18n.language]);

  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

  useEffect(() => {
    if (!showFavoritesOnly || selectedTags.length === 0) return;
    setSelectedTags([]);
  }, [showFavoritesOnly, selectedTags.length, setSelectedTags]);

  useEffect(() => {
    if (isCollectionMode) return;
    setCollectionVisibleItems([]);
  }, [isCollectionMode]);

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
      selectedDateRange,
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
    selectedDateRange,
    clearActiveFilterView,
  ]);

  const filteredItems = useMemo(() => {
    const startedAt = performance.now();
    const normalizedQuery = backendSearchRequest.query.toLowerCase();
    const shouldUseBackendBase = Array.isArray(backendSearchResults);
    const baseItems = shouldUseBackendBase ? backendSearchResults : items;
    let result = baseItems;

    filterProbeRef.current = {
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      totalItems: baseItems.length,
      resultItems: result.length,
      scannedItems: shouldUseBackendBase ? 0 : baseItems.length,
      scannedChars: shouldUseBackendBase
        ? 0
        : baseItems.reduce(
          (sum, item) => sum + toLen(item.content) + toLen(item.ocr_text) + toLen(item.user_note),
          0,
        ),
      hasSearch: normalizedQuery.length > 0,
      searchChars: normalizedQuery.length,
      selectedTags: selectedTags.length,
      selectedType,
      showFavoritesOnly,
      backendSearch: shouldUseBackendBase,
      backendFilters: backendSearchRequest.hasStructuredFilters,
    };

    return result;
  }, [
    items,
    backendSearchResults,
    backendSearchRequest,
    selectedTags.length,
    selectedType,
    showFavoritesOnly,
  ]);



  const contextMenuItems = useMemo(
    () => (
      isCollectionMode
        ? (collectionVisibleItems.length > 0 ? collectionVisibleItems : filteredItems)
        : filteredItems
    ),
    [isCollectionMode, collectionVisibleItems, filteredItems],
  );

  const {
    historyRootRef,
    contextMenuRef,
    contextMenuState,
    openContextMenu,
    closeContextMenu,
    armDeleteConfirm,
  } = useHistoryContextMenu({
    filteredItems: contextMenuItems,
    selectedItemIds,
    selectionAnchorIndexRef,
    setSelectedItemIds,
    setFocusedIndex,
  });

  const handleOpenQuickTag = useCallback((targetItem, anchorPosition = null) => {
    if (!targetItem?.id) return;
    closeContextMenu();
    let computedAnchor = anchorPosition;
    if (!computedAnchor && typeof document !== 'undefined') {
      const el = document.querySelector(`[data-item-id="${targetItem.id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        computedAnchor = {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      }
    }
    setQuickTagPopoverState({ item: targetItem, anchorPosition: computedAnchor });
  }, [closeContextMenu]);

  const handleCardContextMenu = useCallback((item, index, event, scope = 'history') => {
    openContextMenu(item, index, event, scope);
  }, [openContextMenu]);

  const handleContextMenuAction = useCallback(async (actionKey) => {
    const currentItem = contextMenuState?.item;
    if (!currentItem) return;
    const contextCopySource = contextMenuState?.scope === 'collection' ? 'collection' : 'history';

    const toPlainText = (item) => {
      if (!item) return '';
      if (item.type_ === 'image') {
        return normalizeText(item.ocr_text || item.content);
      }
      return normalizeText(item.content);
    };

    try {
      if (contextMenuState?.isMulti) {
        switch (actionKey) {
          case 'copyMerged':
            await handleMergeCopySelected();
            closeContextMenu();
            return;
          case 'mergeToNote':
            await handleMergeToNote();
            closeContextMenu();
            return;
          case 'clearSelection':
            clearSelection();
            closeContextMenu();
            return;
          case 'deleteSelected':
            if (!armDeleteConfirm('deleteSelected')) {
              showQuickAddFeedback({
                type: 'warning',
                message: t('item.confirmDelete'),
              }, 1700);
              return;
            }
            await deleteSelectedItems();
            closeContextMenu();
            return;
          default:
            closeContextMenu();
            return;
        }
      }

      switch (actionKey) {
        case 'copy':
          await handleCopy(currentItem, contextCopySource);
          closeContextMenu();
          return;
        case 'copyPlainText': {
          const plainText = toPlainText(currentItem);
          if (plainText) {
            await handleCopyPlainText(plainText, contextCopySource);
          } else {
            await handleCopy(currentItem, contextCopySource);
          }
          closeContextMenu();
          return;
        }
        case 'quickPaste':
          await handleCopyAndAutoPaste(currentItem, contextCopySource);
          closeContextMenu();
          return;
        case 'multiSelect': {
          const nextSelected = selectedItemIds.includes(currentItem.id)
            ? selectedItemIds
            : [...selectedItemIds, currentItem.id];
          setSelectedItemIds(nextSelected);
          const contextIndex = contextMenuItems.findIndex(candidate => candidate.id === currentItem.id);
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
        case 'tag':
          handleOpenQuickTag(currentItem, { x: contextMenuState.x, y: contextMenuState.y });
          closeContextMenu();
          return;
        case 'editNote':
          openEditModal(currentItem, { initialFocus: 'note' });
          closeContextMenu();
          return;
        case 'editContent':
          openEditModal(currentItem, { initialFocus: 'content' });
          closeContextMenu();
          return;
        case 'preview':
          openItemPreview(setPanelMode, currentItem);
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
        case 'share':
          openShareModal(currentItem);
          closeContextMenu();
          return;
        case 'sendToEmail': {
          closeContextMenu();
          try {
            const recipients = await sendClipboardItemViaEmail({
              itemId: currentItem.id,
              recipients: [],
            });
            showQuickAddFeedback({
              type: 'success',
              message: t('item.sentToEmailToast', { email: recipients || '' }),
            }, 2500);
          } catch (err) {
            console.error('[HistoryContextMenu] sendToEmail failed:', err);
            showQuickAddFeedback({
              type: 'error',
              message: t('item.sendEmailFailed', { error: String(err) }),
            }, 3000);
          }
          return;
        }
        case 'delete':
          if (!armDeleteConfirm('delete')) {
            showQuickAddFeedback({
              type: 'warning',
              message: t('item.confirmDelete'),
            }, 1700);
            return;
          }
          await deleteItem(currentItem);
          closeContextMenu();
          return;
        default:
          closeContextMenu();
      }
    } catch (error) {
      console.error('[HistoryContextMenu] action failed:', actionKey, error);
      closeContextMenu();
    }
  }, [
    contextMenuState,
    contextMenuItems,
    selectedItemIds,
    copySelectedItemsMerged,
    clearSelection,
    setSelectedItemIds,
    setFocusedIndex,
    armDeleteConfirm,
    deleteSelectedItems,
    handleCopy,
    handleCopyPlainText,
    handleCopyAndAutoPaste,
    toggleFavorite,
    setCollectionHintsDismissed,
    showQuickAddFeedback,
    openEditModal,
    t,
    handleOpenItem,
    handleRevealInFolder,
    deleteItem,
    closeContextMenu,
  ]);

  const searchTerms = useMemo(() => tokenizeSearchQuery(debouncedSearchQuery), [debouncedSearchQuery]);

  const dayBoundaries = useMemo(() => buildDayBoundaries(timeTick), [timeTick]);
  const historyGrouping = useMemo(() => {
    const firstIndexByGroup = {};

    filteredItems.forEach((item, index) => {
      const timestamp = Number(item.updated_at || item.created_at || 0);
      const groupKey = getHistoryGroupKey(timestamp, dayBoundaries);
      if (firstIndexByGroup[groupKey] == null) {
        firstIndexByGroup[groupKey] = index;
      }
    });

    return {
      firstIndexByGroup,
    };
  }, [filteredItems, dayBoundaries]);

  const { emptyDiagnostic, handleResetAllFilters } = useHistoryEmptyDiagnostic({
    searchTermsLength: searchTerms.length,
    backendSearchResults,
    itemsLength: items.length,
    selectedType,
    selectedTags,
    showFavoritesOnly,
    selectedDateRange,
    t,
    setSearchQuery,
    setSelectedType,
    setSelectedTags,
    setShowFavoritesOnly,
    setShowTagFilter,
    setTagSearchQuery,
    clearDateFilter,
    clearActiveFilterView,
  });

  const addFromSearchQuery = useMemo(
    () => debouncedSearchQuery.trim(),
    [debouncedSearchQuery],
  );

  const canAddFromSearch = emptyDiagnostic.mode === 'search-empty'
    && addFromSearchQuery.length > 0
    && searchQuery.trim() === addFromSearchQuery;

  const focusAddFromSearchButton = useCallback(() => {
    if (!canAddFromSearch) return false;
    addFromSearchButtonRef.current?.focus();
    return Boolean(addFromSearchButtonRef.current);
  }, [canAddFromSearch]);

  const addSearchQueryToFavorites = useCallback(async () => {
    const content = addFromSearchQuery.trim();
    if (!content || quickAddPendingRef.current) return;

    quickAddPendingRef.current = true;
    setQuickAddPending(true);
    setQuickAddMode('favorite');
    clearQuickAddFeedbackTimer();
    try {
      const itemId = await invoke('add_clipboard_item_manual', {
        content,
        contentType: 'text',
        source: QUICK_INPUT_SOURCE,
        autoFavorite: true,
      });

      if (!itemId) {
        throw new Error('new item missing id');
      }

      await loadItems();

      setSearchQuery('');
      setFocusedIndex(-1);

      showQuickAddFeedback({
        type: 'success',
        message: t('search.empty.addedToFavorites', { defaultValue: t('search.empty.addedToWorkbench') }),
        detail: '',
        itemId,
        undoable: true,
      }, 5000);

      requestAnimationFrame(() => {
        focusSearchInput();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      showQuickAddFeedback({
        type: 'error',
        message: t('quickInput.failed', { error: message || t('item.unknown') }),
        detail: '',
        itemId: null,
        undoable: false,
      }, 2600);
    } finally {
      quickAddPendingRef.current = false;
      setQuickAddPending(false);
      setQuickAddMode(null);
    }
  }, [
    addFromSearchQuery,
    clearQuickAddFeedbackTimer,
    focusSearchInput,
    loadItems,
    setFocusedIndex,
    setQuickAddMode,
    setSearchQuery,
    showQuickAddFeedback,
    t,
  ]);

  const addSearchQueryToHistory = useCallback(async () => {
    const content = addFromSearchQuery.trim();
    if (!content || quickAddPendingRef.current) return;

    quickAddPendingRef.current = true;
    setQuickAddPending(true);
    setQuickAddMode('history');
    clearQuickAddFeedbackTimer();
    try {
      const itemId = await invoke('add_clipboard_item_manual', {
        content,
        contentType: 'text',
        source: QUICK_INPUT_SOURCE,
        autoFavorite: false,
      });

      if (!itemId) {
        throw new Error('new item missing id');
      }

      await loadItems();

      setSearchQuery('');
      setFocusedIndex(-1);

      showQuickAddFeedback({
        type: 'success',
        message: t('search.empty.addedToHistory'),
        detail: '',
        itemId,
        undoable: true,
      }, 5000);

      requestAnimationFrame(() => {
        focusSearchInput();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      showQuickAddFeedback({
        type: 'error',
        message: t('quickInput.failed', { error: message || t('item.unknown') }),
        detail: '',
        itemId: null,
        undoable: false,
      }, 2600);
    } finally {
      quickAddPendingRef.current = false;
      setQuickAddPending(false);
      setQuickAddMode(null);
    }
  }, [
    addFromSearchQuery,
    clearQuickAddFeedbackTimer,
    focusSearchInput,
    loadItems,
    setFocusedIndex,
    setQuickAddMode,
    setSearchQuery,
    showQuickAddFeedback,
    t,
  ]);

  const quickAddUndoItemId = quickAddFeedback?.itemId || null;

  const handleUndoAddFromSearch = useCallback(async () => {
    const itemId = quickAddUndoItemId;
    if (!itemId || quickAddUndoPendingRef.current) return;

    quickAddUndoPendingRef.current = true;
    setQuickAddUndoPending(true);
    clearQuickAddFeedbackTimer();
    try {
      await invoke('delete_item', { id: itemId });
      await loadItems();
      showQuickAddFeedback({
        type: 'info',
        message: t('search.empty.undoAddSuccess'),
        detail: '',
        itemId: null,
        undoable: false,
      }, 1800);
      requestAnimationFrame(() => {
        focusSearchInput();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      showQuickAddFeedback({
        type: 'error',
        message: t('search.empty.undoAddFailed', { error: message || t('item.unknown') }),
        detail: '',
        itemId: null,
        undoable: false,
      }, 2600);
    } finally {
      quickAddUndoPendingRef.current = false;
      setQuickAddUndoPending(false);
    }
  }, [
    clearQuickAddFeedbackTimer,
    focusSearchInput,
    loadItems,
    quickAddUndoItemId,
    showQuickAddFeedback,
    t,
  ]);

  const handleAddFromSearchActionKeyDown = useCallback((event) => {
    const actionButtons = [
      addFromSearchButtonRef.current,
      addToHistoryFromSearchButtonRef.current,
    ].filter(button => button && !button.disabled);
    const currentIndex = actionButtons.findIndex(button => button === event.currentTarget);

    if (event.key === 'ArrowUp') {
      if (currentIndex > 0) {
        event.preventDefault();
        event.stopPropagation();
        actionButtons[currentIndex - 1]?.focus();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      focusSearchInput();
      return;
    }

    if (event.key === 'ArrowDown') {
      if (currentIndex > -1 && currentIndex < actionButtons.length - 1) {
        event.preventDefault();
        event.stopPropagation();
        actionButtons[currentIndex + 1]?.focus();
      }
      return;
    }

    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      && actionButtons.length > 1
    ) {
      if (currentIndex === -1) return;

      const nextIndex = event.key === 'ArrowRight'
        ? (currentIndex + 1) % actionButtons.length
        : (currentIndex - 1 + actionButtons.length) % actionButtons.length;

      event.preventDefault();
      event.stopPropagation();
      actionButtons[nextIndex]?.focus();
    }
  }, [focusSearchInput]);

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
    openBatchTagEditor,
    closeBatchTagEditor,
    applyBatchTag,
    handleBatchFavoriteToggle,
    handleBatchAiAction,
    handleBatchTagInputKeyDown,
    handleBatchTagInputChange,
  } = useHistoryBatchActions({
    itemsById,
    itemsRevision,
    filteredItems,
    selectedItemIds,
    aiEnabled,
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
      probe.totalItems >= 100 ||
      probe.elapsedMs >= 8;

    if (!shouldLog) return;

    lastFilterProbeLogAtRef.current = now;
    console.log(`${MEMORY_PROBE_PREFIX} filter`, probe);
  }, [filteredItems, debouncedSearchQuery, selectedTags, selectedType, showFavoritesOnly, selectedDateRange, items.length]);

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
    selectedDateRange,
  ]);

  const {
    handleCardClick,
    handleCardDoubleClick,
    handleStartExternalDrag,
    handleStreamClick,
  } = useHistoryRowInteractions({
    filteredItems,
    selectedItemIds,
    panelMode,
    previewItemId,
    focusedIndex,
    selectionAnchorIndexRef,
    supportsNativeExternalDrag: SUPPORTS_NATIVE_EXTERNAL_DRAG,
    setSelectedItemIds,
    setFocusedIndex,
    setPanelMode,
    toggleSelectItem,
    clearSelection,
    handleCopyAndAutoPaste,
    handleCopy,
    switchToWorkbench,
  });

  const { handleSearchInputKeyDown } = useHistoryKeyboardNavigation({
    filteredItems,
    bulkSelectableItems: contextMenuItems,
    focusedIndex,
    setFocusedIndex,
    isMiniMode,
    setPanelMode,
    handleCopy,
    handleCopyAndAutoPaste,
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
    onSearchArrowDownNoResults: focusAddFromSearchButton,
    onQuickTag: handleOpenQuickTag,
  });

  const rowGap = isMiniMode ? 2 : 4;

  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const handleRangeChanged = useCallback((range) => {
    const nextStart = Number(range?.startIndex);
    if (!Number.isFinite(nextStart)) return;
    setVisibleRangeStartIndex(nextStart);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    virtuosoRef.current?.scrollToIndex?.({
      index: 0,
      align: 'start',
      behavior: 'smooth',
    });
    setFocusedIndex(0);
  }, [setFocusedIndex]);

  const selectedCount = selectedItemIds.length;
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const showJumpToLatest = filteredItems.length > 0 && visibleRangeStartIndex > 6 && selectedCount === 0;
  const shouldShowLoadGuard = !isCollectionMode
    && !loading
    && !loadingMore
    && historyLoadStopReason === 'memory-cap'
    && filteredItems.length > 0
    && activeTopSearchQuery.trim().length === 0;
  const computeItemKey = useCallback((index) => filteredItems[index]?.id ?? index, [filteredItems]);

  const HistoryListFooter = useCallback(() => {
    if (!shouldShowLoadGuard) return null;
    return (
      <div className="history-load-guard state-panel" role="status" aria-live="polite">
        <div className="history-load-guard-message">{t('search.loadGuard.message')}</div>
        <button
          type="button"
          className="history-load-guard-action"
          onClick={focusSearchInput}
        >
          {t('search.loadGuard.action')}
        </button>
      </div>
    );
  }, [focusSearchInput, shouldShowLoadGuard, t]);

  const virtuosoComponents = useMemo(() => ({
    Scroller: VirtuosoScroller,
    Footer: HistoryListFooter,
  }), [HistoryListFooter]);

  const buildRowViewModel = useCallback((index) => {
    const item = filteredItems[index];
    if (!item) return null;
    return {
      item,
      index,
      searchExplain: buildSearchExplain(item, searchTerms, t),
      isSelected: panelMode === 'preview' && previewItem?.id === item.id,
      isSelectionMode: selectedCount > 0,
      isMultiSelected: selectedItemIdSet.has(item.id),
      isFocused: focusedIndex === index,
    };
  }, [
    filteredItems,
    searchTerms,
    t,
    panelMode,
    previewItem?.id,
    selectedCount,
    selectedItemIdSet,
    focusedIndex,
  ]);

  const handleToggleMultiSelect = useCallback((item, index) => {
    if (!item?.id) return;
    toggleSelectItem(item.id);
    if (typeof index === 'number' && Number.isFinite(index)) {
      setFocusedIndex(index);
      selectionAnchorIndexRef.current = index;
    }
  }, [toggleSelectItem, setFocusedIndex]);

  const rowCommonProps = useMemo(() => ({
    rowGap,
    copiedItemId,
    copyFeedbackSource,
    timeTick,
    supportsNativeExternalDrag: SUPPORTS_NATIVE_EXTERNAL_DRAG,
    onStartExternalDrag: handleStartExternalDrag,
    onToggleFavorite: toggleFavorite,
    onOpenItem: handleOpenItem,
    onRevealInFolder: handleRevealInFolder,
    onSetCardBackground: setCardBackground,
    onTagClick: handleTagClick,
    onToggleMultiSelect: handleToggleMultiSelect,
    onCardContextMenu: handleCardContextMenu,
  }), [
    rowGap,
    copiedItemId,
    copyFeedbackSource,
    timeTick,
    handleStartExternalDrag,
    toggleFavorite,
    handleOpenItem,
    handleRevealInFolder,
    setCardBackground,
    handleTagClick,
    handleToggleMultiSelect,
    handleCardContextMenu,
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

  const handleClearSelectedTags = useCallback(() => {
    setSelectedTags([]);
  }, [setSelectedTags]);

  const handleToggleTagFilterVisible = useCallback(() => {
    setShowTagFilter(!showTagFilter);
  }, [setShowTagFilter, showTagFilter]);

  const handleOpenSettingsPanel = useCallback(() => {
    setShowSettings(true);
  }, [setShowSettings]);

  const handleOpenCleanupSettings = useCallback((event) => {
    event.stopPropagation();
    setShowSettings(true, 'dataSecurity');
  }, [setShowSettings]);

  const handleOpenCollectionPreview = useCallback((item) => {
    if (!item) return;
    const returnViewMode = workbenchPanelEnabled ? 'all' : 'left';
    openItemPreview(setPanelMode, item, { returnViewMode });
  }, [setPanelMode, workbenchPanelEnabled]);

  const searchBarProps = useMemo(() => ({
    searchQuery: activeTopSearchQuery,
    onSearchChange: isCollectionMode ? setCollectionSearchQuery : setSearchQuery,
    recentSearches: activeTopRecentSearches,
    onApplyRecentSearch: (query) => {
      if (isCollectionMode) {
        setCollectionSearchQuery(query);
        addCollectionRecentSearch(query);
        return;
      }
      setSearchQuery(query);
      addHistoryRecentSearch(query);
    },
    onClearRecentSearches: isCollectionMode ? clearCollectionRecentSearches : clearHistoryRecentSearches,
    onRemoveRecentSearch: isCollectionMode ? removeCollectionRecentSearch : removeHistoryRecentSearch,
    selectedType,
    onTypeChange: setSelectedType,
    showFavoritesOnly,
    onToggleFavorites: handleToggleFavoritesOnly,
    isMiniMode,
    selectedTags: showFavoritesOnly ? [] : selectedTags,
    onClearTags: handleClearSelectedTags,
    showTagFilter,
    onToggleTagFilter: handleToggleTagFilterVisible,
    allTags: showFavoritesOnly ? [] : allTags,
    filteredTagsList: showFavoritesOnly ? [] : filteredTagsList,
    tagSearchQuery,
    onTagSearchChange: setTagSearchQuery,
    onToggleTag: toggleTagFilter,
    onOpenSettings: handleOpenSettingsPanel,
    onSearchKeyDown: handleSearchInputKeyDown,
    resultCount: filteredItems.length,
    filterBusy: isSearching,
    filterError: backendSearchError,
  }), [
    activeTopSearchQuery,
    setSearchQuery,
    setCollectionSearchQuery,
    activeTopRecentSearches,
    addHistoryRecentSearch,
    addCollectionRecentSearch,
    clearHistoryRecentSearches,
    clearCollectionRecentSearches,
    removeHistoryRecentSearch,
    removeCollectionRecentSearch,
    isCollectionMode,
    selectedType,
    setSelectedType,
    showFavoritesOnly,
    handleToggleFavoritesOnly,
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
    handleSearchInputKeyDown,
    filteredItems.length,
    isSearching,
    backendSearchError,
  ]);

  const isCalmPresetActive = startupFavoritesViewEnabled
    && autoCleanupEnabled
    && Number(cleanupMaxAgeDays) === 7
    && Number(cleanupMaxItems) === 1000;
  const shouldShowBottomHelper = showFavoritesOnly || isCalmPresetActive;
  const autoCleanupItemsLabel = useMemo(() => {
    const value = Number(cleanupMaxItems || 0);
    if (!Number.isFinite(value)) return `${cleanupMaxItems || 0}`;
    return value.toLocaleString(i18n.language || undefined);
  }, [cleanupMaxItems, i18n.language]);
  const autoCleanupSummary = useMemo(() => (
    isCalmPresetActive
      ? t('history.autoCleanupNoticeEnabled', {
        days: cleanupMaxAgeDays,
        items: autoCleanupItemsLabel,
      })
      : t('history.autoCleanupNoticeDisabled')
  ), [isCalmPresetActive, cleanupMaxAgeDays, autoCleanupItemsLabel, t]);
  const shouldRenderCollectionBoard = isCollectionMode;

  const handleToggleBatchTagEditor = useCallback(() => {
    if (showBatchTagEditor) {
      closeBatchTagEditor();
      return;
    }
    openBatchTagEditor();
  }, [showBatchTagEditor, closeBatchTagEditor, openBatchTagEditor]);

  const handleMergeCopySelected = useCallback(async () => {
    const result = await copySelectedItemsMerged(filteredItems);
    if (result?.ok && result.count > 0) {
      showQuickAddFeedback({
        type: 'success',
        message: t('multiSelect.mergeCopyFeedback', { count: result.count }),
      }, 2000);
    }
  }, [copySelectedItemsMerged, filteredItems, showQuickAddFeedback, t]);

  const handleMergeToNote = useCallback(async () => {
    const result = await mergeSelectedItemsToNote(filteredItems);
    if (result?.ok && result.count > 0) {
      showQuickAddFeedback({
        type: 'success',
        message: t('multiSelect.mergeToNoteFeedback', { count: result.count }),
      }, 2200);
    }
  }, [mergeSelectedItemsToNote, filteredItems, showQuickAddFeedback, t]);

  const selectedItemsForCompare = useMemo(() => {
    if (selectedItemIds.length < 2) return [];
    const selectedIdSet = new Set(selectedItemIds);
    const visiblePool = isCollectionMode
      ? (collectionVisibleItems.length > 0 ? collectionVisibleItems : filteredItems)
      : filteredItems;
    const orderedByVisible = visiblePool.filter(item => selectedIdSet.has(item.id));
    if (orderedByVisible.length >= 2) return orderedByVisible;

    const fallbackById = itemsById instanceof Map ? itemsById : null;
    return selectedItemIds
      .map(id => fallbackById?.get(id))
      .filter(Boolean);
  }, [selectedItemIds, isCollectionMode, collectionVisibleItems, filteredItems, itemsById]);

  const selectedCompareCandidateIds = useMemo(
    () => selectedItemsForCompare.map(item => item.id),
    [selectedItemsForCompare],
  );

  const handleCompareSelected = useCallback(() => {
    if (selectedItemsForCompare.length < 2) return;
    const targetItems = selectedItemsForCompare;
    if (!workbenchPanelEnabled) {
      setWorkbenchPanelEnabled(true);
      showCompareFeedback('success', t('panel.comparePanelAutoOpened'));
    }
    setPanelMode('compare', targetItems);
  }, [
    selectedItemsForCompare,
    workbenchPanelEnabled,
    setWorkbenchPanelEnabled,
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
    if (!workbenchPanelEnabled) {
      setWorkbenchPanelEnabled(true);
      showCompareFeedback('success', t('panel.comparePanelAutoOpened'));
    }
    setPanelMode('compare', targetItems.slice(0, 2));
  }, [
    workbenchPanelEnabled,
    setWorkbenchPanelEnabled,
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
      const pool = isCollectionMode
        ? (collectionVisibleItems.length > 0 ? collectionVisibleItems : filteredItems)
        : filteredItems;
      if (pool.length < 2) return;
      event.preventDefault();
      handleQuickCompareTopVisible(pool.slice(0, 2));
    };

    window.addEventListener('keydown', handleQuickCompareShortcut);
    return () => window.removeEventListener('keydown', handleQuickCompareShortcut);
  }, [selectedItemIds.length, isCollectionMode, collectionVisibleItems, filteredItems, handleQuickCompareTopVisible]);

  const multiSelectBarProps = useMemo(() => ({
    selectedCount,
    showBatchTagEditor,
    onToggleBatchTagEditor: handleToggleBatchTagEditor,
    onBatchFavoriteToggle: handleBatchFavoriteToggle,
    allSelectedAreFavorite,
    onMergeCopy: handleMergeCopySelected,
    onMergeToNote: handleMergeToNote,
    canCompareSelected: selectedItemsForCompare.length >= 2,
    onCompareSelected: handleCompareSelected,
    canRunBatchAi,
    onBatchAiAction: handleBatchAiAction,
    batchFlagPending,
    batchAiRunningTask,
    onDeleteSelected: deleteSelectedItems,
    onClearSelection: clearSelection,
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
    handleMergeCopySelected,
    selectedItemsForCompare.length,
    handleCompareSelected,
    canRunBatchAi,
    handleBatchAiAction,
    batchFlagPending,
    batchAiRunningTask,
    deleteSelectedItems,
    clearSelection,
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

  const handleHistoryStreamClick = useCallback(() => {
    if (contextMenuState) {
      closeContextMenu();
      return;
    }
    handleStreamClick();
  }, [contextMenuState, closeContextMenu, handleStreamClick]);

  const handleRetryHistorySearch = useCallback(() => {
    setBackendSearchError('');
    setBackendSearchRefreshNonce((current) => current + 1);
  }, []);

  return (
    <div
      ref={historyRootRef}
      className="history-stream"
      style={style}
      onClick={handleHistoryStreamClick}
    >
      <SearchBar {...searchBarProps} />

      <div className="history-stream-content">
        {loading ? (
          <div className="loading-state state-panel state-panel--loading panel-state-stack">
            <div className="loading-spinner"></div>
            <div className="loading-text state-panel__text panel-state-text">{t('app.loading')}</div>
          </div>
        ) : isSearching && !shouldRenderCollectionBoard ? (
          <div className="loading-state state-panel state-panel--loading panel-state-stack">
            <div className="loading-spinner"></div>
            <div className="loading-text state-panel__text panel-state-text">{t('search.searching')}</div>
          </div>
        ) : shouldRenderCollectionBoard ? (
          <CollectionBoard
            searchQuery={collectionSearchQuery}
            selectedType={selectedType}
            selectedDateRange={selectedDateRange}
            itemsRevision={itemsRevision}
            isMiniMode={isMiniMode}
            timeTick={timeTick}
            selectedItemIds={selectedItemIds}
            onToggleFavorite={toggleFavorite}
            onSetCardBackground={setCardBackground}
            onOpenPreview={handleOpenCollectionPreview}
            onOpenContextMenu={handleCardContextMenu}
            onVisibleItemsChange={setCollectionVisibleItems}
            onAddTagToItem={addTagToItem}
            onCopy={handleCopy}
            onCopyAndAutoPaste={handleCopyAndAutoPaste}
            onSetSelectedItemIds={setSelectedItemIds}
            onToggleSelectItem={toggleSelectItem}
          />
        ) : backendSearchError && filteredItems.length === 0 ? (
          <div className="empty empty-diagnostic error" role="status" aria-live="polite">
            <div className="empty-content state-panel state-panel--error panel-state-stack panel-state-stack--narrow">
              <div className="empty-title state-panel__title panel-state-title">{t('search.queryFailed')}</div>
              <div className="empty-detail state-panel__hint panel-state-text">{backendSearchError}</div>
              <button
                type="button"
                className="history-retry-btn state-retry-btn panel-state-action-btn"
                onClick={handleRetryHistorySearch}
              >
                {t('search.retryLoad')}
              </button>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty empty-diagnostic" role="status" aria-live="polite">
            <div className="empty-content state-panel panel-state-stack panel-state-stack--narrow">
              <div className="empty-title state-panel__title panel-state-title">{emptyDiagnostic.title}</div>
              {emptyDiagnostic.description && (
                <div className="empty-detail state-panel__hint panel-state-text">{emptyDiagnostic.description}</div>
              )}
              {canAddFromSearch && (
                <div className="empty-actions-row panel-state-actions">
                  <button
                    ref={addFromSearchButtonRef}
                    type="button"
                    className="empty-action-btn panel-state-action-btn"
                    onClick={addSearchQueryToFavorites}
                    onKeyDown={handleAddFromSearchActionKeyDown}
                    disabled={quickAddPending}
                    aria-label={t('search.empty.addFromSearch', { query: addFromSearchQuery })}
                  >
                    {quickAddPending && quickAddMode === 'favorite'
                      ? t('search.empty.addFromSearchPending')
                      : t('search.empty.addFromSearch', { query: addFromSearchQuery })}
                  </button>
                  <button
                    ref={addToHistoryFromSearchButtonRef}
                    type="button"
                    className="empty-action-btn ghost panel-state-action-btn panel-state-action-btn--ghost"
                    onClick={addSearchQueryToHistory}
                    onKeyDown={handleAddFromSearchActionKeyDown}
                    disabled={quickAddPending}
                    aria-label={t('search.empty.addToHistoryFromSearch')}
                  >
                    {quickAddPending && quickAddMode === 'history'
                      ? t('search.empty.addToHistoryFromSearchPending')
                      : t('search.empty.addToHistoryFromSearch')}
                  </button>
                </div>
              )}
              {emptyDiagnostic.mode === 'first-use' && (
                <div className="empty-actions-row panel-state-actions">
                  <button
                    type="button"
                    className="empty-action-btn panel-state-action-btn"
                    onClick={() => openEditModal()}
                    aria-label={t('search.empty.startQuickCapture')}
                  >
                    {t('search.empty.startQuickCapture')}
                  </button>
                  <button
                    type="button"
                    className="empty-action-btn ghost panel-state-action-btn panel-state-action-btn--ghost"
                    onClick={() => startTour()}
                    aria-label={t('search.empty.replayGuide')}
                  >
                    {t('search.empty.replayGuide')}
                  </button>
                </div>
              )}
              {emptyDiagnostic.canReset && emptyDiagnostic.mode !== 'first-use' && (
                <button type="button" className="empty-action-btn panel-state-action-btn" onClick={handleResetAllFilters}>
                  {t('search.empty.clearAllFilters')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="history-stream-virtuoso"
            components={virtuosoComponents}
            totalCount={filteredItems.length}
            initialItemCount={Math.min(filteredItems.length, 12)}
            computeItemKey={computeItemKey}
            itemContent={renderVirtualRow}
            endReached={handleEndReached}
            rangeChanged={handleRangeChanged}
            increaseViewportBy={VIRTUOSO_INCREASE_VIEWPORT}
          />
        )}
        {!shouldRenderCollectionBoard && showJumpToLatest && (
          <button
            type="button"
            className="history-jump-top-btn"
            onClick={handleJumpToLatest}
            title={t('history.backToTop')}
            aria-label={t('history.backToTop')}
          >
            <ArrowUp size={14} />
          </button>
        )}
        {quickAddFeedback && (
          <div className="history-inline-feedback" role="status" aria-live="polite">
            <div className={`history-inline-feedback-card ${quickAddFeedback.type || 'info'}`}>
              <div className="history-inline-feedback-text">
                <div className="history-inline-feedback-message">{quickAddFeedback.message}</div>
                {quickAddFeedback.detail && (
                  <div className="history-inline-feedback-detail">{quickAddFeedback.detail}</div>
                )}
              </div>
              {quickAddFeedback.undoable && (
                <button
                  type="button"
                  className="history-inline-feedback-undo"
                  onClick={handleUndoAddFromSearch}
                  disabled={quickAddUndoPending}
                >
                  {quickAddUndoPending ? t('app.loading') : (t('app.undo', { defaultValue: t('workbench.undo') }))}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <HistoryContextMenu
        state={contextMenuState}
        menuRef={contextMenuRef}
        t={t}
        enableQuickPaste={autoPasteOnDoubleClick}
        emailRelayEnabled={emailRelayEnabled}
        onAction={handleContextMenuAction}
      />

      {quickTagPopoverState && (
        <QuickTagPopover
          item={quickTagPopoverState.item}
          anchorPosition={quickTagPopoverState.anchorPosition}
          availableUserTags={pureUserTags}
          isMiniMode={isMiniMode}
          onClose={() => setQuickTagPopoverState(null)}
          onAddTag={addTagToItem}
          onRemoveTag={removeTagFromItem}
        />
      )}

      {shouldShowBottomHelper && (
        <div className={`history-stream-helper-text ${isCalmPresetActive ? 'history-stream-helper-text-action' : ''} ${showFavoritesOnly && !isCalmPresetActive ? 'history-stream-helper-text--collection-only' : ''}`.trim()}>
          <div className="history-stream-helper-main">
            {showFavoritesOnly && (
              <div className="history-stream-helper-line history-stream-helper-line--collection">
                {t('collection.longTermStorageHint')}
              </div>
            )}
            {isCalmPresetActive && (
              <div className="history-stream-helper-line">{autoCleanupSummary}</div>
            )}
          </div>
          {isCalmPresetActive && (
            <button
              type="button"
              className="history-stream-helper-link"
              onClick={handleOpenCleanupSettings}
            >
              {t('history.autoCleanupAdjust')}
            </button>
          )}
        </div>
      )}

      {selectedCount > 0 && panelMode !== 'compare' && (
        <MultiSelectBar {...multiSelectBarProps} />
      )}
    </div>
  );
}

export default HistoryStream;
