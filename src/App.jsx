import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Settings from './Settings';

function App() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [processedItemIds, setProcessedItemIds] = useState(new Set());
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 }); // 虚拟滚动：只渲染前20项
  const contentRef = useRef(null);

  // 防抖搜索：延迟300ms执行搜索，避免每次输入都触发过滤
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    loadItems();
    initOcrService();

    // 每3秒自动刷新一次
    const interval = setInterval(() => {
      loadItems();
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, []); // 移除 showTagFilter 依赖

  // 单独处理点击外部关闭标签面板
  useEffect(() => {
    if (!showTagFilter) return;

    const handleClickOutside = (e) => {
      if (!e.target.closest('.tag-select-wrapper')) {
        setShowTagFilter(false);
      }
    };
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showTagFilter]);

  const initOcrService = async () => {
    try {
      // 尝试加载已保存的配置
      const savedConfig = await invoke('get_ocr_config');
      if (savedConfig && savedConfig.api_key) {
        await invoke('init_ocr_service', { config: savedConfig });
        console.log('OCR 服务初始化成功（使用已保存配置）');
      } else {
        console.log('OCR 服务未配置，请在设置中配置 API Key');
      }
    } catch (error) {
      console.error('OCR 服务初始化失败:', error);
    }
  };

  const loadItems = async () => {
    try {
      const result = await invoke('get_recent_items', { limit: 100 });
      setItems(result);

      // 自动为新的文本项目生成AI标签
      if (!loading) {
        autoGenerateAITags(result);
      }

      if (loading) setLoading(false);
    } catch (error) {
      console.error('加载失败:', error);
      if (loading) setLoading(false);
    }
  };

  // 自动为新项目生成AI标签 - 优化：限制并发数量
  const autoGenerateAITags = async (items) => {
    // 只处理前3个未处理的项目，避免一次性处理太多
    let processedCount = 0;
    const maxConcurrent = 3;

    for (const item of items) {
      if (processedCount >= maxConcurrent) break;

      // 只处理文本类型且未处理过的项目
      if (item.type_ === 'text' &&
          item.content &&
          !processedItemIds.has(item.id)) {

        // 检查是否已有AI标签
        const tags = getTags(item.tags);
        const hasAITags = tags.some(tag => tag.startsWith('AI:'));

        if (!hasAITags) {
          // 标记为已处理
          setProcessedItemIds(prev => new Set([...prev, item.id]));
          processedCount++;

          // 静默生成AI标签（不等待完成，避免阻塞）
          invoke('generate_ai_tags', { content: item.content })
            .then(aiTags => {
              if (aiTags && aiTags.length > 0) {
                const taggedAI = aiTags.map(tag => `AI:${tag}`);
                const newTags = [...tags, ...taggedAI];

                const updatedItem = {
                  ...item,
                  tags: JSON.stringify(newTags),
                  updated_at: Math.floor(Date.now() / 1000)
                };
                return invoke('update_item', { item: updatedItem });
              }
            })
            .catch(error => {
              console.error('自动AI标签生成失败(静默):', error);
            });
        } else {
          // 已有AI标签,标记为已处理
          setProcessedItemIds(prev => new Set([...prev, item.id]));
        }
      }
    }
  };

  const handleCopy = async (item, e) => {
    // 阻止事件冒泡，避免触发其他点击事件
    if (e) {
      e.stopPropagation();
    }
    try {
      await invoke('copy_item', { item });
      // 使用更简洁的提示方式
      console.log('已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败: ' + error);
    }
  };

  const togglePin = async (item, e) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      const newPinState = await invoke('toggle_pin_item', { id: item.id });
      console.log(`置顶状态已切换: ${newPinState}`);
      await loadItems();
    } catch (error) {
      console.error('切换置顶失败:', error);
      alert('切换置顶失败: ' + error);
    }
  };

  const toggleWindowAlwaysOnTop = async () => {
    try {
      const appWindow = getCurrentWindow();
      const newState = !isAlwaysOnTop;
      await appWindow.setAlwaysOnTop(newState);
      setIsAlwaysOnTop(newState);
      console.log(`窗口置顶状态: ${newState}`);
    } catch (error) {
      console.error('切换窗口置顶失败:', error);
      alert('切换窗口置顶失败: ' + error);
    }
  };

  // 删除功能已移除 - 剪贴板本身就是临时存储

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditContent(item.content || '');
    setEditNote(item.user_note || '');

    // Parse tags from JSON string
    try {
      const tags = item.tags ? JSON.parse(item.tags) : [];
      setEditTags(tags);
    } catch {
      setEditTags([]);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditNote('');
    setEditTags([]);
    setNewTag('');
  };

  const addTag = () => {
    if (newTag.trim() && !editTags.includes(newTag.trim())) {
      setEditTags([...editTags, newTag.trim()]);
      setNewTag('');
    }
  };

  const generateAITags = async (item) => {
    console.log('generateAITags called for item:', item.id);

    if (!item.content) {
      console.log('No content, skipping');
      return;
    }

    setGeneratingAI(item.id);
    try {
      console.log('Calling generate_ai_tags with content:', item.content.substring(0, 50));
      const aiTags = await invoke('generate_ai_tags', { content: item.content });
      console.log('AI tags received:', aiTags);

      if (aiTags && aiTags.length > 0) {
        // Add AI: prefix internally to distinguish AI-generated tags
        const taggedAI = aiTags.map(tag => `AI:${tag}`);
        const existingTags = getTags(item.tags);
        const newTags = [...existingTags, ...taggedAI.filter(t => !existingTags.includes(t))];

        console.log('Updating item with new tags:', newTags);
        const updatedItem = {
          ...item,
          tags: JSON.stringify(newTags),
          updated_at: Math.floor(Date.now() / 1000)
        };
        await invoke('update_item', { item: updatedItem });
        await loadItems();
        console.log('Tags updated successfully');
      } else {
        console.log('No AI tags generated or AI not enabled');
      }
    } catch (error) {
      console.error('AI 标签生成失败:', error);
      // 静默处理失败,不弹出提示
    } finally {
      setGeneratingAI(null);
    }
  };

  const handleOCR = async (item) => {
    if (!item.image_paths) return;

    console.log('=== OCR 识别开始 ===');
    console.log('图片项目:', item.id);

    setOcrProcessing(item.id);
    try {
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw || paths.original;

      console.log('图片路径:', imagePath);
      console.log('📤 调用 OCR 识别...');

      const ocrText = await invoke('recognize_and_update', {
        itemId: item.id,
        imagePath: imagePath
      });

      console.log('✅ OCR 识别成功');
      console.log('识别结果:', ocrText);
      await loadItems();
    } catch (error) {
      console.error('❌ OCR 识别失败:', error);
      alert('OCR 识别失败: ' + error);
    } finally {
      setOcrProcessing(null);
      console.log('=== OCR 识别结束 ===');
    }
  };

  const removeTag = (tagToRemove) => {
    setEditTags(editTags.filter(tag => tag !== tagToRemove));
  };

  const saveEdit = async (item) => {
    try {
      const updatedItem = {
        ...item,
        content: editContent,
        user_note: editNote,
        tags: JSON.stringify(editTags),
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      cancelEdit();
    } catch (error) {
      console.error('更新失败:', error);
      alert('更新失败: ' + error);
    }
  };

  const startEditNote = (item) => {
    setEditingNoteId(item.id);
    setEditNote(item.user_note || '');
  };

  const saveNote = async (item) => {
    try {
      const updatedItem = {
        ...item,
        user_note: editNote,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      setEditingNoteId(null);
      setEditNote('');
    } catch (error) {
      console.error('保存备注失败:', error);
      alert('保存备注失败: ' + error);
    }
  };

  const cancelNoteEdit = () => {
    setEditingNoteId(null);
    setEditNote('');
  };

  const formatDate = (timestamp) => {
    // Convert seconds to milliseconds
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN');
  };

  const getContentPreview = (content, maxLength = 100) => {
    if (!content) return '';
    return content;
  };

  const getFileList = (content) => {
    if (!content) return [];
    return content.split('\n').filter(p => p.trim());
  };

  const getFileName = (path) => {
    return path.split(/[/\\]/).pop() || path;
  };

  const getImageThumbnail = (imagePathsStr) => {
    if (!imagePathsStr) return '';
    try {
      const paths = JSON.parse(imagePathsStr);
      const thumbnailPath = paths.thumbnail || paths.original;
      const converted = convertFileSrc(thumbnailPath);
      return converted;
    } catch (e) {
      console.error('Error parsing image paths:', e);
      return convertFileSrc(imagePathsStr);
    }
  };

  const getImageOriginal = (imagePathsStr) => {
    if (!imagePathsStr) return '';
    try {
      const paths = JSON.parse(imagePathsStr);
      const originalPath = paths.original || paths.raw || paths.thumbnail;
      const converted = convertFileSrc(originalPath);
      return converted;
    } catch (e) {
      console.error('Error parsing image paths:', e);
      return convertFileSrc(imagePathsStr);
    }
  };

  const toggleExpand = (itemId, e) => {
    if (e) {
      e.stopPropagation();
    }
    setExpandedItemId(expandedItemId === itemId ? null : itemId);
  };

  const getTags = (tagsStr) => {
    if (!tagsStr) return [];
    try {
      return JSON.parse(tagsStr);
    } catch {
      return [];
    }
  };

  const getSourceApp = (metadataStr) => {
    if (!metadataStr) return 'Unknown';
    try {
      const metadata = JSON.parse(metadataStr);
      return metadata.source_app || 'Unknown';
    } catch {
      return 'Unknown';
    }
  };

  // 获取所有唯一标签（包括来源标签）- 使用 useMemo 缓存
  const allTags = useMemo(() => {
    const tagSet = new Set();
    items.forEach(item => {
      // 添加用户标签和AI标签
      const tags = getTags(item.tags);
      tags.forEach(tag => tagSet.add(tag));

      // 添加来源标签
      const sourceApp = getSourceApp(item.metadata);
      if (sourceApp && sourceApp !== 'Unknown') {
        tagSet.add(`来源:${sourceApp}`);
      }
    });
    return Array.from(tagSet).sort();
  }, [items]);

  // 过滤标签列表（用于搜索）- 使用 useMemo 缓存
  const filteredTagsList = useMemo(() => {
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allTags, tagSearchQuery]);

  const toggleTagFilter = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // 标签过滤（包括来源标签）
      if (selectedTags.length > 0) {
        const itemTags = getTags(item.tags);
        const sourceApp = getSourceApp(item.metadata);
        const sourceTag = sourceApp !== 'Unknown' ? `来源:${sourceApp}` : null;

        const allItemTags = sourceTag ? [...itemTags, sourceTag] : itemTags;

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
  }, [items, selectedTags, debouncedSearchQuery]);

  // 虚拟滚动：监听滚动事件，动态更新可见范围
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const scrollTop = contentElement.scrollTop;
      const itemHeight = 150; // 估算每个项目的平均高度
      const visibleCount = Math.ceil(contentElement.clientHeight / itemHeight);
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 5); // 提前渲染5个
      const end = Math.min(filteredItems.length, start + visibleCount + 10); // 多渲染10个

      setVisibleRange({ start, end });
    };

    contentElement.addEventListener('scroll', handleScroll);
    handleScroll(); // 初始化

    return () => {
      contentElement.removeEventListener('scroll', handleScroll);
    };
  }, [filteredItems.length]);

  // 可见的项目列表
  const visibleItems = useMemo(() => {
    // 如果项目少于30个，不使用虚拟滚动
    if (filteredItems.length < 30) return filteredItems;
    return filteredItems.slice(visibleRange.start, visibleRange.end);
  }, [filteredItems, visibleRange]);

  return (
    <div className="app">
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* 自定义标题栏 */}
      <div className="titlebar">
        <div data-tauri-drag-region className="titlebar-drag-area">
          <div className="titlebar-title">ClipBox</div>
        </div>
        <div className="titlebar-buttons">
          <button
            onClick={toggleWindowAlwaysOnTop}
            className={`titlebar-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
            title={isAlwaysOnTop ? '取消窗口置顶' : '窗口置顶'}
          >
            📌
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.minimize();
            }}
            className="titlebar-btn"
            title="最小化"
          >
            ─
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.toggleMaximize();
            }}
            className="titlebar-btn"
            title="最大化"
          >
            □
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.close();
            }}
            className="titlebar-btn close-btn"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      <header className="header">
        <div className="search-box">
          <input
            type="text"
            placeholder="搜索内容、标签、备注..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="clear-search">
              ✕
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className="tag-select-wrapper">
            <button
              onClick={() => setShowTagFilter(!showTagFilter)}
              className={`tag-select-btn ${selectedTags.length > 0 ? 'has-selection' : ''}`}
            >
              <span className="tag-icon">🏷️</span>
              <span className="tag-label">
                {selectedTags.length > 0 ? `已选 ${selectedTags.length} 个标签` : '筛选标签'}
              </span>
              <span className="dropdown-arrow">{showTagFilter ? '▲' : '▼'}</span>
            </button>
            {showTagFilter && (
              <div className="tag-dropdown">
                <div className="tag-dropdown-search">
                  <input
                    type="text"
                    placeholder="搜索标签..."
                    value={tagSearchQuery}
                    onChange={(e) => setTagSearchQuery(e.target.value)}
                    className="tag-search-input"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="tag-dropdown-list">
                  {filteredTagsList.length > 0 ? (
                    filteredTagsList.map(tag => {
                      const isAITag = tag.startsWith('AI:');
                      const isSourceTag = tag.startsWith('来源:');
                      const isUserTag = !isAITag && !isSourceTag;
                      const displayTag = isAITag ? tag.substring(3) : tag;
                      return (
                        <div
                          key={tag}
                          onClick={() => toggleTagFilter(tag)}
                          className={`tag-dropdown-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                        >
                          <span className="tag-check">{selectedTags.includes(tag) ? '✓' : ''}</span>
                          <span className={`tag-text ${isAITag ? 'ai-tag-text' : ''} ${isUserTag ? 'user-tag-text' : ''} ${isSourceTag ? 'source-tag-text' : ''}`}>
                            {isAITag && <span className="ai-badge">AI</span>}
                            {isUserTag && <span className="user-badge">M</span>}
                            {isSourceTag && <span className="source-badge">S</span>}
                            {displayTag}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="tag-dropdown-empty">未找到匹配的标签</div>
                  )}
                </div>
                {selectedTags.length > 0 && (
                  <div className="tag-dropdown-footer">
                    <button onClick={() => setSelectedTags([])} className="clear-selection-btn">
                      清除所有筛选
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <button onClick={() => setShowSettings(true)} className="settings-btn">
          ⚙️
        </button>
      </header>

      <div className="content" ref={contentRef}>
        {filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? '没有找到匹配的记录' : '暂无剪贴板记录'}
          </div>
        ) : (
          <div className="items-list">
            {visibleItems.map((item) => (
              <div key={item.id} className="item-card" title={`${formatDate(item.created_at)} · ${getSourceApp(item.metadata)}`}>
                {/* Tags display - 包括用户标签、AI标签和来源标签 */}
                {(getTags(item.tags).length > 0 || getSourceApp(item.metadata) !== 'Unknown') && (
                  <div className="item-tags">
                    {/* 来源标签 */}
                    {getSourceApp(item.metadata) !== 'Unknown' && (
                      <span className="tag source-tag">
                        {getSourceApp(item.metadata)}
                      </span>
                    )}
                    {/* 用户标签和AI标签 */}
                    {getTags(item.tags).map((tag, idx) => {
                      const isAITag = tag.startsWith('AI:');
                      const displayTag = isAITag ? tag.substring(3) : tag;
                      return (
                        <span key={idx} className={`tag ${isAITag ? 'ai-tag' : 'user-tag'}`}>
                          {displayTag}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* 备注显示/编辑 */}
                {editingNoteId === item.id ? (
                  <div className="note-edit-bar">
                    <span className="note-icon">📝</span>
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      className="note-edit-input"
                      rows={1}
                      placeholder="添加备注..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                          saveNote(item);
                        } else if (e.key === 'Escape') {
                          cancelNoteEdit();
                        }
                      }}
                    />
                    <button onClick={() => saveNote(item)} className="note-btn-save" title="保存 (Ctrl+Enter)">✓</button>
                    <button onClick={cancelNoteEdit} className="note-btn-cancel" title="取消 (Esc)">✕</button>
                  </div>
                ) : item.user_note ? (
                  <div
                    className="note-display-bar"
                    onClick={() => startEditNote(item)}
                    title="点击编辑备注"
                  >
                    <span className="note-icon">📝</span>
                    <span className="note-text">{item.user_note}</span>
                  </div>
                ) : null}

                {/* 工具栏 - 统一操作按钮 */}
                <div className="item-toolbar">
                  {/* 置顶按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(item, e);
                    }}
                    className={`toolbar-btn pin-btn ${item.is_pinned ? 'active' : ''}`}
                    title={item.is_pinned ? '取消置顶' : '置顶'}
                  >
                    <span className="toolbar-btn-icon">📌</span>
                    <span>{item.is_pinned ? '已置顶' : '置顶'}</span>
                  </button>

                  {/* AI标签按钮 - 仅文本类型 */}
                  {item.type_ === 'text' && item.content && (
                    <>
                      <div className="toolbar-divider"></div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          generateAITags(item);
                        }}
                        disabled={generatingAI === item.id}
                        className="toolbar-btn ai-btn"
                        title={generatingAI === item.id ? 'AI生成中...' : '用AI生成标签'}
                      >
                        <span className="toolbar-btn-icon">
                          {generatingAI === item.id ? '⏳' : '✨'}
                        </span>
                        <span>{generatingAI === item.id ? '生成中' : 'AI标签'}</span>
                      </button>
                    </>
                  )}

                  {/* OCR按钮 - 仅图片类型 */}
                  {item.type_ === 'image' && !item.ocr_text && (
                    <>
                      <div className="toolbar-divider"></div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOCR(item);
                        }}
                        disabled={ocrProcessing === item.id}
                        className="toolbar-btn ocr-btn"
                        title={ocrProcessing === item.id ? '识别中...' : '识别图片文字'}
                      >
                        <span className="toolbar-btn-icon">
                          {ocrProcessing === item.id ? '⏳' : '🔍'}
                        </span>
                        <span>{ocrProcessing === item.id ? '识别中' : 'OCR识别'}</span>
                      </button>
                    </>
                  )}

                  {/* 备注按钮 */}
                  <div className="toolbar-divider"></div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditNote(item);
                    }}
                    className={`toolbar-btn note-btn ${item.user_note ? 'has-note' : ''}`}
                    title={item.user_note ? '编辑备注' : '添加备注'}
                  >
                    <span className="toolbar-btn-icon">📝</span>
                    <span>{item.user_note ? '编辑备注' : '添加备注'}</span>
                  </button>

                  {/* 展开按钮 */}
                  <div className="toolbar-divider"></div>
                  <button
                    onClick={(e) => toggleExpand(item.id, e)}
                    className={`toolbar-btn expand-btn ${expandedItemId === item.id ? 'active' : ''}`}
                    title={expandedItemId === item.id ? '收起' : '展开全部'}
                  >
                    <span className="toolbar-btn-icon">{expandedItemId === item.id ? '▲' : '▼'}</span>
                    <span>{expandedItemId === item.id ? '收起' : '展开'}</span>
                  </button>
                </div>

                {editingId === item.id ? (
                  <div className="edit-mode">
                    {item.type_ !== 'image' && (
                      <>
                        <label className="edit-label">内容:</label>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="edit-textarea"
                          rows={5}
                        />
                      </>
                    )}

                    <label className="edit-label">备注:</label>
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      className="edit-textarea"
                      rows={2}
                      placeholder="添加备注..."
                    />

                    <label className="edit-label">标签:</label>
                    <div className="tags-editor">
                      <div className="tags-list">
                        {editTags.map((tag, idx) => (
                          <span key={idx} className="tag editable">
                            {tag}
                            <button onClick={() => removeTag(tag)} className="tag-remove">×</button>
                          </span>
                        ))}
                      </div>
                      <div className="tag-input-group">
                        <input
                          type="text"
                          value={newTag}
                          onChange={(e) => setNewTag(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && addTag()}
                          placeholder="添加标签..."
                          className="tag-input"
                        />
                        <button onClick={addTag} className="tag-add-btn">+</button>
                      </div>
                    </div>

                    <div className="edit-actions">
                      <button onClick={() => saveEdit(item)} className="save-btn">
                        ✓ 保存
                      </button>
                      <button onClick={cancelEdit} className="cancel-btn">
                        ✕ 取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className={`item-content clickable ${expandedItemId === item.id ? 'expanded' : ''}`}
                      onClick={(e) => handleCopy(item, e)}
                      onDoubleClick={() => startEdit(item)}
                    >
                      {/* Hover提示 */}
                      <div className="content-hover-tip">
                        <div className="hover-actions">单击复制 | 双击编辑</div>
                      </div>

                      {item.type_ === 'image' && item.image_paths ? (
                        <div className={`image-content-wrapper ${item.ocr_text ? 'has-ocr' : ''}`}>
                          <div className="image-container">
                            <img
                              src={expandedItemId === item.id ? getImageOriginal(item.image_paths) : getImageThumbnail(item.image_paths)}
                              alt="Clipboard image"
                              className="clipboard-image"
                              loading="lazy"
                            />
                          </div>
                          {item.ocr_text && (
                            <div className="ocr-text-container">
                              <div className="ocr-text-header">识别文本</div>
                              <div className="ocr-text-content">{item.ocr_text}</div>
                            </div>
                          )}
                        </div>
                      ) : item.type_ === 'file' ? (
                        <div className="file-list">
                          {getFileList(item.content).map((path, idx) => (
                            <div key={idx} className="file-item">
                              <span className="file-icon">📄</span>
                              <span className="file-name">{getFileName(path)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        getContentPreview(item.content)
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
