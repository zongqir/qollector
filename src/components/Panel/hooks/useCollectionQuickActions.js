import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';

const SNAPSHOT_STORAGE_KEY = 'clipbox.collection.snapshot.v1';
const QUICK_OUTPUT_TASKS = ['summarize', 'extract', 'reply', 'rewrite'];
const DEFAULT_QUICK_OUTPUT_TASK = 'extract';

const normalizeText = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const buildDedupeKey = (item) => {
  const type = item?.type_ || 'unknown';
  const contentHash = normalizeText(item?.content_hash);
  const content = normalizeText(item?.content);
  const ocrText = normalizeText(item?.ocr_text);
  const imagePaths = normalizeText(item?.image_paths);

  if (type === 'text') {
    return content ? `text:${content}` : '';
  }
  if (type === 'link') {
    return content ? `link:${content}` : '';
  }
  if (type === 'image') {
    return contentHash || ocrText || imagePaths
      ? `image:${contentHash || ocrText || imagePaths}`
      : '';
  }
  if (type === 'file') {
    return contentHash || content || imagePaths
      ? `file:${contentHash || content || imagePaths}`
      : '';
  }
  return contentHash || content ? `${type}:${contentHash || content}` : '';
};

const readSnapshot = () => {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!Array.isArray(payload?.ids)) return null;
    return payload;
  } catch {
    return null;
  }
};

const saveSnapshot = (ids) => {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    ids,
  };
  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
};

const buildExportMarkdown = (items, t) => {
  const now = new Date().toLocaleString();
  const lines = [
    `# ${t('collection.exportTitle')}`,
    '',
    `${t('collection.exportGeneratedAt')}: ${now}`,
    `${t('collection.exportItemCount')}: ${items.length}`,
    '',
  ];

  items.forEach((item, index) => {
    const typeLabel = t(`aiAssistant.sourceType.${item.type_}`, {
      defaultValue: item?.type_ || t('aiAssistant.sourceType.text'),
    });
    const content = String(
      item?.content
        || (item?.type_ === 'image' ? item?.ocr_text || '' : '')
        || t('collection.exportEmptyLine')
    ).trim();
    const note = String(item?.user_note || '').trim();

    lines.push(`## ${index + 1}. [${typeLabel}]`);
    lines.push('');
    lines.push(content);
    if (note) {
      lines.push('');
      lines.push(`> ${t('collection.exportNoteLabel')}: ${note}`);
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
};

function useCollectionQuickActions({
  pinnedItems,
  items,
  aiEnabled,
  uiLanguage,
  selectionMode,
  addQuickNote,
  loadItems,
  setPanelMode,
  t,
}) {
  const [quickOutputTask, setQuickOutputTask] = useState(DEFAULT_QUICK_OUTPUT_TASK);
  const [quickOutputRunning, setQuickOutputRunning] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [showQuickOutputMenu, setShowQuickOutputMenu] = useState(false);
  const [showCollectionMoreMenu, setShowCollectionMoreMenu] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [lastClearedPinnedIds, setLastClearedPinnedIds] = useState([]);
  const [hasSnapshot, setHasSnapshot] = useState(() => Boolean(readSnapshot()));
  const quickOutputMenuRef = useRef(null);
  const collectionMoreMenuRef = useRef(null);

  const collectionAiSourceText = useMemo(
    () => pinnedItems
      .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
      .filter(Boolean)
      .join('\n\n'),
    [pinnedItems],
  );

  const isBusy = quickOutputRunning || activeAction != null;

  const closeMenus = useCallback(() => {
    setShowQuickOutputMenu(false);
    setShowCollectionMoreMenu(false);
  }, []);

  const showMessage = useCallback((next) => {
    setFeedback(next);
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = feedback.withUndo ? 5000 : 2800;
    const timer = setTimeout(() => {
      setFeedback(null);
    }, timeout);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!showQuickOutputMenu && !showCollectionMoreMenu) return undefined;
    const handlePointerDown = (event) => {
      if (showQuickOutputMenu && !quickOutputMenuRef.current?.contains(event.target)) {
        setShowQuickOutputMenu(false);
      }
      if (showCollectionMoreMenu && !collectionMoreMenuRef.current?.contains(event.target)) {
        setShowCollectionMoreMenu(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showQuickOutputMenu, showCollectionMoreMenu]);

  useEffect(() => {
    if (!selectionMode) return;
    closeMenus();
  }, [selectionMode, closeMenus]);

  const handleRunQuickOutput = useCallback(async (taskType = quickOutputTask) => {
    if (isBusy) return;
    closeMenus();

    if (!aiEnabled) {
      showMessage({ type: 'warning', text: t('collection.aiNotEnabled') });
      return;
    }

    const sourceText = collectionAiSourceText.trim();
    if (!sourceText) {
      showMessage({ type: 'warning', text: t('aiAssistant.noInput') });
      return;
    }

    setQuickOutputRunning(true);
    setFeedback(null);
    try {
      const response = await runPromptAssistantTask({
        taskType,
        input: sourceText,
        uiLanguage,
        outputLanguage: resolveOutputLanguageFromUi(uiLanguage),
        tone: 'neutral',
        length: 'medium',
        extraInstruction: null,
      });

      const outputText = typeof response?.output === 'string' ? response.output.trim() : '';
      if (!outputText) {
        showMessage({ type: 'warning', text: t('collection.quickOutputEmpty') });
        return;
      }

      await addQuickNote(outputText);
      try {
        await invoke('copy_plain_text', { text: outputText });
      } catch {
        // Keep success flow even when clipboard copy fails.
      }

      setQuickOutputTask(taskType);
      showMessage({
        type: 'success',
        text: t('collection.quickOutputSuccess', { task: t(`aiAssistant.tasks.${taskType}`) }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.quickOutputFailed', { error: message }) });
    } finally {
      setQuickOutputRunning(false);
    }
  }, [
    quickOutputTask,
    isBusy,
    closeMenus,
    aiEnabled,
    collectionAiSourceText,
    uiLanguage,
    addQuickNote,
    showMessage,
    t,
  ]);

  const handleQuickOutputMenuSelect = useCallback((taskType) => {
    setQuickOutputTask(taskType);
    handleRunQuickOutput(taskType);
  }, [handleRunQuickOutput]);

  const handleSaveSnapshot = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    const pinnedIds = pinnedItems.map(item => item.id);
    if (pinnedIds.length === 0) {
      showMessage({ type: 'warning', text: t('collection.snapshotNoItems') });
      return;
    }

    setActiveAction('snapshot');
    try {
      saveSnapshot(pinnedIds);
      setHasSnapshot(true);
      showMessage({
        type: 'success',
        text: t('collection.snapshotSaved', { count: pinnedIds.length }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, showMessage, t]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    const snapshot = readSnapshot();
    if (!snapshot?.ids?.length) {
      showMessage({ type: 'warning', text: t('collection.snapshotMissing') });
      return;
    }

    setActiveAction('restore-snapshot');
    try {
      const itemMap = new Map(items.map(item => [item.id, item]));
      const currentPinnedIds = pinnedItems.map(item => item.id);
      const snapshotIds = snapshot.ids.filter(id => itemMap.has(id));

      if (snapshotIds.length === 0) {
        showMessage({ type: 'warning', text: t('collection.snapshotNoMatch') });
        return;
      }

      const snapshotSet = new Set(snapshotIds);
      const currentPinnedSet = new Set(currentPinnedIds);
      const toUnpin = currentPinnedIds.filter(id => !snapshotSet.has(id));
      const toPin = snapshotIds.filter(id => !currentPinnedSet.has(id));

      for (const id of toUnpin) {
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }
      for (const id of toPin) {
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }

      await loadItems();
      setPanelMode('collection');
      showMessage({
        type: 'success',
        text: t('collection.snapshotRestored', { count: snapshotIds.length }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, items, pinnedItems, loadItems, setPanelMode, showMessage, t]);

  const handleExportCollection = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    if (pinnedItems.length === 0) {
      showMessage({ type: 'warning', text: t('collection.exportNoItems') });
      return;
    }

    setActiveAction('export');
    try {
      const content = buildExportMarkdown(pinnedItems, t);
      const outputPath = await invoke('export_collection_text', {
        defaultName: 'clipbox_collection',
        content,
        format: 'markdown',
      });
      showMessage({ type: 'success', text: t('collection.exportSuccess', { path: outputPath }) });
    } catch (error) {
      if (String(error) === 'CANCELLED') return;
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, t, showMessage]);

  const handleDedupeCollection = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    if (pinnedItems.length === 0) {
      showMessage({ type: 'warning', text: t('collection.dedupeNoItems') });
      return;
    }

    setActiveAction('dedupe');
    try {
      const seenKeys = new Set();
      const duplicateIds = [];

      for (const item of pinnedItems) {
        const dedupeKey = buildDedupeKey(item);
        if (!dedupeKey) continue;
        if (seenKeys.has(dedupeKey)) {
          duplicateIds.push(item.id);
        } else {
          seenKeys.add(dedupeKey);
        }
      }

      if (duplicateIds.length === 0) {
        showMessage({ type: 'warning', text: t('collection.dedupeNoChanges') });
        return;
      }

      for (const id of duplicateIds) {
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }

      await loadItems();
      showMessage({ type: 'success', text: t('collection.dedupeDone', { count: duplicateIds.length }) });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, loadItems, showMessage, t]);

  const handleClearAll = useCallback(async () => {
    if (isBusy || pinnedItems.length === 0) return;
    closeMenus();

    const confirmed = window.confirm(t('collection.clearAllConfirm'));
    if (!confirmed) return;

    const pinnedIdsSnapshot = pinnedItems.map(item => item.id);
    setActiveAction('clear');
    try {
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      setPanelMode('collection');
      setLastClearedPinnedIds(pinnedIdsSnapshot);
      showMessage({
        type: 'warning',
        text: t('collection.clearAllDone'),
        withUndo: true,
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, pinnedItems, closeMenus, t, loadItems, setPanelMode, showMessage]);

  const handleUndoClearAll = useCallback(async () => {
    if (isBusy || lastClearedPinnedIds.length === 0) return;
    setActiveAction('undo-clear');
    try {
      const itemMap = new Map(items.map(item => [item.id, item]));
      for (const id of lastClearedPinnedIds) {
        const candidate = itemMap.get(id);
        if (!candidate || candidate.is_pinned) continue;
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }
      await loadItems();
      setLastClearedPinnedIds([]);
      showMessage({ type: 'success', text: t('collection.clearAllUndoSuccess') });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('collection.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, lastClearedPinnedIds, items, loadItems, showMessage, t]);

  return {
    quickOutputTask,
    quickOutputRunning,
    showQuickOutputMenu,
    showCollectionMoreMenu,
    activeAction,
    feedback,
    lastClearedPinnedIds,
    hasSnapshot,
    quickOutputMenuRef,
    collectionMoreMenuRef,
    quickOutputTasks: QUICK_OUTPUT_TASKS,
    isBusy,
    setShowQuickOutputMenu,
    setShowCollectionMoreMenu,
    closeMenus,
    handleRunQuickOutput,
    handleQuickOutputMenuSelect,
    handleSaveSnapshot,
    handleRestoreSnapshot,
    handleExportCollection,
    handleDedupeCollection,
    handleClearAll,
    handleUndoClearAll,
  };
}

export default useCollectionQuickActions;
