import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Package, Bot, Copy, Trash2, Plus, X, Send, PanelRightClose, Clock, Wand2 } from 'lucide-react';
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
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useAppStore from '../../store/useAppStore';
import { runPromptAssistantTask } from '../../features/ai-assistant/services/promptAssistantService';
import CollectionCard from './CollectionCard';

// 可排序的卡片包装器
function SortableCard({
  item,
  isCopied,
  isMultiSelected,
  isSelectionMode,
  onUnpin,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
  onOpenItem,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isSelectionMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={{ ...style, touchAction: 'none' }} {...attributes} {...listeners}>
      <CollectionCard
        item={item}
        isCopied={isCopied}
        isMultiSelected={isMultiSelected}
        onUnpin={onUnpin}
        onPointerDownCapture={onPointerDownCapture}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onOpenItem={onOpenItem}
      />
    </div>
  );
}

function CollectionPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const [batchAiRunningTask, setBatchAiRunningTask] = useState(null);
  const [multiSelectFeedback, setMultiSelectFeedback] = useState(null);
  const selectionAnchorIndexRef = useRef(-1);

  const items = useAppStore(s => s.items);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const addQuickNote = useAppStore(s => s.addQuickNote);
  const clearAllPinned = useAppStore(s => s.clearAllPinned);
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
    setMultiSelectFeedback(null);
  }, [selectedPinnedIds.length]);

  useEffect(() => {
    if (!multiSelectFeedback) return undefined;
    const timer = setTimeout(() => {
      setMultiSelectFeedback(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [multiSelectFeedback]);

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
        console.error('拖入失败:', err);
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

  const handleRemoveSelected = useCallback(async () => {
    if (selectedPinnedItems.length === 0) return;
    try {
      for (const item of selectedPinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      clearPinnedSelection();
      setPanelMode('collection');
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setMultiSelectFeedback({
        type: 'error',
        text: t('multiSelect.batchActionFailed', { error: message }),
      });
    }
  }, [selectedPinnedItems, loadItems, clearPinnedSelection, setPanelMode, t]);

  const handleBatchAiAction = useCallback(async (taskType) => {
    if ((taskType !== 'summarize' && taskType !== 'rewrite') || !canRunBatchAi || batchAiRunningTask) {
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
  }, [batchAiRunningTask, batchAiSourceText, canRunBatchAi, i18n.language, t]);

  const quickNoteSection = (
    <div className={`collection-quick-note ${isExpanded ? 'expanded' : ''}`}>
      {isExpanded ? (
        <div className="quick-note-expanded">
          <div className="quick-note-expanded-body">
            <textarea
              className="quick-note-textarea"
              placeholder={t('collection.expandedNotePlaceholder')}
              value={quickNote}
              onChange={(e) => setQuickNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey && quickNote.trim()) {
                  handleExpandedSubmit();
                }
                if (e.key === 'Escape') setIsExpanded(false);
              }}
              autoFocus
            />
            <button
              className="quick-note-close-btn"
              onClick={() => setIsExpanded(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="quick-note-expanded-footer">
            <span className="quick-note-hint">Ctrl+Enter</span>
            <button
              className="quick-note-submit-btn"
              onClick={handleExpandedSubmit}
              disabled={!quickNote.trim()}
            >
              <Send size={14} />
              <span>{t('collection.expandedNoteSubmit')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-note-input-wrapper">
          <button
            className="quick-note-expand-btn"
            onClick={() => setIsExpanded(true)}
            title={t('collection.expandedNotePlaceholder')}
          >
            <Plus size={16} />
          </button>
          <input
            type="text"
            className="quick-note-input"
            placeholder={t('collection.quickNotePlaceholder')}
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            onKeyDown={handleQuickNoteSubmit}
          />
          <button
            className="collection-close-inline-btn"
            onClick={toggleCollectionPanel}
            title={t('collection.hidePanel')}
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      )}
    </div>
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
              <SortableCard
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
        <div className="multi-select-bar collection-multi-select-bar">
          <span className="multi-select-count">
            {t('multiSelect.selected', { count: selectedPinnedIds.length })}
          </span>
          <div className="multi-select-actions">
            <button className="multi-select-btn copy" onClick={handleMergeCopySelected}>
              <Copy size={14} />
              <span>{t('multiSelect.mergeCopy')}</span>
            </button>
            {canRunBatchAi && (
              <>
                <button
                  className="multi-select-btn ai"
                  onClick={() => handleBatchAiAction('summarize')}
                  disabled={batchAiRunningTask != null}
                >
                  <Bot size={14} />
                  <span>{t('multiSelect.batchSummarize')}</span>
                </button>
                <button
                  className="multi-select-btn ai"
                  onClick={() => handleBatchAiAction('rewrite')}
                  disabled={batchAiRunningTask != null}
                >
                  <Wand2 size={14} />
                  <span>{t('multiSelect.batchRewrite')}</span>
                </button>
              </>
            )}
            <button className="multi-select-btn delete" onClick={handleRemoveSelected}>
              <Trash2 size={14} />
              <span>{t('collection.removeFromCollection')}</span>
            </button>
            <button className="multi-select-btn" onClick={clearPinnedSelection}>
              <X size={14} />
              <span>{t('multiSelect.clearSelection')}</span>
            </button>
          </div>
          {multiSelectFeedback && (
            <div className={`multi-select-feedback ${multiSelectFeedback.type}`}>
              {multiSelectFeedback.text}
            </div>
          )}
        </div>
      ) : (
        <div className="collection-bottom-bar">
          <button className="collection-btn timeline-btn" onClick={() => setPanelMode('timeline')} title={t('collection.timeTravel')}>
            <Clock size={14} />
            <span>{t('collection.timeTravel')}</span>
          </button>
          <button className="collection-btn clear-btn" onClick={clearAllPinned} title={t('collection.clearAll')}>
            <Trash2 size={14} />
            <span>{t('collection.clearAll')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default CollectionPanel;
