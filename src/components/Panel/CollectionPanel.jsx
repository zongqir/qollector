import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Package } from 'lucide-react';
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
import SortableCollectionCard from './SortableCollectionCard';
import CollectionQuickNoteSection from './CollectionQuickNoteSection';
import CollectionMultiSelectBar from './CollectionMultiSelectBar';
import CollectionQuickActionsBar from './CollectionQuickActionsBar';
import useCollectionQuickActions from './hooks/useCollectionQuickActions';
import useCollectionBatchActions from './hooks/useCollectionBatchActions';

function CollectionPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const selectionAnchorIndexRef = useRef(-1);

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

  const handleExpandedNoteKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && event.ctrlKey && quickNote.trim()) {
      handleExpandedSubmit();
    }
    if (event.key === 'Escape') {
      setIsExpanded(false);
    }
  }, [quickNote, handleExpandedSubmit]);

  const batchActions = useCollectionBatchActions({
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

  const quickActions = useCollectionQuickActions({
    pinnedItems,
    items,
    aiEnabled,
    uiLanguage: i18n.language,
    selectionMode: selectedPinnedIds.length > 0,
    addQuickNote,
    loadItems,
    setPanelMode,
    t,
  });

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
        <CollectionQuickActionsBar
          t={t}
          setPanelMode={setPanelMode}
          quickOutputTask={quickActions.quickOutputTask}
          quickOutputRunning={quickActions.quickOutputRunning}
          showQuickOutputMenu={quickActions.showQuickOutputMenu}
          setShowQuickOutputMenu={quickActions.setShowQuickOutputMenu}
          quickOutputMenuRef={quickActions.quickOutputMenuRef}
          quickOutputTasks={quickActions.quickOutputTasks}
          showCollectionMoreMenu={quickActions.showCollectionMoreMenu}
          setShowCollectionMoreMenu={quickActions.setShowCollectionMoreMenu}
          collectionMoreMenuRef={quickActions.collectionMoreMenuRef}
          activeAction={quickActions.activeAction}
          feedback={quickActions.feedback}
          lastClearedPinnedIds={quickActions.lastClearedPinnedIds}
          hasSnapshot={quickActions.hasSnapshot}
          handleRunQuickOutput={quickActions.handleRunQuickOutput}
          handleQuickOutputMenuSelect={quickActions.handleQuickOutputMenuSelect}
          handleSaveSnapshot={quickActions.handleSaveSnapshot}
          handleRestoreSnapshot={quickActions.handleRestoreSnapshot}
          handleExportCollection={quickActions.handleExportCollection}
          handleDedupeCollection={quickActions.handleDedupeCollection}
          handleClearAll={quickActions.handleClearAll}
          handleUndoClearAll={quickActions.handleUndoClearAll}
        />
      )}
    </div>
  );
}

export default CollectionPanel;

