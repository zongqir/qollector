import { useRef, useEffect, useMemo, useCallback, useState, forwardRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { Copy, Trash2 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import SearchBar from '../SearchBar';
import CompactCard from './CompactCard';
import { getTags, getSourceApp } from '../../utils/tagHelpers';
import { getDateRangeForPreset, dateStringToTimestamp, dateStringToEndTimestamp } from '../../utils/dateHelpers';
import { searchItems } from '../../services/clipboardService';

const MEMORY_PROBE_PREFIX = '[MemoryProbe]';
const toLen = (value) => (typeof value === 'string' ? value.length : 0);

const VirtuosoScroller = forwardRef(function VirtuosoScroller(props, ref) {
  const { className = '', ...rest } = props;
  return <div ref={ref} className={`history-stream-scroller ${className}`.trim()} {...rest} />;
});

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
  const { t } = useTranslation();
  const clickTimerRef = useRef(null);
  const filterProbeRef = useRef(null);
  const lastFilterProbeLogAtRef = useRef(0);

  const items = useAppStore(s => s.items);
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
  const selectedItemIds = useAppStore(s => s.selectedItemIds);

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
  const switchToCollection = useAppStore(s => s.switchToCollection);
  const loadMore = useAppStore(s => s.loadMore);
  const togglePin = useAppStore(s => s.togglePin);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleRevealInFolder = useAppStore(s => s.handleRevealInFolder);
  const toggleSelectItem = useAppStore(s => s.toggleSelectItem);
  const clearSelection = useAppStore(s => s.clearSelection);
  const deleteSelectedItems = useAppStore(s => s.deleteSelectedItems);
  const copySelectedItemsMerged = useAppStore(s => s.copySelectedItemsMerged);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);
  const toggleCollectionPanel = useAppStore(s => s.toggleCollectionPanel);
  const setHoverPreview = useAppStore(s => s.setHoverPreview);
  const clearHoverPreview = useAppStore(s => s.clearHoverPreview);
  const hoverPreviewItem = useAppStore(s => s.hoverPreviewItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);

  const setDebouncedSearchQuery = useAppStore(s => s.setDebouncedSearchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, setDebouncedSearchQuery]);

  const [backendSearchResults, setBackendSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const query = debouncedSearchQuery.trim();
    if (!query) {
      setBackendSearchResults(null);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    searchItems(query, 500)
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

  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

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

  const handleCardClick = useCallback((item, e) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      toggleSelectItem(item.id);
      return;
    }
    if (selectedItemIds.length > 0) {
      clearSelection();
    }
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (!collectionPanelEnabled && !isMiniMode) {
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
    if (isMiniMode) return;
    clickTimerRef.current = setTimeout(() => {
      setPanelMode('preview', item);
      clickTimerRef.current = null;
    }, 250);
  }, [setPanelMode, toggleSelectItem, clearSelection, selectedItemIds.length, collectionPanelEnabled, isMiniMode, setHoverPreview, hoverPreviewItem, clearHoverPreview]);

  const handleCardDoubleClick = useCallback((item, e) => {
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clearHoverPreview();
    handleCopyAndAutoPaste(item);
  }, [handleCopyAndAutoPaste, clearHoverPreview]);

  const handleStartExternalDrag = useCallback(async (item) => {
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
    if (externalPaths.length > 0 && !e.shiftKey) {
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
    if (!collectionPanelEnabled) {
      clearHoverPreview();
      return;
    }
    if (panelMode === 'preview') {
      switchToCollection();
    }
  }, [panelMode, switchToCollection, selectedItemIds.length, clearSelection, collectionPanelEnabled, clearHoverPreview]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (selectedItemIds.length === 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedItems();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedItemsMerged();
      } else if (e.key === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemIds.length, deleteSelectedItems, copySelectedItemsMerged, clearSelection]);

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

    return (
      <div
        className="history-stream-row"
        data-item-id={item.id}
        style={{ paddingBottom: `${rowGap}px` }}
        onClick={(e) => { e.stopPropagation(); handleCardClick(item, e); }}
        onDoubleClick={(e) => handleCardDoubleClick(item, e)}
      >
        <CompactCard
          item={item}
          isSelected={isSelected}
          isMultiSelected={isMultiSelected}
          isCopied={copiedItemId === item.id}
          onDragStart={handleDragStart}
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
    selectedItemIds,
    rowGap,
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
      />

      <div className="history-stream-content">
        {filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? t('search.noResults') : t('app.noItems')}
          </div>
        ) : (
          <Virtuoso
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

      {selectedItemIds.length > 0 && (
        <div className="multi-select-bar">
          <span className="multi-select-count">
            {t('multiSelect.selected', { count: selectedItemIds.length })}
          </span>
          <div className="multi-select-actions">
            <button className="multi-select-btn copy" onClick={copySelectedItemsMerged}>
              <Copy size={14} />
              <span>{t('multiSelect.mergeCopy')}</span>
            </button>
            <button className="multi-select-btn delete" onClick={deleteSelectedItems}>
              <Trash2 size={14} />
              <span>{t('multiSelect.delete')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryStream;
