import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Package,
  Trash2,
  Clock,
  Bot,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Undo2
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
import { runPromptAssistantTask } from '../../features/ai-assistant/services/promptAssistantService';
import { getTags } from '../../utils/tagHelpers';
import SortableCollectionCard from './SortableCollectionCard';
import CollectionQuickNoteSection from './CollectionQuickNoteSection';
import CollectionMultiSelectBar from './CollectionMultiSelectBar';

const QUICK_OUTPUT_TASKS = ['summarize', 'extract', 'reply', 'rewrite'];
const DEFAULT_QUICK_OUTPUT_TASK = 'extract';

function CollectionPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const [batchAiRunningTask, setBatchAiRunningTask] = useState(null);
  const [batchFlagPending, setBatchFlagPending] = useState(false);
  const [batchTagPending, setBatchTagPending] = useState(false);
  const [showBatchTagEditor, setShowBatchTagEditor] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [multiSelectFeedback, setMultiSelectFeedback] = useState(null);
  const [quickOutputTask, setQuickOutputTask] = useState(DEFAULT_QUICK_OUTPUT_TASK);
  const [quickOutputRunning, setQuickOutputRunning] = useState(false);
  const [showQuickOutputMenu, setShowQuickOutputMenu] = useState(false);
  const [showCollectionMoreMenu, setShowCollectionMoreMenu] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const [collectionActionFeedback, setCollectionActionFeedback] = useState(null);
  const [lastClearedPinnedIds, setLastClearedPinnedIds] = useState([]);
  const selectionAnchorIndexRef = useRef(-1);
  const batchTagEditorRef = useRef(null);
  const quickOutputMenuRef = useRef(null);
  const collectionMoreMenuRef = useRef(null);

  const items = useAppStore(s => s.items);
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
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const toggleCollectionPanel = useAppStore(s => s.toggleCollectionPanel);

  const pinnedItems = useMemo(() => {
    const pinned = items.filter(i => i.is_pinned);
    if (!pinnedOrder) return pinned;
    const orderMap = new Map(pinnedOrder.map((id, idx) => [id, idx]));
    return [...pinned].sort((a, b) => {
      const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return aIdx - bIdx;
    });
  }, [items, pinnedOrder]);

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
  const collectionAiSourceText = useMemo(
    () => pinnedItems
      .map(item => item.content || (item.type_ === 'image' ? item.ocr_text || '' : ''))
      .filter(Boolean)
      .join('\n\n'),
    [pinnedItems],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pinnedItems.findIndex(i => i.id === active.id);
    const newIndex = pinnedItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(pinnedItems.map(i => i.id), oldIndex, newIndex);
    setPinnedOrder(newOrder);
  }, [pinnedItems]);

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
    setShowBatchTagEditor(false);
    setBatchTagInput('');
    setMultiSelectFeedback(null);
  }, [selectedPinnedIds.length]);

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
    if (!collectionActionFeedback) return undefined;
    const timeout = collectionActionFeedback.withUndo ? 5000 : 2600;
    const timer = setTimeout(() => {
      setCollectionActionFeedback(null);
    }, timeout);
    return () => clearTimeout(timer);
  }, [collectionActionFeedback]);

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
    if (selectedPinnedIds.length === 0) return;
    setShowQuickOutputMenu(false);
    setShowCollectionMoreMenu(false);
  }, [selectedPinnedIds.length]);

  const handleQuickNoteSubmit = useCallback(async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && quickNote.trim()) {
      e.preventDefault();
      await addQuickNote(quickNote);
      setQuickNote('');
      setIsExpanded(false);
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  }, [quickNote, addQuickNote]);

  const handleExpandedSubmit = useCallback(async () => {
    if (!quickNote.trim()) return;
    await addQuickNote(quickNote);
    setQuickNote('');
    setIsExpanded(false);
  }, [quickNote, addQuickNote]);

  const handleNativeDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleNativeDrop = useCallback(async (e) => {
    e.preventDefault();
    const clipboxData = e.dataTransfer.getData('application/x-clipbox-item');
    if (clipboxData) {
      try {
        const { id } = JSON.parse(clipboxData);
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
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      return;
    }
    if (selectedPinnedIds.length > 0) {
      setSelectedPinnedIds([]);
    }
    selectionAnchorIndexRef.current = index;
    setPanelMode('preview', item);
  }, [selectedPinnedIds.length, setPanelMode]);

  const handleCardDoubleClick = useCallback((item, event) => {
    event.stopPropagation();
    if (selectedPinnedIds.length > 0) return;
    if (item.type_ === 'image' || item.type_ === 'file') {
      handleCopy(item, 'collection');
    } else {
      handleCopyAndAutoPaste(item, 'collection');
    }
  }, [selectedPinnedIds.length, handleCopyAndAutoPaste, handleCopy]);

  const clearPinnedSelection = useCallback(() => {
    setSelectedPinnedIds([]);
  }, []);

  const applyBatchTag = useCallback(async () => {
    const normalizedTag = batchTagInput.trim();
    if (!normalizedTag || batchTagPending || selectedPinnedItems.length === 0) {
      if (!normalizedTag) {
        setMultiSelectFeedback({ type: 'warning', text: t('multiSelect.addTagEmpty') });
      }
      return;
    }

    const normalizedLower = normalizedTag.toLowerCase();
    if (
      normalizedLower.startsWith('ai:')
      || normalizedLower.startsWith('source:')
      || normalizedLower.startsWith('type:')
      || normalizedLower.startsWith('\u6765\u6e90:')
      || normalizedLower.startsWith('\u7c7b\u578b:')
    ) {
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
      const response = await runPromptAssistantTask({
        taskType,
        input: batchAiSourceText.trim(),
        uiLanguage: i18n.language,
        outputLanguage: 'auto',
        tone: 'neutral',
        length: 'medium',
        extraInstruction: null,
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
  }, [batchAiRunningTask, batchAiSourceText, canRunBatchAi, batchTagPending, batchFlagPending, i18n.language, t]);

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

  const handleExpandedNoteKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && event.ctrlKey && quickNote.trim()) {
      handleExpandedSubmit();
    }
    if (event.key === 'Escape') {
      setIsExpanded(false);
    }
  }, [quickNote, handleExpandedSubmit]);

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

  const handleRunQuickOutput = useCallback(async (taskType = quickOutputTask) => {
    if (quickOutputRunning || clearPending) return;

    setShowQuickOutputMenu(false);
    setShowCollectionMoreMenu(false);

    if (!aiEnabled) {
      setCollectionActionFeedback({ type: 'warning', text: t('collection.aiNotEnabled') });
      return;
    }

    const sourceText = collectionAiSourceText.trim();
    if (!sourceText) {
      setCollectionActionFeedback({ type: 'warning', text: t('aiAssistant.noInput') });
      return;
    }

    setQuickOutputRunning(true);
    setCollectionActionFeedback(null);
    try {
      const response = await runPromptAssistantTask({
        taskType,
        input: sourceText,
        uiLanguage: i18n.language,
        outputLanguage: 'auto',
        tone: 'neutral',
        length: 'medium',
        extraInstruction: null,
      });

      const outputText = typeof response?.output === 'string' ? response.output.trim() : '';
      if (!outputText) {
        setCollectionActionFeedback({ type: 'warning', text: t('collection.quickOutputEmpty') });
        return;
      }

      await addQuickNote(outputText);
      try {
        await invoke('copy_plain_text', { text: outputText });
      } catch {
        // Keep success flow even when clipboard copy fails silently.
      }

      setQuickOutputTask(taskType);
      setCollectionActionFeedback({
        type: 'success',
        text: t('collection.quickOutputSuccess', { task: t(`aiAssistant.tasks.${taskType}`) }),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setCollectionActionFeedback({
        type: 'error',
        text: t('collection.quickOutputFailed', { error: message }),
      });
    } finally {
      setQuickOutputRunning(false);
    }
  }, [
    quickOutputTask,
    quickOutputRunning,
    clearPending,
    aiEnabled,
    collectionAiSourceText,
    i18n.language,
    addQuickNote,
    t,
  ]);

  const handleQuickOutputMenuSelect = useCallback((taskType) => {
    setQuickOutputTask(taskType);
    handleRunQuickOutput(taskType);
  }, [handleRunQuickOutput]);

  const handleClearAllFromMenu = useCallback(async () => {
    if (clearPending || quickOutputRunning || pinnedItems.length === 0) return;
    setShowCollectionMoreMenu(false);

    const confirmed = window.confirm(t('collection.clearAllConfirm'));
    if (!confirmed) return;

    const pinnedIdsSnapshot = pinnedItems.map(item => item.id);
    setClearPending(true);
    try {
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      setPanelMode('collection');
      setLastClearedPinnedIds(pinnedIdsSnapshot);
      setCollectionActionFeedback({
        type: 'warning',
        text: t('collection.clearAllDone'),
        withUndo: true,
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setCollectionActionFeedback({
        type: 'error',
        text: t('collection.actionFailed', { error: message }),
      });
    } finally {
      setClearPending(false);
    }
  }, [clearPending, quickOutputRunning, pinnedItems, loadItems, setPanelMode, t]);

  const handleUndoClearAll = useCallback(async () => {
    if (clearPending || lastClearedPinnedIds.length === 0) return;
    setClearPending(true);
    try {
      const itemMap = new Map(items.map(item => [item.id, item]));
      for (const id of lastClearedPinnedIds) {
        const candidate = itemMap.get(id);
        if (!candidate || candidate.is_pinned) continue;
        await invoke('toggle_pin_item', { id, maxPinned: 999 });
      }
      await loadItems();
      setLastClearedPinnedIds([]);
      setCollectionActionFeedback({
        type: 'success',
        text: t('collection.clearAllUndoSuccess'),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setCollectionActionFeedback({
        type: 'error',
        text: t('collection.actionFailed', { error: message }),
      });
    } finally {
      setClearPending(false);
    }
  }, [clearPending, lastClearedPinnedIds, items, loadItems, t]);

  const quickNoteSection = (
    <CollectionQuickNoteSection
      isExpanded={isExpanded}
      quickNote={quickNote}
      onQuickNoteChange={setQuickNote}
      onQuickNoteKeyDown={handleQuickNoteSubmit}
      onExpandedKeyDown={handleExpandedNoteKeyDown}
      onExpandedSubmit={handleExpandedSubmit}
      onCollapse={() => setIsExpanded(false)}
      onExpand={() => setIsExpanded(true)}
      onToggleCollectionPanel={toggleCollectionPanel}
    />
  );

  if (pinnedItems.length === 0) {
    return (
      <div className="collection-panel" onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
        {quickNoteSection}
        <div className="collection-empty">
          <div className="collection-empty-icon">
            <Package size={48} strokeWidth={1} />
          </div>
          <div className="collection-empty-title">{t('collection.emptyTitle')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="collection-panel" onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
      {quickNoteSection}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pinnedItems.map(i => i.id)} strategy={rectSortingStrategy}>
          <div className="collection-cards">
            {pinnedItems.map((item, index) => (
              <SortableCollectionCard
                key={item.id}
                item={item}
                isCopied={copiedItemId === item.id && copyFeedbackSource === 'collection'}
                isMultiSelected={selectedPinnedIds.includes(item.id)}
                isSelectionMode={selectedPinnedIds.length > 0}
                onUnpin={() => togglePin(item)}
                onPointerDownCapture={(event) => handleCardPointerDownCapture(item, index, event)}
                onClick={(event) => handleCardClick(item, index, event)}
                onDoubleClick={(event) => handleCardDoubleClick(item, event)}
                onOpenItem={handleOpenItem}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {selectedPinnedIds.length > 0 ? (
        <CollectionMultiSelectBar
          selectedCount={selectedPinnedIds.length}
          showBatchTagEditor={showBatchTagEditor}
          onToggleBatchTagEditor={handleToggleBatchTagEditor}
          batchTagPending={batchTagPending}
          batchFlagPending={batchFlagPending}
          batchAiRunningTask={batchAiRunningTask}
          onBatchFavoriteToggle={handleBatchFavoriteToggle}
          allSelectedAreFavorite={allSelectedAreFavorite}
          onBatchPinToggle={handleBatchPinToggle}
          allSelectedArePinned={allSelectedArePinned}
          onMergeCopy={handleMergeCopySelected}
          canRunBatchAi={canRunBatchAi}
          onBatchAiAction={handleBatchAiAction}
          onClearSelection={clearPinnedSelection}
          batchTagEditorRef={batchTagEditorRef}
          batchTagInput={batchTagInput}
          onBatchTagInputChange={handleBatchTagInputChange}
          onBatchTagInputKeyDown={handleBatchTagInputKeyDown}
          onApplyBatchTag={applyBatchTag}
          onCloseBatchTagEditor={closeBatchTagEditor}
          multiSelectFeedback={multiSelectFeedback}
        />
      ) : (
        <>
          <div className="collection-bottom-bar">
            <button className="collection-btn timeline-btn" onClick={() => setPanelMode('timeline')} title={t('collection.timeTravel')}>
              <Clock size={14} />
              <span>{t('collection.timeTravel')}</span>
            </button>

            <div className={`collection-split-btn ${showQuickOutputMenu ? 'open' : ''}`} ref={quickOutputMenuRef}>
              <button
                className="collection-btn quick-output-main-btn"
                onClick={() => handleRunQuickOutput(quickOutputTask)}
                disabled={quickOutputRunning || clearPending}
                title={t('collection.quickOutputRunTitle', {
                  task: t(`aiAssistant.tasks.${quickOutputTask}`),
                })}
              >
                {quickOutputRunning ? <Loader2 size={14} className="collection-btn-spinner" /> : <Bot size={14} />}
                <span>{t('collection.quickOutputTaskLabel', { task: t(`aiAssistant.tasks.${quickOutputTask}`) })}</span>
              </button>
              <button
                className="collection-btn quick-output-toggle-btn"
                onClick={() => {
                  setShowCollectionMoreMenu(false);
                  setShowQuickOutputMenu(current => !current);
                }}
                disabled={quickOutputRunning || clearPending}
                title={t('collection.quickOutputSelectTitle')}
              >
                <ChevronDown size={14} />
              </button>
              {showQuickOutputMenu && (
                <div className="collection-dropdown-menu">
                  {QUICK_OUTPUT_TASKS.map((taskType) => (
                    <button
                      key={taskType}
                      className={`collection-dropdown-item ${quickOutputTask === taskType ? 'active' : ''}`}
                      onClick={() => handleQuickOutputMenuSelect(taskType)}
                      disabled={quickOutputRunning || clearPending}
                    >
                      <span>{t(`aiAssistant.tasks.${taskType}`)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={`collection-more-menu ${showCollectionMoreMenu ? 'open' : ''}`} ref={collectionMoreMenuRef}>
              <button
                className="collection-btn collection-more-btn"
                onClick={() => {
                  setShowQuickOutputMenu(false);
                  setShowCollectionMoreMenu(current => !current);
                }}
                disabled={quickOutputRunning || clearPending}
                title={t('collection.moreActions')}
              >
                <MoreHorizontal size={14} />
              </button>
              {showCollectionMoreMenu && (
                <div className="collection-dropdown-menu align-right">
                  <button
                    className="collection-dropdown-item danger"
                    onClick={handleClearAllFromMenu}
                    disabled={quickOutputRunning || clearPending || pinnedItems.length === 0}
                  >
                    {clearPending ? <Loader2 size={14} className="collection-btn-spinner" /> : <Trash2 size={14} />}
                    <span>{t('collection.clearAll')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {collectionActionFeedback && (
            <div className={`collection-bottom-feedback ${collectionActionFeedback.type}`}>
              <span>{collectionActionFeedback.text}</span>
              {collectionActionFeedback.withUndo && lastClearedPinnedIds.length > 0 && (
                <button
                  type="button"
                  className="collection-bottom-feedback-undo"
                  onClick={handleUndoClearAll}
                  disabled={clearPending}
                >
                  {clearPending ? <Loader2 size={12} className="collection-feedback-spinner" /> : <Undo2 size={12} />}
                  <span>{t('collection.undo')}</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CollectionPanel;

