import { useRef, useEffect, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import useAppStore from '../../store/useAppStore';
import SearchBar from '../SearchBar';
import CompactCard from './CompactCard';
import { getTags, getSourceApp } from '../../utils/tagHelpers';

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
  const contentRef = useRef(null);
  const clickTimerRef = useRef(null);

  const items = useAppStore(s => s.items);
  const searchQuery = useAppStore(s => s.searchQuery);
  const debouncedSearchQuery = useAppStore(s => s.debouncedSearchQuery);
  const selectedType = useAppStore(s => s.selectedType);
  const selectedTags = useAppStore(s => s.selectedTags);
  const showFavoritesOnly = useAppStore(s => s.showFavoritesOnly);
  const previewItem = useAppStore(s => s.previewItem);
  const panelMode = useAppStore(s => s.panelMode);

  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const setSelectedTags = useAppStore(s => s.setSelectedTags);
  const setShowFavoritesOnly = useAppStore(s => s.setShowFavoritesOnly);
  const setShowTagFilter = useAppStore(s => s.setShowTagFilter);
  const setTagSearchQuery = useAppStore(s => s.setTagSearchQuery);
  const showTagFilter = useAppStore(s => s.showTagFilter);
  const tagSearchQuery = useAppStore(s => s.tagSearchQuery);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const toggleTagFilter = useAppStore(s => s.toggleTagFilter);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const handleCopy = useAppStore(s => s.handleCopy);
  const switchToCollection = useAppStore(s => s.switchToCollection);
  const loadMore = useAppStore(s => s.loadMore);
  const togglePin = useAppStore(s => s.togglePin);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);

  const setDebouncedSearchQuery = useAppStore(s => s.setDebouncedSearchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, setDebouncedSearchQuery]);

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

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (showFavoritesOnly && !item.is_favorite) return false;
      if (selectedType !== 'all' && item.type_ !== selectedType) return false;

      if (selectedTags.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceApp = getSourceApp(item.metadata);
        const sourceTag = sourceApp !== 'Unknown' ? `来源:${sourceApp}` : null;
        const typeMap = { text: '类型:文本', image: '类型:图片', file: '类型:文件', link: '类型:链接' };
        const typeTag = typeMap[item.type_];
        const allItemTags = [...itemTags, ...(sourceTag ? [sourceTag] : []), ...(typeTag ? [typeTag] : [])];
        if (!selectedTags.some(st => allItemTags.includes(st))) return false;
      }

      if (!debouncedSearchQuery.trim()) return true;
      const query = debouncedSearchQuery.toLowerCase();
      if (item.content && item.content.toLowerCase().includes(query)) return true;
      if (item.user_note && item.user_note.toLowerCase().includes(query)) return true;
      const tags = getTags(item.tags);
      if (tags.some(tag => tag.toLowerCase().includes(query))) return true;
      if (getSourceApp(item.metadata).toLowerCase().includes(query)) return true;
      if (item.ocr_text && item.ocr_text.toLowerCase().includes(query)) return true;
      return false;
    });
  }, [items, selectedTags, selectedType, debouncedSearchQuery, showFavoritesOnly]);

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => contentRef.current,
    estimateSize: () => 90,
    overscan: 5,
  });

  const lastVirtualItem = virtualizer.getVirtualItems().at(-1);
  useEffect(() => {
    if (!lastVirtualItem) return;
    if (lastVirtualItem.index >= filteredItems.length - 5) {
      loadMore();
    }
  }, [lastVirtualItem?.index, filteredItems.length, loadMore]);

  const handleCardClick = useCallback((item, e) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = setTimeout(() => {
      setPanelMode('preview', item);
      clickTimerRef.current = null;
    }, 250);
  }, [setPanelMode]);

  const handleCardDoubleClick = useCallback((item, e) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    handleCopy(item);
  }, [handleCopy]);

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
    if (panelMode === 'preview') {
      switchToCollection();
    }
  }, [panelMode, switchToCollection]);

  return (
    <div className="history-stream" style={style} onClick={handleStreamClick}>
      <SearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        showFavoritesOnly={showFavoritesOnly}
        onToggleFavorites={() => setShowFavoritesOnly(!showFavoritesOnly)}
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
      />

      <div className="history-stream-content" ref={contentRef}>
        {filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? t('search.noResults') : t('app.noItems')}
          </div>
        ) : (
          <div
            className="history-stream-list"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index];
              const isSelected = panelMode === 'preview' && previewItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={(e) => { e.stopPropagation(); handleCardClick(item, e); }}
                  onDoubleClick={(e) => handleCardDoubleClick(item, e)}
                >
                  <CompactCard
                    item={item}
                    isSelected={isSelected}
                    onDragStart={handleDragStart}
                    onStartExternalDrag={handleStartExternalDrag}
                    onTogglePin={togglePin}
                    onToggleFavorite={toggleFavorite}
                    onOpenItem={handleOpenItem}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryStream;
