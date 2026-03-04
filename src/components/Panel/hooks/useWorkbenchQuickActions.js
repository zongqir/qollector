import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';
import {
  getActionExecutionPreset,
  QUICK_OUTPUT_TASKS,
  resolveQuickOutputTaskFromItems,
} from '../../../features/ai-assistant/constants/actionProfiles';

const WORKBENCH_SNAPSHOT_STORAGE_KEY = 'qollect.workbench.snapshot.v1';
const LEGACY_COLLECTION_SNAPSHOT_STORAGE_KEY = 'qollect.collection.snapshot.v1';
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
    const keys = [WORKBENCH_SNAPSHOT_STORAGE_KEY, LEGACY_COLLECTION_SNAPSHOT_STORAGE_KEY];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      if (!Array.isArray(payload?.ids)) continue;
      return payload;
    }
    return null;
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
  localStorage.setItem(WORKBENCH_SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
};

const buildExportMarkdown = (items, t) => {
  const now = new Date().toLocaleString();
  const lines = [
    `# ${t('workbench.exportTitle')}`,
    '',
    `${t('workbench.exportGeneratedAt')}: ${now}`,
    `${t('workbench.exportItemCount')}: ${items.length}`,
    '',
  ];

  items.forEach((item, index) => {
    const typeLabel = t(`aiAssistant.sourceType.${item.type_}`, {
      defaultValue: item?.type_ || t('aiAssistant.sourceType.text'),
    });
    const content = String(
      item?.content
        || (item?.type_ === 'image' ? item?.ocr_text || '' : '')
        || t('workbench.exportEmptyLine')
    ).trim();
    const note = String(item?.user_note || '').trim();

    lines.push(`## ${index + 1}. [${typeLabel}]`);
    lines.push('');
    lines.push(content);
    if (note) {
      lines.push('');
      lines.push(`> ${t('workbench.exportNoteLabel')}: ${note}`);
    }
    lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
};

function useWorkbenchQuickActions({
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
  const autoQuickOutputTask = useMemo(
    () => resolveQuickOutputTaskFromItems(pinnedItems, DEFAULT_QUICK_OUTPUT_TASK),
    [pinnedItems],
  );
  const [quickOutputTask, setQuickOutputTask] = useState(autoQuickOutputTask);
  const [quickOutputTaskOverridden, setQuickOutputTaskOverridden] = useState(false);
  const [quickOutputRunning, setQuickOutputRunning] = useState(false);
  const [activeAction, setActiveAction] = useState(null);
  const [showQuickOutputMenu, setShowQuickOutputMenu] = useState(false);
  const [showWorkbenchMoreMenu, setShowWorkbenchMoreMenu] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [lastClearedPinnedIds, setLastClearedPinnedIds] = useState([]);
  const [hasSnapshot, setHasSnapshot] = useState(() => Boolean(readSnapshot()));
  const quickOutputMenuRef = useRef(null);
  const workbenchMoreMenuRef = useRef(null);

  const workbenchAiSourceText = useMemo(
    () => pinnedItems
      .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
      .filter(Boolean)
      .join('\n\n'),
    [pinnedItems],
  );

  useEffect(() => {
    if (quickOutputTaskOverridden) return;
    if (quickOutputTask === autoQuickOutputTask) return;
    setQuickOutputTask(autoQuickOutputTask);
  }, [autoQuickOutputTask, quickOutputTask, quickOutputTaskOverridden]);

  useEffect(() => {
    if (pinnedItems.length > 0) return;
    if (!quickOutputTaskOverridden) return;
    setQuickOutputTaskOverridden(false);
  }, [pinnedItems.length, quickOutputTaskOverridden]);

  const isBusy = quickOutputRunning || activeAction != null;

  const closeMenus = useCallback(() => {
    setShowQuickOutputMenu(false);
    setShowWorkbenchMoreMenu(false);
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
    if (!showQuickOutputMenu && !showWorkbenchMoreMenu) return undefined;
    const handlePointerDown = (event) => {
      if (showQuickOutputMenu && !quickOutputMenuRef.current?.contains(event.target)) {
        setShowQuickOutputMenu(false);
      }
      if (showWorkbenchMoreMenu && !workbenchMoreMenuRef.current?.contains(event.target)) {
        setShowWorkbenchMoreMenu(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showQuickOutputMenu, showWorkbenchMoreMenu]);

  useEffect(() => {
    if (!selectionMode) return;
    closeMenus();
  }, [selectionMode, closeMenus]);

  const handleRunQuickOutput = useCallback(async (taskType = quickOutputTask) => {
    if (isBusy) return;
    closeMenus();

    if (!aiEnabled) {
      showMessage({ type: 'warning', text: t('workbench.aiNotEnabled') });
      return;
    }

    const sourceText = workbenchAiSourceText.trim();
    if (!sourceText) {
      showMessage({ type: 'warning', text: t('aiAssistant.noInput') });
      return;
    }

    setQuickOutputRunning(true);
    setFeedback(null);
    try {
      const executionPreset = getActionExecutionPreset(taskType, 'quick-output');
      const response = await runPromptAssistantTask({
        taskType,
        input: sourceText,
        uiLanguage,
        outputLanguage: resolveOutputLanguageFromUi(uiLanguage),
        tone: executionPreset.tone,
        length: executionPreset.length,
        extraInstruction: executionPreset.extraInstruction,
      });

      const outputText = typeof response?.output === 'string' ? response.output.trim() : '';
      if (!outputText) {
        showMessage({ type: 'warning', text: t('workbench.quickOutputEmpty') });
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
        text: t('workbench.quickOutputSuccess', { task: t(`aiAssistant.tasks.${taskType}`) }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.quickOutputFailed', { error: message }) });
    } finally {
      setQuickOutputRunning(false);
    }
  }, [
    quickOutputTask,
    isBusy,
    closeMenus,
    aiEnabled,
    workbenchAiSourceText,
    uiLanguage,
    addQuickNote,
    showMessage,
    t,
  ]);

  const handleQuickOutputMenuSelect = useCallback((taskType) => {
    setQuickOutputTaskOverridden(true);
    setQuickOutputTask(taskType);
    handleRunQuickOutput(taskType);
  }, [handleRunQuickOutput]);

  const handleSaveSnapshot = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    const pinnedIds = pinnedItems.map(item => item.id);
    if (pinnedIds.length === 0) {
      showMessage({ type: 'warning', text: t('workbench.snapshotNoItems') });
      return;
    }

    setActiveAction('snapshot');
    try {
      saveSnapshot(pinnedIds);
      setHasSnapshot(true);
      showMessage({
        type: 'success',
        text: t('workbench.snapshotSaved', { count: pinnedIds.length }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, showMessage, t]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    const snapshot = readSnapshot();
    if (!snapshot?.ids?.length) {
      showMessage({ type: 'warning', text: t('workbench.snapshotMissing') });
      return;
    }

    setActiveAction('restore-snapshot');
    try {
      const itemMap = new Map(items.map(item => [item.id, item]));
      const currentPinnedIds = pinnedItems.map(item => item.id);
      const snapshotIds = snapshot.ids.filter(id => itemMap.has(id));

      if (snapshotIds.length === 0) {
        showMessage({ type: 'warning', text: t('workbench.snapshotNoMatch') });
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
      setPanelMode('workbench');
      showMessage({
        type: 'success',
        text: t('workbench.snapshotRestored', { count: snapshotIds.length }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, items, pinnedItems, loadItems, setPanelMode, showMessage, t]);

  const handleExportWorkbench = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    if (pinnedItems.length === 0) {
      showMessage({ type: 'warning', text: t('workbench.exportNoItems') });
      return;
    }

    setActiveAction('export');
    try {
      const content = buildExportMarkdown(pinnedItems, t);
      const outputPath = await invoke('export_workbench_text', {
        defaultName: 'qollect_workbench',
        content,
        format: 'markdown',
      });
      showMessage({ type: 'success', text: t('workbench.exportSuccess', { path: outputPath }) });
    } catch (error) {
      if (String(error) === 'CANCELLED') return;
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, t, showMessage]);

  const handleDedupeWorkbench = useCallback(async () => {
    if (isBusy) return;
    closeMenus();

    if (pinnedItems.length === 0) {
      showMessage({ type: 'warning', text: t('workbench.dedupeNoItems') });
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
        showMessage({ type: 'warning', text: t('workbench.dedupeNoChanges') });
        return;
      }

      for (const id of duplicateIds) {
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }

      await loadItems();
      showMessage({ type: 'success', text: t('workbench.dedupeDone', { count: duplicateIds.length }) });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, closeMenus, pinnedItems, loadItems, showMessage, t]);

  const handleClearAll = useCallback(async () => {
    if (isBusy || pinnedItems.length === 0) return;
    closeMenus();

    const confirmed = window.confirm(t('workbench.clearAllConfirm'));
    if (!confirmed) return;

    const pinnedIdsSnapshot = pinnedItems.map(item => item.id);
    setActiveAction('clear');
    try {
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      setPanelMode('workbench');
      setLastClearedPinnedIds(pinnedIdsSnapshot);
      showMessage({
        type: 'warning',
        text: t('workbench.clearAllDone'),
        withUndo: true,
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
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
      showMessage({ type: 'success', text: t('workbench.clearAllUndoSuccess') });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      showMessage({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setActiveAction(null);
    }
  }, [isBusy, lastClearedPinnedIds, items, loadItems, showMessage, t]);

  return {
    quickOutputTask,
    quickOutputRunning,
    showQuickOutputMenu,
    showWorkbenchMoreMenu,
    activeAction,
    feedback,
    lastClearedPinnedIds,
    hasSnapshot,
    quickOutputMenuRef,
    workbenchMoreMenuRef,
    quickOutputTasks: QUICK_OUTPUT_TASKS,
    isBusy,
    setShowQuickOutputMenu,
    setShowWorkbenchMoreMenu,
    closeMenus,
    handleRunQuickOutput,
    handleQuickOutputMenuSelect,
    handleSaveSnapshot,
    handleRestoreSnapshot,
    handleExportWorkbench,
    handleDedupeWorkbench,
    handleClearAll,
    handleUndoClearAll,
  };
}

export default useWorkbenchQuickActions;
