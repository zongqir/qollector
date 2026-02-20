import { useRef, useEffect, useMemo, useCallback, useState, forwardRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import useAppStore from '../../store/useAppStore';
import SearchBar from '../SearchBar';
import CompactCard from './CompactCard';
import MultiSelectBar from './MultiSelectBar';
import { getTags, getSourceApp } from '../../utils/tagHelpers';
import { getDateRangeForPreset, dateStringToTimestamp, dateStringToEndTimestamp } from '../../utils/dateHelpers';
import { searchItems } from '../../services/clipboardService';
import { runPromptAssistantTask } from '../../features/ai-assistant/services/promptAssistantService';
import { getActionExecutionPreset } from '../../features/ai-assistant/constants/actionProfiles';
import { resolveOutputLanguageFromUi } from '../../features/ai-assistant/utils/language';

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

function getExternalFilePaths(item) {
  if (item.type_ === 'file' && item.content) {
    return item.content
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  if (item.type_ === 'image' && item.image_paths) {
    try {
      const paths = JSON.parse(item.image_paths);
      const original = paths.original || paths.raw;
      return original ? [original] : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getDragText(item, externalPaths) {
  if (item.type_ === 'text') return item.content || '';
  if (item.type_ === 'file') return item.content || externalPaths.join('\n');
  if (item.type_ === 'image') return item.ocr_text || externalPaths[0] || item.content || '';
  return item.content || '';
}

function HistoryStream({ style }) {
  const { t, i18n } = useTranslation();
  const clickTimerRef = useRef(null);
  const selectionAnchorIndexRef = useRef(-1);
  const filterProbeRef = useRef(null);
  const lastFilterProbeLogAtRef = useRef(0);
  const hasTopTrackerInitRef = useRef(false);
  const prevTopItemIdRef = useRef(null);
  const batchTagEditorRef = useRef(null);
  const batchTagSuggestionsRef = useRef(null);

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
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);

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
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const toggleTagFilter = useAppStore(s => s.toggleTagFilter);
  const setSelectedDateRange = useAppStore(s => s.setSelectedDateRange);
  const setShowDateFilter = useAppStore(s => s.setShowDateFilter);
  const setCustomDateStart = useAppStore(s => s.setCustomDateStart);
  const setCustomDateEnd = useAppStore(s => s.setCustomDateEnd);
  const clearDateFilter = useAppStore(s => s.clearDateFilter);
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
  const toggleSelectItem = useAppStore(s => s.toggleSelectItem);
  const setSelectedItemIds = useAppStore(s => s.setSelectedItemIds);
  const clearSelection = useAppStore(s => s.clearSelection);
  const addTagToSelectedItems = useAppStore(s => s.addTagToSelectedItems);
  const deleteSelectedItems = useAppStore(s => s.deleteSelectedItems);
  const copySelectedItemsMerged = useAppStore(s => s.copySelectedItemsMerged);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);
  const toggleCollectionPanel = useAppStore(s => s.toggleCollectionPanel);
  const setHoverPreview = useAppStore(s => s.setHoverPreview);
  const clearHoverPreview = useAppStore(s => s.clearHoverPreview);
  const hoverPreviewItem = useAppStore(s => s.hoverPreviewItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);
  const focusedIndex = useAppStore(s => s.focusedIndex);
  const setFocusedIndex = useAppStore(s => s.setFocusedIndex);
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
  const [showBatchTagEditor, setShowBatchTagEditor] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagPending, setBatchTagPending] = useState(false);
  const [batchTagFeedback, setBatchTagFeedback] = useState(null);
  const [batchTagActiveSuggestionIndex, setBatchTagActiveSuggestionIndex] = useState(-1);
  const [batchAiRunningTask, setBatchAiRunningTask] = useState(null);
  const [batchAiFeedback, setBatchAiFeedback] = useState(null);
  const [batchFlagPending, setBatchFlagPending] = useState(false);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTimeTick(Date.now());
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

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
  }, [debouncedSearchQuery]);

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

      const sourceApp = getSourceApp(item.metadata);
      if (sourceApp && sourceApp !== 'Unknown') sourceTags.add(`来源:${sourceApp}`);

      if (item.type_) {
        const typeMap = { text: '类型:文本', image: '类型:图片', file: '类型:文件', link: '类型:链接' };
        if (typeMap[item.type_]) typeTags.add(typeMap[item.type_]);
      }
    });

    return [
      ...Array.from(typeTags).sort(),
      ...Array.from(userTags).sort(),
      ...Array.from(sourceTags).sort(),
      ...Array.from(aiTags).sort(),
    ];
  }, [items]);

  const rankedUserTags = useMemo(() => {
    const statsByTag = new Map();
    items.forEach((item) => {
      const rankTimestamp = Math.max(item.updated_at || 0, item.created_at || 0);
      const uniqueUserTags = new Set(
        getTags(item.tags).filter(tag => !tag.startsWith('AI:')),
      );
      uniqueUserTags.forEach((tag) => {
        const existing = statsByTag.get(tag);
        if (existing) {
          existing.count += 1;
          if (rankTimestamp > existing.lastUsedAt) existing.lastUsedAt = rankTimestamp;
          return;
        }
        statsByTag.set(tag, { tag, count: 1, lastUsedAt: rankTimestamp });
      });
    });
    return Array.from(statsByTag.values())
      .sort((a, b) => (
        b.count - a.count
        || b.lastUsedAt - a.lastUsedAt
        || a.tag.localeCompare(b.tag)
      ))
      .map(stat => stat.tag);
  }, [items]);

  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

  const filteredBatchTagSuggestions = useMemo(() => {
    const normalizedInput = batchTagInput.trim().toLowerCase();
    if (!normalizedInput) return rankedUserTags.slice(0, 8);

    const prefixMatches = [];
    const partialMatches = [];
    rankedUserTags.forEach((tag) => {
      const normalizedTag = tag.toLowerCase();
      if (!normalizedTag.includes(normalizedInput) || normalizedTag === normalizedInput) return;
      if (normalizedTag.startsWith(normalizedInput)) {
        prefixMatches.push(tag);
      } else {
        partialMatches.push(tag);
      }
    });
    return [...prefixMatches, ...partialMatches].slice(0, 8);
  }, [rankedUserTags, batchTagInput]);

  const activeBatchTagSuggestion =
    batchTagActiveSuggestionIndex >= 0
      ? filteredBatchTagSuggestions[batchTagActiveSuggestionIndex] || null
      : null;

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
        const sourceApp = getSourceApp(item.metadata);
        const sourceTag = sourceApp !== 'Unknown' ? `来源:${sourceApp}` : null;
        const typeMap = { text: '类型:文本', image: '类型:图片', file: '类型:文件', link: '类型:链接' };
        const typeTag = typeMap[item.type_];
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

    // Pin 筛选时�?pinned_at 降序排序
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
  }, [items, backendSearchResults, selectedTags, selectedType, debouncedSearchQuery, showFavoritesOnly, showPinnedOnly, selectedDateRange]);

  const selectedItemsForBatchActions = useMemo(() => {
    if (selectedItemIds.length === 0) return [];
    const selectedIdSet = new Set(selectedItemIds);
    const preferredOrdered = filteredItems.filter(item => selectedIdSet.has(item.id));
    if (preferredOrdered.length === selectedItemIds.length) {
      return preferredOrdered;
    }

    const fallbackById = new Map(items.map(item => [item.id, item]));
    const fallbackOrdered = selectedItemIds
      .map(id => fallbackById.get(id))
      .filter(Boolean);
    const preferredIdSet = new Set(preferredOrdered.map(item => item.id));
    return preferredOrdered.length > 0
      ? [...preferredOrdered, ...fallbackOrdered.filter(item => !preferredIdSet.has(item.id))]
      : fallbackOrdered;
  }, [selectedItemIds, filteredItems, items]);

  const allSelectedAreText = useMemo(
    () => selectedItemsForBatchActions.length > 0 && selectedItemsForBatchActions.every(item => item.type_ === 'text'),
    [selectedItemsForBatchActions],
  );

  const batchAiSourceText = useMemo(
    () => selectedItemsForBatchActions
      .map(item => item.content || '')
      .filter(Boolean)
      .join('\n\n'),
    [selectedItemsForBatchActions],
  );

  const canRunBatchAi = aiEnabled && allSelectedAreText && batchAiSourceText.trim().length > 0;
  const allSelectedAreFavorite = selectedItemsForBatchActions.length > 0
    && selectedItemsForBatchActions.every(item => item.is_favorite);
  const allSelectedArePinned = selectedItemsForBatchActions.length > 0
    && selectedItemsForBatchActions.every(item => item.is_pinned);

  const closeBatchTagEditor = useCallback(() => {
    if (batchTagPending) return;
    setShowBatchTagEditor(false);
    setBatchTagInput('');
    setBatchTagActiveSuggestionIndex(-1);
  }, [batchTagPending]);

  const openBatchTagEditor = useCallback(() => {
    if (batchTagPending) return;
    setBatchTagFeedback(null);
    setBatchTagInput('');
    setBatchTagActiveSuggestionIndex(-1);
    setShowBatchTagEditor(true);
  }, [batchTagPending]);

  const applyBatchTag = useCallback(async (tagValue = batchTagInput) => {
    const normalizedTag = tagValue.trim();
    if (!normalizedTag || batchTagPending) return;

    setBatchTagPending(true);
    setBatchTagFeedback(null);
    try {
      const result = await addTagToSelectedItems(normalizedTag, filteredItems);
      if (!result?.ok) {
        if (result?.reason === 'reserved-prefix') {
          setBatchTagFeedback({ type: 'error', text: t('multiSelect.addTagReservedPrefix') });
          return;
        }
        if (result?.reason === 'empty-tag') {
          setBatchTagFeedback({ type: 'error', text: t('multiSelect.addTagEmpty') });
          return;
        }
        setBatchTagFeedback({
          type: 'error',
          text: t('multiSelect.addTagFailed', { error: result?.error || 'Unknown error' }),
        });
        return;
      }

      if (Array.isArray(result.updates) && result.updates.length > 0) {
        const updatesById = new Map(result.updates.map(update => [update.id, update]));
        setBackendSearchResults((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return prev;
          return prev.map((item) => {
            const updated = updatesById.get(item.id);
            if (!updated) return item;
            return {
              ...item,
              tags: updated.tags,
              updated_at: updated.updated_at,
            };
          });
        });
      }

      if (result.failedCount > 0 && result.updatedCount === 0 && result.unchangedCount === 0) {
        setBatchTagFeedback({
          type: 'error',
          text: t('multiSelect.addTagFailed', {
            error: result.error || t('multiSelect.addTagAllFailed', { failed: result.failedCount }),
          }),
        });
      } else if (result.failedCount > 0) {
        setBatchTagFeedback({
          type: 'warning',
          text: t('multiSelect.addTagPartial', {
            updated: result.updatedCount,
            failed: result.failedCount,
          }),
        });
      } else if (result.updatedCount > 0) {
        setBatchTagFeedback({
          type: 'success',
          text: t('multiSelect.addTagSuccess', {
            count: result.updatedCount,
            tag: result.tag,
          }),
        });
      } else {
        setBatchTagFeedback({ type: 'warning', text: t('multiSelect.addTagNoChanges') });
      }
      setBatchTagInput('');
      setShowBatchTagEditor(false);
    } catch (error) {
      setBatchTagFeedback({
        type: 'error',
        text: t('multiSelect.addTagFailed', { error: String(error) }),
      });
    } finally {
      setBatchTagPending(false);
    }
  }, [addTagToSelectedItems, batchTagInput, batchTagPending, filteredItems, t]);

  const handleBatchFavoriteToggle = useCallback(async () => {
    if (batchFlagPending || selectedItemsForBatchActions.length === 0) return;
    const targetFavoriteState = !allSelectedAreFavorite;
    const targets = selectedItemsForBatchActions.filter(item => Boolean(item.is_favorite) !== targetFavoriteState);
    if (targets.length === 0) return;

    setBatchFlagPending(true);
    try {
      for (const item of targets) {
        await invoke('toggle_favorite_item', { id: item.id });
      }
      await loadItems();
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setBatchAiFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    } finally {
      setBatchFlagPending(false);
    }
  }, [allSelectedAreFavorite, batchFlagPending, selectedItemsForBatchActions, loadItems, t]);

  const handleBatchPinToggle = useCallback(async () => {
    if (batchFlagPending || selectedItemsForBatchActions.length === 0) return;
    const targetPinnedState = !allSelectedArePinned;
    const targets = selectedItemsForBatchActions.filter(item => Boolean(item.is_pinned) !== targetPinnedState);
    if (targets.length === 0) return;

    setBatchFlagPending(true);
    try {
      const maxPinned = targetPinnedState ? maxPinnedItems : 999;
      for (const item of targets) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned });
      }
      await loadItems();
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setBatchAiFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    } finally {
      setBatchFlagPending(false);
    }
  }, [allSelectedArePinned, batchFlagPending, selectedItemsForBatchActions, maxPinnedItems, loadItems, t]);

  const handleBatchAiAction = useCallback(async (taskType) => {
    if ((taskType !== 'summarize' && taskType !== 'rewrite') || !canRunBatchAi || batchAiRunningTask) {
      return;
    }

    setBatchAiRunningTask(taskType);
    setBatchAiFeedback(null);
    try {
      const executionPreset = getActionExecutionPreset(taskType, 'quick-output');
      const response = await runPromptAssistantTask({
        taskType,
        input: batchAiSourceText.trim(),
        uiLanguage: i18n.language,
        outputLanguage: resolveOutputLanguageFromUi(i18n.language),
        tone: executionPreset.tone,
        length: executionPreset.length,
        extraInstruction: executionPreset.extraInstruction,
      });

      const outputText = typeof response?.output === 'string' ? response.output.trim() : '';
      if (!outputText) {
        setBatchAiFeedback({ type: 'warning', text: t('multiSelect.batchAiEmpty') });
        return;
      }

      await invoke('copy_plain_text', { text: outputText });
      setBatchAiFeedback({
        type: 'success',
        text: taskType === 'rewrite'
          ? t('multiSelect.batchRewriteCopied')
          : t('multiSelect.batchSummarizeCopied'),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setBatchAiFeedback({
        type: 'error',
        text: t('multiSelect.batchAiFailed', { error: message }),
      });
    } finally {
      setBatchAiRunningTask(null);
    }
  }, [batchAiRunningTask, batchAiSourceText, canRunBatchAi, i18n.language, t]);

  const handleBatchTagInputKeyDown = useCallback((e) => {
    if (e.nativeEvent?.isComposing || e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (filteredBatchTagSuggestions.length === 0) return;
      e.preventDefault();
      setBatchTagActiveSuggestionIndex((current) => {
        if (e.key === 'ArrowDown') {
          if (current < 0) return 0;
          return Math.min(current + 1, filteredBatchTagSuggestions.length - 1);
        }
        if (current < 0) return filteredBatchTagSuggestions.length - 1;
        return Math.max(current - 1, 0);
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeBatchTagSuggestion) {
        applyBatchTag(activeBatchTagSuggestion);
        return;
      }
      if (!batchTagInput.trim()) return;
      applyBatchTag();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBatchTagEditor();
    }
  }, [
    activeBatchTagSuggestion,
    applyBatchTag,
    batchTagInput,
    closeBatchTagEditor,
    filteredBatchTagSuggestions.length,
  ]);

  // reset keyboard focus when list changes
  useEffect(() => {
    setFocusedIndex(-1);
    selectionAnchorIndexRef.current = -1;
  }, [filteredItems, setFocusedIndex]);

  useEffect(() => {
    if (selectedItemIds.length > 0) return;
    setShowBatchTagEditor(false);
    setBatchTagInput('');
    setBatchTagActiveSuggestionIndex(-1);
    setBatchAiFeedback(null);
    selectionAnchorIndexRef.current = -1;
  }, [selectedItemIds.length]);

  useEffect(() => {
    if (!showBatchTagEditor || filteredBatchTagSuggestions.length === 0) {
      setBatchTagActiveSuggestionIndex(-1);
      return;
    }
    setBatchTagActiveSuggestionIndex((current) => (
      current >= filteredBatchTagSuggestions.length ? filteredBatchTagSuggestions.length - 1 : current
    ));
  }, [showBatchTagEditor, filteredBatchTagSuggestions.length]);

  useEffect(() => {
    if (!showBatchTagEditor || batchTagActiveSuggestionIndex < 0) return;
    const activeItem = batchTagSuggestionsRef.current
      ?.querySelector(`[data-suggestion-index="${batchTagActiveSuggestionIndex}"]`);
    activeItem?.scrollIntoView?.({ block: 'nearest' });
  }, [showBatchTagEditor, batchTagActiveSuggestionIndex]);

  useEffect(() => {
    if (!showBatchTagEditor) return undefined;

    const handleOutsidePointerDown = (event) => {
      if (!batchTagEditorRef.current?.contains(event.target)) {
        closeBatchTagEditor();
      }
    };

    window.addEventListener('mousedown', handleOutsidePointerDown);
    return () => window.removeEventListener('mousedown', handleOutsidePointerDown);
  }, [showBatchTagEditor, closeBatchTagEditor]);

  useEffect(() => {
    if (!batchTagFeedback) return undefined;
    const timer = setTimeout(() => {
      setBatchTagFeedback(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [batchTagFeedback]);

  useEffect(() => {
    if (!batchAiFeedback) return undefined;
    const timer = setTimeout(() => {
      setBatchAiFeedback(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [batchAiFeedback]);

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

  const handleCardClick = useCallback((item, index, e) => {
    e.stopPropagation();
    if (typeof index !== 'number' || index < 0 || index >= filteredItems.length) return;

    if (e.shiftKey) {
      e.preventDefault();
      const anchorCandidate = selectionAnchorIndexRef.current >= 0
        ? selectionAnchorIndexRef.current
        : (focusedIndex >= 0 ? focusedIndex : index);
      const anchorIndex = Math.max(0, Math.min(filteredItems.length - 1, anchorCandidate));
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const rangeIds = filteredItems.slice(start, end + 1).map(candidate => candidate.id);
      if (rangeIds.length > 0) {
        setSelectedItemIds(rangeIds);
        setFocusedIndex(index);
        selectionAnchorIndexRef.current = anchorIndex;
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const shouldIncludePreviewSelection =
        selectedItemIds.length === 0 &&
        panelMode === 'preview' &&
        previewItemId &&
        previewItemId !== item.id &&
        filteredItems.some(candidate => candidate.id === previewItemId);

      if (shouldIncludePreviewSelection) {
        toggleSelectItem(previewItemId);
      }
      toggleSelectItem(item.id);
      setFocusedIndex(index);
      selectionAnchorIndexRef.current = index;
      return;
    }
    if (selectedItemIds.length > 0) {
      clearSelection();
    }
    selectionAnchorIndexRef.current = index;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (shouldUseHoverPreview) {
      if (hoverPreviewItem?.id === item.id) {
        clearHoverPreview();
        return;
      }
      clickTimerRef.current = setTimeout(() => {
        const el = document.querySelector(`[data-item-id="${item.id}"]`);
        const rect = el ? el.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
        setHoverPreview(item, { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
        clickTimerRef.current = null;
      }, 250);
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      setPanelMode('preview', item);
      clickTimerRef.current = null;
    }, 250);
  }, [
    setPanelMode,
    toggleSelectItem,
    clearSelection,
    selectedItemIds.length,
    panelMode,
    previewItemId,
    filteredItems,
    focusedIndex,
    setSelectedItemIds,
    setFocusedIndex,
    shouldUseHoverPreview,
    setHoverPreview,
    hoverPreviewItem,
    clearHoverPreview,
  ]);

  const handleCardDoubleClick = useCallback((item, e) => {
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clearHoverPreview();
    // Image/file: copy only, no auto-paste
    if (item.type_ === 'image' || item.type_ === 'file') {
      handleCopy(item, 'history');
    } else {
      handleCopyAndAutoPaste(item, 'history');
    }
  }, [handleCopyAndAutoPaste, handleCopy, clearHoverPreview]);

  const handleStartExternalDrag = useCallback(async (item) => {
    if (!SUPPORTS_NATIVE_EXTERNAL_DRAG) return;
    const paths = getExternalFilePaths(item);
    if (paths.length === 0) return;

    try {
      await invoke('start_native_file_drag', {
        paths,
        operation: 'copy',
      });
    } catch (error) {
      console.error('native drag out failed:', error);
    }
  }, []);

  const handleDragStart = useCallback((item, e) => {
    const externalPaths = getExternalFilePaths(item);
    if (SUPPORTS_NATIVE_EXTERNAL_DRAG && externalPaths.length > 0 && !e.shiftKey) {
      e.preventDefault();
      handleStartExternalDrag(item);
      return;
    }

    const text = getDragText(item, externalPaths);

    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData('application/x-clipbox-item', JSON.stringify({ id: item.id }));
    e.dataTransfer.effectAllowed = 'copyMove';

    switchToCollection();

    const dragEl = document.createElement('div');
    dragEl.textContent = text.substring(0, 40) + (text.length > 40 ? '...' : '');
    dragEl.style.cssText = 'position:absolute;top:-999px;padding:4px 8px;background:#333;color:#fff;border-radius:4px;font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;';
    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 0, 0);
    setTimeout(() => document.body.removeChild(dragEl), 0);
  }, [handleStartExternalDrag, switchToCollection]);

  const handleStreamClick = useCallback(() => {
    if (selectedItemIds.length > 0) {
      clearSelection();
      return;
    }
    if (shouldUseHoverPreview) {
      clearHoverPreview();
      return;
    }
    if (panelMode === 'preview') {
      switchToCollection();
    }
  }, [panelMode, switchToCollection, selectedItemIds.length, clearSelection, shouldUseHoverPreview, clearHoverPreview]);

  const moveFocusedSelection = useCallback((dir) => {
    const total = filteredItems.length;
    if (total === 0) return;

    const next = focusedIndex < 0
      ? (dir === 1 ? 0 : total - 1)
      : Math.max(0, Math.min(total - 1, focusedIndex + dir));

    setFocusedIndex(next);
    virtuosoRef.current?.scrollIntoView({ index: next, behavior: 'auto', align: 'end' });

    const nextItem = filteredItems[next];
    if (!nextItem) return;

    if (shouldUseHoverPreview) {
      const el = document.querySelector(`[data-item-id="${nextItem.id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        setHoverPreview(nextItem, { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
      }
      return;
    }

    setPanelMode('preview', nextItem);
  }, [filteredItems, focusedIndex, setFocusedIndex, shouldUseHoverPreview, setHoverPreview, setPanelMode]);

  const submitFocusedSelection = useCallback(() => {
    if (focusedIndex < 0 || focusedIndex >= filteredItems.length) return false;

    const focusedItem = filteredItems[focusedIndex];
    if (focusedItem.type_ === 'image' || focusedItem.type_ === 'file') {
      handleCopy(focusedItem, 'history');
    } else {
      handleCopyAndAutoPaste(focusedItem, 'history');
    }
    return true;
  }, [focusedIndex, filteredItems, handleCopy, handleCopyAndAutoPaste]);

  const handleSearchInputKeyDown = useCallback((e) => {
    if (e.nativeEvent?.isComposing || e.isComposing) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocusedSelection(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (e.key === 'Enter' && submitFocusedSelection()) {
      e.preventDefault();
    }
  }, [moveFocusedSelection, submitFocusedSelection]);

  useEffect(() => {
    if (!shouldUseHoverPreview) {
      clearHoverPreview();
    }
  }, [shouldUseHoverPreview, clearHoverPreview]);

  useEffect(() => {
    if (selectedItemIds.length > 0) {
      clearHoverPreview();
    }
  }, [selectedItemIds.length, clearHoverPreview]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // skip when focus is inside an input / textarea / editable
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocusedSelection(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (e.key === 'Enter' && submitFocusedSelection()) {
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (filteredItems.length === 0) return;
        e.preventDefault();
        setSelectedItemIds(filteredItems.map(item => item.id));
        setFocusedIndex(0);
        selectionAnchorIndexRef.current = 0;
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        if (!historyTagShortcutEnabled) return;
        e.preventDefault();
        if (panelMode === 'preview' && selectedItemIds.length === 0) {
          return;
        }
        if (selectedItemIds.length === 0) {
          const focusedItem = focusedIndex >= 0 && focusedIndex < filteredItems.length
            ? filteredItems[focusedIndex]
            : null;
          if (!focusedItem) return;
          toggleSelectItem(focusedItem.id);
        }
        openBatchTagEditor();
        return;
      }

      if (selectedItemIds.length === 0 && focusedIndex < 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedItems();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedItemsMerged(filteredItems);
      } else if (e.key === 'Escape') {
        clearSelection();
        setFocusedIndex(-1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedItemIds.length,
    selectedItemIds,
    deleteSelectedItems,
    copySelectedItemsMerged,
    clearSelection,
    historyTagShortcutEnabled,
    panelMode,
    focusedIndex,
    filteredItems,
    setSelectedItemIds,
    toggleSelectItem,
    openBatchTagEditor,
    moveFocusedSelection,
    submitFocusedSelection,
    setFocusedIndex,
  ]);

  const rowGap = isMiniMode ? 3 : 4;

  const handleEndReached = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const computeItemKey = useCallback((index) => filteredItems[index]?.id ?? index, [filteredItems]);

  const renderVirtualRow = useCallback((index) => {
    const item = filteredItems[index];
    if (!item) return null;
    const isSelected = panelMode === 'preview' && previewItem?.id === item.id;
    const isMultiSelected = selectedItemIds.includes(item.id);
    const isFocused = focusedIndex === index;

    return (
      <div
        className="history-stream-row"
        data-item-id={item.id}
        style={{ paddingBottom: `${rowGap}px` }}
        onMouseDownCapture={(e) => {
          if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
          e.stopPropagation();
          e.preventDefault();
          handleCardClick(item, index, e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            return;
          }
          handleCardClick(item, index, e);
        }}
        onContextMenu={(e) => {
          if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDoubleClick={(e) => handleCardDoubleClick(item, e)}
      >
        <CompactCard
          item={item}
          isSelected={isSelected}
          isMultiSelected={isMultiSelected}
          isFocused={isFocused}
          isCopied={copiedItemId === item.id && copyFeedbackSource === 'history'}
          timeTick={timeTick}
          onDragStart={handleDragStart}
          supportsNativeExternalDrag={SUPPORTS_NATIVE_EXTERNAL_DRAG}
          onStartExternalDrag={handleStartExternalDrag}
          onTogglePin={togglePin}
          onToggleFavorite={toggleFavorite}
          onOpenItem={handleOpenItem}
          onRevealInFolder={handleRevealInFolder}
          onTagClick={handleTagClick}
        />
      </div>
    );
  }, [
    filteredItems,
    panelMode,
    previewItem?.id,
    copiedItemId,
    copyFeedbackSource,
    selectedItemIds,
    focusedIndex,
    rowGap,
    timeTick,
    handleCardClick,
    handleCardDoubleClick,
    handleDragStart,
    handleStartExternalDrag,
    togglePin,
    toggleFavorite,
    handleOpenItem,
    handleRevealInFolder,
    handleTagClick,
  ]);

  const canApplyBatchTag = Boolean(activeBatchTagSuggestion || batchTagInput.trim());
  const handleBatchTagInputChange = useCallback((value) => {
    setBatchTagInput(value);
    setBatchTagActiveSuggestionIndex(-1);
  }, []);

  return (
    <div className="history-stream" style={style} onClick={handleStreamClick}>
      <SearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        showFavoritesOnly={showFavoritesOnly}
        onToggleFavorites={() => setShowFavoritesOnly(!showFavoritesOnly)}
        showPinnedOnly={showPinnedOnly}
        onTogglePinned={() => setShowPinnedOnly(!showPinnedOnly)}
        isMiniMode={isMiniMode}
        selectedTags={selectedTags}
        onClearTags={() => setSelectedTags([])}
        showTagFilter={showTagFilter}
        onToggleTagFilter={() => setShowTagFilter(!showTagFilter)}
        allTags={allTags}
        filteredTagsList={filteredTagsList}
        tagSearchQuery={tagSearchQuery}
        onTagSearchChange={setTagSearchQuery}
        onToggleTag={toggleTagFilter}
        onOpenSettings={() => setShowSettings(true)}
        selectedDateRange={selectedDateRange}
        showDateFilter={showDateFilter}
        onToggleDateFilter={() => setShowDateFilter(!showDateFilter)}
        onClearDateFilter={clearDateFilter}
        onSelectDatePreset={handleSelectDatePreset}
        customDateStart={customDateStart}
        customDateEnd={customDateEnd}
        onCustomDateStartChange={setCustomDateStart}
        onCustomDateEndChange={setCustomDateEnd}
        onApplyCustomDateRange={handleApplyCustomDateRange}
        collectionPanelEnabled={collectionPanelEnabled}
        onToggleCollectionPanel={toggleCollectionPanel}
        onSearchKeyDown={handleSearchInputKeyDown}
      />

      <div className="history-stream-content">
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <div className="loading-text">{t('app.loading')}</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? t('search.noResults') : t('app.noItems')}
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
            increaseViewportBy={{ top: 200, bottom: 400 }}
          />
        )}
      </div>

      {showFavoritesOnly && (
        <div className="history-stream-helper-text">
          {t('collection.longTermStorageHint')}
        </div>
      )}

      {selectedItemIds.length > 0 && (
        <MultiSelectBar
          selectedCount={selectedItemIds.length}
          showBatchTagEditor={showBatchTagEditor}
          onToggleBatchTagEditor={() => {
            if (showBatchTagEditor) {
              closeBatchTagEditor();
              return;
            }
            openBatchTagEditor();
          }}
          onBatchFavoriteToggle={handleBatchFavoriteToggle}
          allSelectedAreFavorite={allSelectedAreFavorite}
          onBatchPinToggle={handleBatchPinToggle}
          allSelectedArePinned={allSelectedArePinned}
          onMergeCopy={() => copySelectedItemsMerged(filteredItems)}
          canRunBatchAi={canRunBatchAi}
          onBatchAiAction={handleBatchAiAction}
          batchFlagPending={batchFlagPending}
          batchAiRunningTask={batchAiRunningTask}
          onDeleteSelected={deleteSelectedItems}
          batchTagEditorRef={batchTagEditorRef}
          batchTagInput={batchTagInput}
          onBatchTagInputChange={handleBatchTagInputChange}
          handleBatchTagInputKeyDown={handleBatchTagInputKeyDown}
          canApplyBatchTag={canApplyBatchTag}
          applyBatchTag={applyBatchTag}
          activeBatchTagSuggestion={activeBatchTagSuggestion}
          batchTagPending={batchTagPending}
          closeBatchTagEditor={closeBatchTagEditor}
          filteredBatchTagSuggestions={filteredBatchTagSuggestions}
          batchTagSuggestionsRef={batchTagSuggestionsRef}
          batchTagActiveSuggestionIndex={batchTagActiveSuggestionIndex}
          setBatchTagActiveSuggestionIndex={setBatchTagActiveSuggestionIndex}
          batchTagFeedback={batchTagFeedback}
          batchAiFeedback={batchAiFeedback}
        />
      )}
    </div>
  );
}

export default HistoryStream;
