import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';
import { getActionExecutionPreset } from '../../../features/ai-assistant/constants/actionProfiles';
import { getTags, hasReservedTagPrefix } from '../../../utils/tagHelpers';

function useWorkbenchBatchActions({
  selectedPinnedItems,
  selectedCount,
  allSelectedAreFavorite,
  allSelectedArePinned,
  canRunBatchAi,
  batchAiSourceText,
  uiLanguage,
  maxPinnedItems,
  loadItems,
  t,
}) {
  const [batchAiRunningTask, setBatchAiRunningTask] = useState(null);
  const [batchFlagPending, setBatchFlagPending] = useState(false);
  const [batchTagPending, setBatchTagPending] = useState(false);
  const [showBatchTagEditor, setShowBatchTagEditor] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [multiSelectFeedback, setMultiSelectFeedback] = useState(null);
  const batchTagEditorRef = useRef(null);

  useEffect(() => {
    if (!showBatchTagEditor) return undefined;
    const handleOutsidePointerDown = (event) => {
      if (!batchTagEditorRef.current?.contains(event.target)) {
        setShowBatchTagEditor(false);
      }
    };
    window.addEventListener('mousedown', handleOutsidePointerDown);
    return () => window.removeEventListener('mousedown', handleOutsidePointerDown);
  }, [showBatchTagEditor]);

  useEffect(() => {
    if (!multiSelectFeedback) return undefined;
    const timer = setTimeout(() => {
      setMultiSelectFeedback(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [multiSelectFeedback]);

  useEffect(() => {
    if (selectedCount > 0) return;
    setShowBatchTagEditor(false);
    setBatchTagInput('');
    setMultiSelectFeedback(null);
  }, [selectedCount]);

  const applyBatchTag = useCallback(async () => {
    const normalizedTag = batchTagInput.trim();
    if (!normalizedTag || batchTagPending || selectedPinnedItems.length === 0) {
      if (!normalizedTag) {
        setMultiSelectFeedback({ type: 'warning', text: t('multiSelect.addTagEmpty') });
      }
      return;
    }

    if (hasReservedTagPrefix(normalizedTag)) {
      setMultiSelectFeedback({ type: 'error', text: t('multiSelect.addTagReservedPrefix') });
      return;
    }

    setBatchTagPending(true);
    try {
      const updatedAt = Math.floor(Date.now() / 1000);
      let updatedCount = 0;
      let unchangedCount = 0;
      let failedCount = 0;

      const settled = await Promise.allSettled(selectedPinnedItems.map(async (item) => {
        const existingTags = getTags(item.tags);
        if (existingTags.includes(normalizedTag)) {
          unchangedCount += 1;
          return;
        }
        const tags = JSON.stringify([...existingTags, normalizedTag]);
        await invoke('update_item', {
          item: {
            ...item,
            tags,
            updated_at: updatedAt,
          },
        });
        updatedCount += 1;
      }));

      settled.forEach((result) => {
        if (result.status === 'rejected') {
          failedCount += 1;
        }
      });

      await loadItems();

      if (failedCount > 0 && updatedCount === 0 && unchangedCount === 0) {
        setMultiSelectFeedback({
          type: 'error',
          text: t('multiSelect.addTagAllFailed', { failed: failedCount }),
        });
        return;
      }

      if (failedCount > 0) {
        setMultiSelectFeedback({
          type: 'warning',
          text: t('multiSelect.addTagPartial', { updated: updatedCount, failed: failedCount }),
        });
      } else if (updatedCount > 0) {
        setMultiSelectFeedback({
          type: 'success',
          text: t('multiSelect.addTagSuccess', { count: updatedCount, tag: normalizedTag }),
        });
      } else {
        setMultiSelectFeedback({ type: 'warning', text: t('multiSelect.addTagNoChanges') });
      }

      setBatchTagInput('');
      setShowBatchTagEditor(false);
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.addTagFailed', { error: message }),
      });
    } finally {
      setBatchTagPending(false);
    }
  }, [batchTagInput, batchTagPending, selectedPinnedItems, loadItems, t]);

  const handleBatchFavoriteToggle = useCallback(async () => {
    if (batchFlagPending || selectedPinnedItems.length === 0) return;
    const targetFavoriteState = !allSelectedAreFavorite;
    const targets = selectedPinnedItems.filter(item => Boolean(item.is_favorite) !== targetFavoriteState);
    if (targets.length === 0) return;

    setBatchFlagPending(true);
    try {
      for (const item of targets) {
        await invoke('toggle_favorite_item', { id: item.id });
      }
      await loadItems();
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    } finally {
      setBatchFlagPending(false);
    }
  }, [allSelectedAreFavorite, batchFlagPending, selectedPinnedItems, loadItems, t]);

  const handleBatchPinToggle = useCallback(async () => {
    if (batchFlagPending || selectedPinnedItems.length === 0) return;
    const targetPinnedState = !allSelectedArePinned;
    const targets = selectedPinnedItems.filter(item => Boolean(item.is_pinned) !== targetPinnedState);
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
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    } finally {
      setBatchFlagPending(false);
    }
  }, [allSelectedArePinned, batchFlagPending, selectedPinnedItems, maxPinnedItems, loadItems, t]);

  const handleMergeCopySelected = useCallback(async () => {
    if (selectedPinnedItems.length === 0) return;
    const merged = selectedPinnedItems
      .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
      .filter(Boolean)
      .join('\n\n');
    if (!merged) {
      setMultiSelectFeedback({ type: 'warning', text: t('aiAssistant.noInput') });
      return;
    }

    try {
      await invoke('copy_plain_text', { text: merged });
      setMultiSelectFeedback({ type: 'success', text: t('item.copied') });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    }
  }, [selectedPinnedItems, t]);

  const handleBatchAiAction = useCallback(async (taskType) => {
    if (
      (taskType !== 'summarize' && taskType !== 'rewrite')
      || !canRunBatchAi
      || batchAiRunningTask
      || batchTagPending
      || batchFlagPending
    ) {
      return;
    }

    setBatchAiRunningTask(taskType);
    setMultiSelectFeedback(null);
    try {
      const executionPreset = getActionExecutionPreset(taskType, 'quick-output');
      const response = await runPromptAssistantTask({
        taskType,
        input: batchAiSourceText.trim(),
        uiLanguage,
        outputLanguage: resolveOutputLanguageFromUi(uiLanguage),
        tone: executionPreset.tone,
        length: executionPreset.length,
        extraInstruction: executionPreset.extraInstruction,
      });

      const outputText = typeof response?.output === 'string' ? response.output.trim() : '';
      if (!outputText) {
        setMultiSelectFeedback({ type: 'warning', text: t('multiSelect.batchAiEmpty') });
        return;
      }

      await invoke('copy_plain_text', { text: outputText });
      setMultiSelectFeedback({
        type: 'success',
        text: taskType === 'rewrite'
          ? t('multiSelect.batchRewriteCopied')
          : t('multiSelect.batchSummarizeCopied'),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.batchAiFailed', { error: message }),
      });
    } finally {
      setBatchAiRunningTask(null);
    }
  }, [
    batchAiRunningTask,
    batchAiSourceText,
    canRunBatchAi,
    batchTagPending,
    batchFlagPending,
    uiLanguage,
    t,
  ]);

  const handleBatchTagInputKeyDown = useCallback((event) => {
    if (event.nativeEvent?.isComposing || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      applyBatchTag();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setShowBatchTagEditor(false);
      setBatchTagInput('');
    }
  }, [applyBatchTag]);

  const closeBatchTagEditor = useCallback(() => {
    setShowBatchTagEditor(false);
    setBatchTagInput('');
  }, []);

  const handleToggleBatchTagEditor = useCallback(() => {
    if (showBatchTagEditor) {
      closeBatchTagEditor();
      return;
    }
    setBatchTagInput('');
    setShowBatchTagEditor(true);
  }, [showBatchTagEditor, closeBatchTagEditor]);

  const handleBatchTagInputChange = useCallback((value) => {
    setBatchTagInput(value);
  }, []);

  return {
    batchAiRunningTask,
    batchFlagPending,
    batchTagPending,
    showBatchTagEditor,
    batchTagInput,
    multiSelectFeedback,
    batchTagEditorRef,
    applyBatchTag,
    handleBatchFavoriteToggle,
    handleBatchPinToggle,
    handleMergeCopySelected,
    handleBatchAiAction,
    handleBatchTagInputKeyDown,
    closeBatchTagEditor,
    handleToggleBatchTagEditor,
    handleBatchTagInputChange,
  };
}

export default useWorkbenchBatchActions;
