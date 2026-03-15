import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { getActionExecutionPreset } from '../../../features/ai-assistant/constants/actionProfiles';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';
import { getUserTags, toggleItemPin } from '../../../services/clipboardService';

export default function useHistoryBatchActions({
  itemsById,
  itemsRevision,
  filteredItems,
  selectedItemIds,
  aiEnabled,
  maxPinnedItems,
  activeWorkbenchId,
  loadItems,
  addTagToSelectedItems,
  setBackendSearchResults,
  setFocusedIndex,
  selectionAnchorIndexRef,
  t,
  i18nLanguage,
}) {
  const batchTagEditorRef = useRef(null);
  const batchTagSuggestionsRef = useRef(null);

  const [showBatchTagEditor, setShowBatchTagEditor] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagPending, setBatchTagPending] = useState(false);
  const [batchTagFeedback, setBatchTagFeedback] = useState(null);
  const [batchTagActiveSuggestionIndex, setBatchTagActiveSuggestionIndex] = useState(-1);
  const [batchAiRunningTask, setBatchAiRunningTask] = useState(null);
  const [batchAiFeedback, setBatchAiFeedback] = useState(null);
  const [batchFlagPending, setBatchFlagPending] = useState(false);
  const [debouncedBatchTagQuery, setDebouncedBatchTagQuery] = useState('');
  const [backendUserTags, setBackendUserTags] = useState([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedBatchTagQuery(batchTagInput.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [batchTagInput]);

  useEffect(() => {
    let cancelled = false;
    getUserTags(debouncedBatchTagQuery, 120)
      .then((tags) => {
        if (cancelled) return;
        if (!Array.isArray(tags)) {
          setBackendUserTags([]);
          return;
        }
        const seenTags = new Set();
        const normalized = [];
        tags.forEach((tag) => {
          if (typeof tag !== 'string') return;
          const normalizedTag = tag.trim();
          if (!normalizedTag || normalizedTag.startsWith('AI:') || seenTags.has(normalizedTag)) return;
          seenTags.add(normalizedTag);
          normalized.push(normalizedTag);
        });
        setBackendUserTags(normalized);
      })
      .catch((error) => {
        console.error('[HistoryBatch] load user tags failed:', error);
        if (!cancelled) setBackendUserTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedBatchTagQuery, itemsRevision]);

  const filteredBatchTagSuggestions = useMemo(() => {
    const normalizedInput = batchTagInput.trim().toLowerCase();
    if (!normalizedInput) return backendUserTags.slice(0, 8);

    const prefixMatches = [];
    const partialMatches = [];
    backendUserTags.forEach((tag) => {
      const normalizedTag = tag.toLowerCase();
      if (!normalizedTag.includes(normalizedInput) || normalizedTag === normalizedInput) return;
      if (normalizedTag.startsWith(normalizedInput)) {
        prefixMatches.push(tag);
      } else {
        partialMatches.push(tag);
      }
    });
    return [...prefixMatches, ...partialMatches].slice(0, 8);
  }, [backendUserTags, batchTagInput]);

  const activeBatchTagSuggestion =
    batchTagActiveSuggestionIndex >= 0
      ? filteredBatchTagSuggestions[batchTagActiveSuggestionIndex] || null
      : null;

  const selectedItemsForBatchActions = useMemo(() => {
    if (selectedItemIds.length === 0) return [];
    const selectedIdSet = new Set(selectedItemIds);
    const preferredOrdered = filteredItems.filter(item => selectedIdSet.has(item.id));
    if (preferredOrdered.length === selectedItemIds.length) {
      return preferredOrdered;
    }

    const fallbackById = itemsById instanceof Map ? itemsById : null;
    const fallbackOrdered = selectedItemIds
      .map(id => fallbackById?.get(id))
      .filter(Boolean);
    const preferredIdSet = new Set(preferredOrdered.map(item => item.id));
    return preferredOrdered.length > 0
      ? [...preferredOrdered, ...fallbackOrdered.filter(item => !preferredIdSet.has(item.id))]
      : fallbackOrdered;
  }, [selectedItemIds, filteredItems, itemsById]);

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
  }, [addTagToSelectedItems, batchTagInput, batchTagPending, filteredItems, setBackendSearchResults, t]);

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
        await toggleItemPin(item.id, { maxPinned, workbenchId: activeWorkbenchId });
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
  }, [activeWorkbenchId, allSelectedArePinned, batchFlagPending, selectedItemsForBatchActions, maxPinnedItems, loadItems, t]);

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
        uiLanguage: i18nLanguage,
        outputLanguage: resolveOutputLanguageFromUi(i18nLanguage),
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
  }, [batchAiRunningTask, batchAiSourceText, canRunBatchAi, i18nLanguage, t]);

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

  const handleBatchTagInputChange = useCallback((value) => {
    setBatchTagInput(value);
    setBatchTagActiveSuggestionIndex(-1);
  }, []);

  const canApplyBatchTag = Boolean(activeBatchTagSuggestion || batchTagInput.trim());

  useEffect(() => {
    setFocusedIndex(-1);
    selectionAnchorIndexRef.current = -1;
  }, [filteredItems, setFocusedIndex, selectionAnchorIndexRef]);

  useEffect(() => {
    if (selectedItemIds.length > 0) return;
    setShowBatchTagEditor(false);
    setBatchTagInput('');
    setBatchTagActiveSuggestionIndex(-1);
    setBatchAiFeedback(null);
    selectionAnchorIndexRef.current = -1;
  }, [selectedItemIds.length, selectionAnchorIndexRef]);

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

  return {
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
  };
}
