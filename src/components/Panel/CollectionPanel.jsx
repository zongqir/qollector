import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package,
  Star,
  Calendar,
  Check,
  X,
  Type,
  Image,
  File,
  Link,
  Braces,
  Layers,
  ChevronDown,
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
import SortableCollectionCard from './SortableCollectionCard';
import CollectionQuickNoteSection from './CollectionQuickNoteSection';
import CollectionMultiSelectBar from './CollectionMultiSelectBar';
import CollectionQuickActionsBar from './CollectionQuickActionsBar';
import useCollectionQuickActions from './hooks/useCollectionQuickActions';
import useCollectionBatchActions from './hooks/useCollectionBatchActions';
import {
  getDateRangeForPreset,
  dateStringToTimestamp,
  dateStringToEndTimestamp,
} from '../../utils/dateHelpers';

function CollectionPanel() {
  const { t, i18n } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedPinnedIds, setSelectedPinnedIds] = useState([]);
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('');
  const [collectionSelectedType, setCollectionSelectedType] = useState('all');
  const [showCollectionTypeFilter, setShowCollectionTypeFilter] = useState(false);
  const [showFavoritesOnlyInCollection, setShowFavoritesOnlyInCollection] = useState(false);
  const [collectionSelectedDateRange, setCollectionSelectedDateRange] = useState(null);
  const [showCollectionDateFilter, setShowCollectionDateFilter] = useState(false);
  const [collectionCustomDateStart, setCollectionCustomDateStart] = useState('');
  const [collectionCustomDateEnd, setCollectionCustomDateEnd] = useState('');
  const selectionAnchorIndexRef = useRef(-1);
  const collectionTypeWrapperRef = useRef(null);
  const collectionDateWrapperRef = useRef(null);

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
  const setCardBackground = useAppStore(s => s.setCardBackground);
  const toggleCollectionPanel = useAppStore(s => s.toggleCollectionPanel);

  const allPinnedItems = useMemo(() => {
    const pinned = items.filter(i => i.is_pinned);
    if (!pinnedOrder) return pinned;
    const orderMap = new Map(pinnedOrder.map((id, idx) => [id, idx]));
    return [...pinned].sort((a, b) => {
      const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return aIdx - bIdx;
    });
  }, [items, pinnedOrder]);

  const pinnedItems = useMemo(() => {
    const normalizedQuery = collectionSearchQuery.trim().toLowerCase();
    return allPinnedItems.filter((item) => {
      if (normalizedQuery) {
        const searchTarget = [
          item.content,
          item.user_note,
          item.ocr_text,
          item.tags,
          item.type_,
        ]
          .filter(Boolean)
          .join('\n')
          .toLowerCase();
        if (!searchTarget.includes(normalizedQuery)) return false;
      }

      if (collectionSelectedType === 'code') {
        if (!item.code_language) return false;
      } else if (collectionSelectedType !== 'all' && item.type_ !== collectionSelectedType) {
        return false;
      }

      if (showFavoritesOnlyInCollection && !item.is_favorite) return false;

      if (collectionSelectedDateRange) {
        const createdAt = Number(item.created_at || 0);
        if (collectionSelectedDateRange.start != null && createdAt < collectionSelectedDateRange.start) return false;
        if (collectionSelectedDateRange.end != null && createdAt > collectionSelectedDateRange.end) return false;
      }

      return true;
    });
  }, [
    allPinnedItems,
    collectionSearchQuery,
    collectionSelectedType,
    showFavoritesOnlyInCollection,
    collectionSelectedDateRange,
  ]);

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

  const typeOptions = [
    { key: 'all', icon: <Layers size={14} /> },
    { key: 'text', icon: <Type size={14} /> },
    { key: 'image', icon: <Image size={14} /> },
    { key: 'file', icon: <File size={14} /> },
    { key: 'link', icon: <Link size={14} /> },
    { key: 'code', icon: <Braces size={14} /> },
  ];
  const selectedTypeOption = typeOptions.find(({ key }) => key === collectionSelectedType) || typeOptions[0];

  const datePresets = [
    { key: 'today', label: t('toolbar.dateToday'), badge: '1d' },
    { key: 'yesterday', label: t('toolbar.dateYesterday'), badge: '1d' },
    { key: '7d', label: t('toolbar.dateLast7Days'), badge: '7d' },
    { key: '30d', label: t('toolbar.dateLast30Days'), badge: '30d' },
    { key: 'custom', label: t('toolbar.dateCustomRange'), badge: '...' },
  ];

  const collectionDateBadgeText = collectionSelectedDateRange
    ? (collectionSelectedDateRange.preset === 'custom'
      ? '...'
      : datePresets.find(preset => preset.key === collectionSelectedDateRange.preset)?.badge || '')
    : '';

  const hasCollectionFilters = Boolean(
    collectionSearchQuery.trim()
    || collectionSelectedType !== 'all'
    || showFavoritesOnlyInCollection
    || collectionSelectedDateRange != null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = allPinnedItems.findIndex(i => i.id === active.id);
    const newIndex = allPinnedItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(allPinnedItems.map(i => i.id), oldIndex, newIndex);
    setPinnedOrder(newOrder);
  }, [allPinnedItems]);

  const handleCollectionTypeChange = useCallback((nextType) => {
    setCollectionSelectedType(nextType);
    setShowCollectionTypeFilter(false);
  }, []);

  const handleSelectCollectionDatePreset = useCallback((preset) => {
    if (preset === 'custom') {
      setCollectionSelectedDateRange({ preset: 'custom', start: null, end: null });
      return;
    }

    const range = getDateRangeForPreset(preset);
    if (range) {
      setCollectionSelectedDateRange(range);
    }
  }, []);

  const handleApplyCollectionCustomDateRange = useCallback(() => {
    const start = dateStringToTimestamp(collectionCustomDateStart);
    const end = dateStringToEndTimestamp(collectionCustomDateEnd);
    if (start != null || end != null) {
      setCollectionSelectedDateRange({ preset: 'custom', start, end });
    }
  }, [collectionCustomDateStart, collectionCustomDateEnd]);

  const handleClearCollectionDateFilter = useCallback(() => {
    setCollectionSelectedDateRange(null);
    setCollectionCustomDateStart('');
    setCollectionCustomDateEnd('');
    setShowCollectionDateFilter(false);
  }, []);

  const handleClearCollectionFilters = useCallback(() => {
    setCollectionSearchQuery('');
    setCollectionSelectedType('all');
    setShowCollectionTypeFilter(false);
    setShowFavoritesOnlyInCollection(false);
    handleClearCollectionDateFilter();
  }, [handleClearCollectionDateFilter]);

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

  useEffect(() => {
    if (!showCollectionTypeFilter) return undefined;
    const handleClickOutside = (event) => {
      if (!collectionTypeWrapperRef.current?.contains(event.target)) {
        setShowCollectionTypeFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCollectionTypeFilter]);

  useEffect(() => {
    if (!showCollectionDateFilter) return undefined;
    const handleClickOutside = (event) => {
      if (!collectionDateWrapperRef.current?.contains(event.target)) {
        setShowCollectionDateFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCollectionDateFilter]);

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
    collectionPanelRef.current?.focus();

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
    collectionPanelRef.current?.focus();
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

  const collectionPanelRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const panel = collectionPanelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (!panel.contains(e.target) && !panel.contains(active) && active !== panel) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (pinnedItems.length === 0) return;
        e.preventDefault();
        setSelectedPinnedIds(pinnedItems.map(item => item.id));
        selectionAnchorIndexRef.current = 0;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pinnedItems]);

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
    pinnedItems: allPinnedItems,
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

  if (allPinnedItems.length === 0) {
    return (
      <div className="collection-panel" ref={collectionPanelRef} tabIndex={-1} onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
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
    <div className="collection-panel" ref={collectionPanelRef} tabIndex={-1} onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
      {quickNoteSection}
      <div className="collection-filter-row">
        <div className="collection-search-box">
          <input
            type="text"
            className="collection-search-input"
            placeholder={t('search.placeholder')}
            value={collectionSearchQuery}
            onChange={(event) => setCollectionSearchQuery(event.target.value)}
          />
          {collectionSearchQuery && (
            <button
              onClick={() => setCollectionSearchQuery('')}
              className="collection-search-clear-btn"
              title={t('toolbar.clearFilter')}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="collection-type-filter-wrapper type-select-wrapper" ref={collectionTypeWrapperRef}>
          <button
            onClick={() => {
              setShowCollectionDateFilter(false);
              setShowCollectionTypeFilter(current => !current);
            }}
            className={`header-icon-btn type-select-btn ${collectionSelectedType !== 'all' ? 'has-selection' : ''} ${showCollectionTypeFilter ? 'active' : ''}`}
            title={t('toolbar.filterType')}
          >
            {selectedTypeOption.icon}
            <span className="type-select-text">{t(`search.typeFilter.${collectionSelectedType}`)}</span>
            <ChevronDown size={12} className={`type-select-arrow ${showCollectionTypeFilter ? 'open' : ''}`} />
          </button>
          {showCollectionTypeFilter && (
            <div className="type-dropdown">
              <div className="type-dropdown-list">
                {typeOptions.map(({ key, icon }) => (
                  <div
                    key={key}
                    onClick={() => handleCollectionTypeChange(key)}
                    className={`type-dropdown-item ${collectionSelectedType === key ? 'selected' : ''}`}
                  >
                    <span className="type-check">
                      {collectionSelectedType === key ? <Check size={14} /> : ''}
                    </span>
                    <span className="type-option-icon">{icon}</span>
                    <span className="type-option-label">{t(`search.typeFilter.${key}`)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowFavoritesOnlyInCollection(current => !current)}
          className={`header-icon-btn ${showFavoritesOnlyInCollection ? 'active fav-active' : ''}`}
          title={showFavoritesOnlyInCollection ? t('toolbar.showAll') : t('toolbar.showFavorites')}
        >
          <Star size={15} fill={showFavoritesOnlyInCollection ? 'currentColor' : 'none'} />
        </button>

        <div className="date-select-wrapper" ref={collectionDateWrapperRef}>
          <button
            onClick={() => {
              setShowCollectionTypeFilter(false);
              setShowCollectionDateFilter(current => !current);
            }}
            className={`header-icon-btn ${collectionSelectedDateRange ? 'active' : ''}`}
            title={t('toolbar.dateFilter')}
          >
            <Calendar size={15} />
            {collectionSelectedDateRange && (
              <span className="icon-btn-badge">{collectionDateBadgeText}</span>
            )}
          </button>
          {showCollectionDateFilter && (
            <div className="date-dropdown">
              <div className="date-dropdown-presets">
                {datePresets.map(({ key, label }) => (
                  <div
                    key={key}
                    onClick={() => handleSelectCollectionDatePreset(key)}
                    className={`date-dropdown-item ${collectionSelectedDateRange?.preset === key ? 'selected' : ''}`}
                  >
                    <span className="date-check">
                      {collectionSelectedDateRange?.preset === key ? <Check size={14} /> : ''}
                    </span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              {collectionSelectedDateRange?.preset === 'custom' && (
                <div className="date-dropdown-custom">
                  <div className="date-input-row">
                    <label>{t('toolbar.dateStart')}</label>
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={collectionCustomDateStart}
                      onChange={(event) => setCollectionCustomDateStart(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                  <div className="date-input-row">
                    <label>{t('toolbar.dateEnd')}</label>
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={collectionCustomDateEnd}
                      onChange={(event) => setCollectionCustomDateEnd(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                  <button
                    className="date-apply-btn"
                    disabled={!collectionCustomDateStart && !collectionCustomDateEnd}
                    onClick={handleApplyCollectionCustomDateRange}
                  >
                    {t('toolbar.dateApply')}
                  </button>
                </div>
              )}
              {collectionSelectedDateRange && (
                <div className="date-dropdown-footer">
                  <button onClick={handleClearCollectionDateFilter} className="clear-selection-btn">
                    {t('toolbar.clearDateFilter')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {hasCollectionFilters && (
          <button
            className="clear-filter-btn collection-type-clear-btn"
            onClick={handleClearCollectionFilters}
            title={t('toolbar.clearAll')}
          >
            <X size={12} />
            <span>{t('toolbar.clearFilter')}</span>
          </button>
        )}
      </div>

      {pinnedItems.length === 0 ? (
        <div className="collection-filter-empty">
          <div className="collection-empty-icon">
            <Package size={42} strokeWidth={1} />
          </div>
          <div className="collection-empty-title">{t('collection.noFilteredItems')}</div>
          <button className="clear-filter-btn" onClick={handleClearCollectionFilters}>
            <X size={12} /> {t('toolbar.clearFilter')}
          </button>
        </div>
      ) : (
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
                  onSetCardBackground={setCardBackground}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
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

