import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import Settings from './Settings';
import LockScreen from './LockScreen';
import DragDrop from './DragDrop';
import EditModal from './EditModal';
import { getTags, getSourceApp } from './utils/tagHelpers';
import { useSearch } from './hooks/useSearch';
import { useFilters } from './hooks/useFilters';
import { useNoteEdit } from './hooks/useNoteEdit';
import { useTagManagement } from './hooks/useTagManagement';
import { useEditModal } from './hooks/useEditModal';
import { useTheme } from './hooks/useTheme';
import { openImagePreview } from './services/windowService';
import { initOcrService } from './services/ocrService';
import { copyItemToClipboard, getRecentItemsLight, getMoreItems } from './services/clipboardService';
import { generateAITagsForItem, autoGenerateAITags as autoGenerateAITagsSvc } from './services/aiService';
import TitleBar from './components/TitleBar';
import SearchBar from './components/SearchBar';
import ItemCard from './components/ItemCard';

function App() {
  const { t, i18n } = useTranslation();
  const PAGE_SIZE = 50;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [pinBeforeMini, setPinBeforeMini] = useState(false);
  const [processedItemIds, setProcessedItemIds] = useState(new Set());
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [maxPinnedItems, setMaxPinnedItems] = useState(3);
  const contentRef = useRef(null);
  const clickTimerRef = useRef(null);
  const [copiedItemId, setCopiedItemId] = useState(null);
  const [isLocked, setIsLocked] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);

  // Theme hook
  const { themeMode, setThemeMode } = useTheme('system');

  // Custom hooks
  const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
  const {
    selectedTags, setSelectedTags,
    selectedType, setSelectedType,
    showFavoritesOnly, setShowFavoritesOnly,
    showTagFilter, setShowTagFilter,
    tagSearchQuery, setTagSearchQuery,
    toggleTagFilter, handleTagClick,
  } = useFilters();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  };

  const MINI_THRESHOLD = 450;

  const setMiniMode = async (enterMini) => {
    if (enterMini === isMiniMode) return;
    const appWindow = getCurrentWindow();
    if (enterMini) {
      setPinBeforeMini(isAlwaysOnTop);
      if (!isAlwaysOnTop) {
        await appWindow.setAlwaysOnTop(true);
        setIsAlwaysOnTop(true);
      }
    } else {
      if (!pinBeforeMini && isAlwaysOnTop) {
        await appWindow.setAlwaysOnTop(false);
        setIsAlwaysOnTop(false);
      }
    }
    setIsMiniMode(enterMini);
  };

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width <= MINI_THRESHOLD && !isMiniMode) {
        setMiniMode(true);
      } else if (width > MINI_THRESHOLD && isMiniMode) {
        setMiniMode(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMiniMode, isAlwaysOnTop, pinBeforeMini]);

  useEffect(() => {
    loadItems();
    initOcrService();
    loadConfigs();

    // 监听 Rust 后端的剪贴板变更事件，替代轮询
    let unlistenPromise = listen('clipboard-changed', () => {
      loadItems();
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []); // 移除 showTagFilter 依赖

  const loadConfigs = async () => {
    try {
      const [aiConfig, ocrConfig, generalConfig, hasLock] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_general_config'),
        invoke('has_lock_password')
      ]);
      setAiEnabled(aiConfig.enabled || false);
      setOcrEnabled(ocrConfig.enabled || false);
      setMaxPinnedItems(generalConfig.max_pinned_items || 3);
      if (generalConfig.theme_mode) {
        setThemeMode(generalConfig.theme_mode);
      }
      setHasPassword(hasLock);
      if (!hasLock) {
        setIsLocked(false);
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const processedItemIdsRef = useRef(processedItemIds);
  processedItemIdsRef.current = processedItemIds;

  const loadItems = useCallback(async () => {
    try {
      const result = await getRecentItemsLight(PAGE_SIZE);
      setItems(result);
      setHasMore(result.length >= PAGE_SIZE);

      if (!loadingRef.current) {
        autoGenerateAITagsSvc(result, processedItemIdsRef.current, setProcessedItemIds);
      }

      if (loadingRef.current) setLoading(false);
    } catch (error) {
      console.error(t('error.loadFailed', { error }));
      if (loadingRef.current) setLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await getMoreItems(PAGE_SIZE, items.length);
      if (more.length < PAGE_SIZE) setHasMore(false);
      setItems(prev => [...prev, ...more]);
    } catch (error) {
      console.error('加载更多失败:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, items.length]);

  const handleCopy = useCallback(async (item, e) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      await copyItemToClipboard(item);
      setCopiedItemId(item.id);
      setTimeout(() => setCopiedItemId(null), 1000);
      console.log('已复制到剪贴板');
    } catch (error) {
      console.error(t('error.copyFailed', { error }));
      alert(t('error.copyFailed', { error }));
    }
  }, [t]);

  // 处理内容区域的点击，区分单击和双击
  const handleCopyRef = useRef(handleCopy);
  handleCopyRef.current = handleCopy;

  const handleContentClick = useCallback((item, e) => {
    e.stopPropagation();

    // 清除之前的定时器
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    // 设置延迟执行单击操作（300ms）
    clickTimerRef.current = setTimeout(() => {
      // 所有类型都执行复制
      handleCopyRef.current(item, e);
      clickTimerRef.current = null;
    }, 300);
  }, []);

  // 处理双击
  const openEditModalRef = useRef(null);

  const handleContentDoubleClick = useCallback((item, e, isImage = false) => {
    e.stopPropagation();

    // 清除单击定时器，防止单击操作执行
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (isImage) {
      // 图片双击打开预览
      openImagePreview(item.image_paths, t);
    } else {
      // 文本双击打开编辑弹窗
      openEditModalRef.current(item);
    }
  }, [t]);

  const togglePin = useCallback(async (item, e) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      if (!item.is_pinned) {
        const pinnedCount = items.filter(i => i.is_pinned).length;
        if (pinnedCount >= maxPinnedItems) {
          console.log(t('error.pinLimitReached', { max: maxPinnedItems }));
        }
      }

      await invoke('toggle_pin_item', { id: item.id, maxPinned: maxPinnedItems });
      await loadItems();
    } catch (error) {
      console.error(t('error.togglePinFailed', { error }));
      alert(t('error.togglePinFailed', { error }));
    }
  }, [items, maxPinnedItems, t, loadItems]);

  const toggleWindowAlwaysOnTop = async () => {
    try {
      const appWindow = getCurrentWindow();
      const newState = !isAlwaysOnTop;
      await appWindow.setAlwaysOnTop(newState);
      setIsAlwaysOnTop(newState);
      console.log(`窗口置顶状态: ${newState}`);
    } catch (error) {
      console.error(t('error.toggleWindowPinFailed', { error }));
      alert(t('error.toggleWindowPinFailed', { error }));
    }
  };

  // 删除功能已移除 - 剪贴板本身就是临时存储

  const {
    showEditModal, editModalMode, editingItem,
    openEditModal, handleEditModalSave, handleEditModalCancel,
  } = useEditModal(loadItems, t);
  openEditModalRef.current = openEditModal;

  const {
    editingNoteId, editNote, setEditNote,
    startEditNote, saveNote, cancelNoteEdit,
  } = useNoteEdit(loadItems, t);

  const {
    addingTagItemId, newTagInput, setNewTagInput,
    startAddTag, cancelAddTag, addTagToItem, handleTagInputKeyDown,
  } = useTagManagement(loadItems, t);

  const generateAITags = useCallback(async (item) => {
    if (!item.content) return;

    setGeneratingAI(item.id);
    try {
      await generateAITagsForItem(item);
      await loadItems();
    } catch (error) {
      console.error('AI 标签生成失败:', error);
    } finally {
      setGeneratingAI(null);
    }
  }, [loadItems]);

  const handleOCR = useCallback(async (item) => {
    if (!item.image_paths) return;

    setOcrProcessing(item.id);
    try {
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw || paths.original;

      await invoke('recognize_and_update', {
        itemId: item.id,
        imagePath: imagePath
      });

      await loadItems();
    } catch (error) {
      console.error(t('error.ocrFailed', { error }));
      alert(t('error.ocrFailed', { error }));
    } finally {
      setOcrProcessing(null);
    }
  }, [t, loadItems]);

  // 切换收藏状态
  const toggleFavorite = useCallback(async (item, e) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      await invoke('toggle_favorite_item', { id: item.id });
      await loadItems();
    } catch (error) {
      console.error('切换收藏失败:', error);
    }
  }, [loadItems]);

  // 打开链接或文件
  const handleOpenItem = useCallback(async (item) => {
    try {
      await invoke('open_item', { id: item.id });
    } catch (error) {
      console.error(t('error.openFailed', { error }));
      alert(t('error.openFailed', { error }));
    }
  }, [t]);

  // 处理拖曳添加后的类型切换
  const handleTypeAdded = useCallback((type) => {
    // 自动切换到对应的类型 tab
    setSelectedType(type);
  }, [setSelectedType]);


  const toggleExpand = useCallback((itemId, e) => {
    if (e) {
      e.stopPropagation();
    }
    setExpandedItemId(prev => prev === itemId ? null : itemId);
  }, []);

  // 拖出功能：处理拖拽开始
  const handleDragStart = useCallback((item, e) => {
    // 设置纯文本数据
    const text = item.type_ === 'text' ? (item.content || '') :
                 item.type_ === 'file' ? (item.content || '') :
                 item.type_ === 'image' && item.ocr_text ? item.ocr_text :
                 (item.content || '');

    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copy';

    // 设置拖拽预览为小标签
    const dragEl = document.createElement('div');
    dragEl.textContent = text.substring(0, 40) + (text.length > 40 ? '...' : '');
    dragEl.style.cssText = 'position:absolute;top:-999px;padding:4px 8px;background:#333;color:#fff;border-radius:4px;font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;';
    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 0, 0);
    setTimeout(() => document.body.removeChild(dragEl), 0);
  }, []);


  // 获取所有唯一标签（包括来源标签和类型标签）- 使用 useMemo 缓存
  const allTags = useMemo(() => {
    const userTags = new Set();
    const aiTags = new Set();
    const sourceTags = new Set();
    const typeTags = new Set();

    items.forEach(item => {
      // 添加用户标签和AI标签
      const tags = getTags(item.tags);
      tags.forEach(tag => {
        if (tag.startsWith('AI:')) {
          aiTags.add(tag);
        } else {
          userTags.add(tag);
        }
      });

      // 添加来源标签（去掉"来源:"前缀）
      const sourceApp = getSourceApp(item.metadata);
      if (sourceApp && sourceApp !== 'Unknown') {
        sourceTags.add(`来源:${sourceApp}`);
      }

      // 添加类型标签
      if (item.type_) {
        const typeMap = {
          'text': '类型:文本',
          'image': '类型:图片',
          'file': '类型:文件',
          'link': '类型:链接'
        };
        const typeTag = typeMap[item.type_];
        if (typeTag) {
          typeTags.add(typeTag);
        }
      }
    });

    // 排序：类型标签 -> 人工标签 -> 来源标签 -> AI标签
    return [
      ...Array.from(typeTags).sort(),
      ...Array.from(userTags).sort(),
      ...Array.from(sourceTags).sort(),
      ...Array.from(aiTags).sort()
    ];
  }, [items]);

  // 获取所有用户标签（用于添加标签时的建议）
  const allUserTags = useMemo(() => {
    const userTags = new Set();
    items.forEach(item => {
      const tags = getTags(item.tags);
      tags.forEach(tag => {
        if (!tag.startsWith('AI:')) {
          userTags.add(tag);
        }
      });
    });
    return Array.from(userTags).sort();
  }, [items]);

  // 过滤标签建议 - 改进：没有输入时也显示所有标签
  const filteredUserTags = useMemo(() => {
    if (!newTagInput.trim()) return allUserTags; // 显示所有标签
    const query = newTagInput.toLowerCase();
    return allUserTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allUserTags, newTagInput]);

  // 过滤标签列表（用于搜索）- 使用 useMemo 缓存
  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // 收藏筛选（优先级最高）
      if (showFavoritesOnly && !item.is_favorite) {
        return false;
      }

      // 独立类型筛选
      if (selectedType !== 'all' && item.type_ !== selectedType) {
        return false;
      }

      // 标签过滤（包括来源标签和类型标签）
      if (selectedTags.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceApp = getSourceApp(item.metadata);
        const sourceTag = sourceApp !== 'Unknown' ? `来源:${sourceApp}` : null;

        // 类型标签
        const typeMap = {
          'text': '类型:文本',
          'image': '类型:图片',
          'file': '类型:文件',
          'link': '类型:链接'
        };
        const typeTag = typeMap[item.type_];

        const allItemTags = [
          ...itemTags,
          ...(sourceTag ? [sourceTag] : []),
          ...(typeTag ? [typeTag] : [])
        ];

        const hasSelectedTag = selectedTags.some(selectedTag =>
          allItemTags.includes(selectedTag)
        );
        if (!hasSelectedTag) return false;
      }

      // 文本搜索
      if (!debouncedSearchQuery.trim()) return true;

      const query = debouncedSearchQuery.toLowerCase();

      // Search in content
      if (item.content && item.content.toLowerCase().includes(query)) return true;

      // Search in note
      if (item.user_note && item.user_note.toLowerCase().includes(query)) return true;

      // Search in tags
      const tags = getTags(item.tags);
      if (tags.some(tag => tag.toLowerCase().includes(query))) return true;

      // Search in source app
      if (getSourceApp(item.metadata).toLowerCase().includes(query)) return true;

      // Search in OCR text
      if (item.ocr_text && item.ocr_text.toLowerCase().includes(query)) return true;

      return false;
    });
  }, [items, selectedTags, selectedType, debouncedSearchQuery, showFavoritesOnly]);

  // 虚拟滚动
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => contentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  // 滚动到底部时自动加载更多
  const lastVirtualItem = virtualizer.getVirtualItems().at(-1);
  useEffect(() => {
    if (!lastVirtualItem) return;
    if (lastVirtualItem.index >= filteredItems.length - 5) {
      loadMore();
    }
  }, [lastVirtualItem?.index, filteredItems.length, loadMore]);

  if (isLocked && hasPassword) {
    return <LockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className={`app ${isMiniMode ? 'mini-mode' : ''}`}>
      {showSettings && <Settings onClose={() => setShowSettings(false)} themeMode={themeMode} onThemeModeChange={setThemeMode} onConfigChange={loadConfigs} />}
      <DragDrop onItemAdded={loadItems} onTypeAdded={handleTypeAdded} />

      {showEditModal && (
        <EditModal
          item={editingItem}
          mode={editModalMode}
          onSave={handleEditModalSave}
          onCancel={handleEditModalCancel}
        />
      )}

      <TitleBar
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={toggleWindowAlwaysOnTop}
        onOpenQuickInput={() => openEditModal()}
        isMiniMode={isMiniMode}
        onToggleMiniMode={() => setMiniMode(!isMiniMode)}
      />

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

      <div className="content" ref={contentRef}>
        {filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? t('search.noResults') : t('app.noItems')}
          </div>
        ) : (
          <div className="items-list" style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index];
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
                >
                  <ItemCard
                    item={item}
                    expandedItemId={expandedItemId}
                    copiedItemId={copiedItemId}
                    selectedTags={selectedTags}
                    addingTagItemId={addingTagItemId}
                    newTagInput={newTagInput}
                    onNewTagInputChange={setNewTagInput}
                    onTagInputKeyDown={handleTagInputKeyDown}
                    onStartAddTag={startAddTag}
                    onCancelAddTag={cancelAddTag}
                    onAddTagToItem={addTagToItem}
                    filteredUserTags={filteredUserTags}
                    onTagClick={handleTagClick}
                    editingNoteId={editingNoteId}
                    editNote={editNote}
                    onEditNoteChange={setEditNote}
                    onStartEditNote={startEditNote}
                    onSaveNote={saveNote}
                    onCancelNoteEdit={cancelNoteEdit}
                    onDragStart={handleDragStart}
                    onTogglePin={togglePin}
                    onToggleFavorite={toggleFavorite}
                    onGenerateAITags={generateAITags}
                    generatingAI={generatingAI}
                    aiEnabled={aiEnabled}
                    onHandleOCR={handleOCR}
                    ocrProcessing={ocrProcessing}
                    ocrEnabled={ocrEnabled}
                    onToggleExpand={toggleExpand}
                    onOpenItem={handleOpenItem}
                    onContentClick={handleContentClick}
                    onContentDoubleClick={handleContentDoubleClick}
                    language={i18n.language}
                    maxPinnedItems={maxPinnedItems}
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

export default App;
