import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
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
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(null);
  const [ocrProcessing, setOcrProcessing] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');

  useEffect(() => {
    loadItems();
    initOcrService();

    // 每3秒自动刷新一次
    const interval = setInterval(() => {
      loadItems();
    }, 3000);

    // 点击外部关闭标签过滤面板
    const handleClickOutside = (e) => {
      if (showTagFilter && !e.target.closest('.tag-select-wrapper')) {
        setShowTagFilter(false);
      }
    };
    document.addEventListener('click', handleClickOutside);

    return () => {
      clearInterval(interval);
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
      if (loading) setLoading(false);
    } catch (error) {
      console.error('加载失败:', error);
      if (loading) setLoading(false);
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
        // Add AI: prefix to distinguish AI-generated tags
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
        alert('AI 未启用或未生成标签，请检查设置');
      }
    } catch (error) {
      console.error('AI 标签生成失败:', error);
      alert('AI 标签生成失败: ' + error);
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

  // 获取所有唯一标签（包括来源标签）
  const getAllTags = () => {
    const tagSet = new Set();
    items.forEach(item => {
      // 添加用户标签
      const tags = getTags(item.tags);
      tags.forEach(tag => tagSet.add(tag));

      // 添加来源标签
      const sourceApp = getSourceApp(item.metadata);
      if (sourceApp && sourceApp !== 'Unknown') {
        tagSet.add(`来源:${sourceApp}`);
      }
    });
    return Array.from(tagSet).sort();
  };

  // 过滤标签列表（用于搜索）
  const getFilteredTags = () => {
    const allTags = getAllTags();
    if (!tagSearchQuery.trim()) return allTags;
    const query = tagSearchQuery.toLowerCase();
    return allTags.filter(tag => tag.toLowerCase().includes(query));
  };

  const toggleTagFilter = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const filteredItems = items.filter(item => {
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
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();

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

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="app">
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      <header className="header">
        <h1>📋 ClipBox</h1>
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
        {getAllTags().length > 0 && (
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
                  {getFilteredTags().length > 0 ? (
                    getFilteredTags().map(tag => (
                      <div
                        key={tag}
                        onClick={() => toggleTagFilter(tag)}
                        className={`tag-dropdown-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                      >
                        <span className="tag-check">{selectedTags.includes(tag) ? '✓' : ''}</span>
                        <span className="tag-text">{tag}</span>
                      </div>
                    ))
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

      <div className="content">
        {filteredItems.length === 0 ? (
          <div className="empty">
            {searchQuery ? '没有找到匹配的记录' : '暂无剪贴板记录'}
          </div>
        ) : (
          <div className="items-list">
            {filteredItems.map((item) => (
              <div key={item.id} className="item-card" title={`${formatDate(item.created_at)} · ${getSourceApp(item.metadata)}`}>
                {/* Tags display */}
                {getTags(item.tags).length > 0 && (
                  <div className="item-tags">
                    {getTags(item.tags).map((tag, idx) => (
                      <span key={idx} className="tag">{tag}</span>
                    ))}
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
                      className="item-content clickable"
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
                              src={getImageThumbnail(item.image_paths)}
                              alt="Clipboard image"
                              className="clipboard-image"
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
