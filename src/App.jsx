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

  useEffect(() => {
    loadItems();
    initOcrService();

    // 每3秒自动刷新一次
    const interval = setInterval(() => {
      loadItems();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

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

  const handleCopy = async (item) => {
    try {
      await invoke('copy_item', { item });
      alert('已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败: ' + error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
      await invoke('delete_item', { id });
      await loadItems();
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败: ' + error);
    }
  };

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
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
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

  const filteredItems = items.filter(item => {
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
        <button onClick={() => setShowSettings(true)} className="settings-btn">
          ⚙️ 设置
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
              <div key={item.id} className="item-card">
                <div className="item-header">
                  <div className="item-header-left">
                    <span className="item-type">{item.type_}</span>
                    <span className="item-source">来源: {getSourceApp(item.metadata)}</span>
                  </div>
                  <span className="item-date">{formatDate(item.created_at)}</span>
                </div>

                {/* Tags display */}
                {getTags(item.tags).length > 0 && (
                  <div className="item-tags">
                    {getTags(item.tags).map((tag, idx) => (
                      <span key={idx} className="tag">{tag}</span>
                    ))}
                  </div>
                )}

                {/* AI Tag button */}
                {item.type_ === 'text' && item.content && (
                  <button
                    onClick={() => generateAITags(item)}
                    disabled={generatingAI === item.id}
                    className="ai-tag-btn"
                  >
                    {generatingAI === item.id ? '🤖 生成中...' : '🤖 AI 标签'}
                  </button>
                )}

                {/* OCR button and result for images */}
                {item.type_ === 'image' && (
                  <div className="ocr-section">
                    {item.ocr_text ? (
                      <div className="ocr-result">
                        <div className="ocr-label">🔍 识别文本:</div>
                        <div className="ocr-text">{item.ocr_text}</div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleOCR(item)}
                        disabled={ocrProcessing === item.id}
                        className="ocr-btn"
                      >
                        {ocrProcessing === item.id ? '🔍 识别中...' : '🔍 识别文字'}
                      </button>
                    )}
                  </div>
                )}

                {/* Note display and edit */}
                {editingNoteId === item.id ? (
                  <div className="note-edit-inline">
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      className="note-textarea"
                      rows={2}
                      placeholder="添加备注..."
                      autoFocus
                    />
                    <div className="note-actions">
                      <button onClick={() => saveNote(item)} className="note-save-btn">
                        ✓
                      </button>
                      <button onClick={cancelNoteEdit} className="note-cancel-btn">
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="item-note-container" onClick={() => startEditNote(item)}>
                    {item.user_note ? (
                      <div className="item-note">
                        📝 {item.user_note}
                      </div>
                    ) : (
                      <div className="item-note-placeholder">
                        点击添加备注...
                      </div>
                    )}
                  </div>
                )}

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
                    <div className="item-content">
                      {item.type_ === 'image' && item.image_paths ? (
                        <img
                          src={getImageThumbnail(item.image_paths)}
                          alt="Clipboard image"
                          className="clipboard-image"
                        />
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
                    <div className="item-actions">
                      <button onClick={() => handleCopy(item)} className="action-btn copy">
                        📋 复制
                      </button>
                      <button onClick={() => startEdit(item)} className="action-btn edit">
                        ✏️ 编辑
                      </button>
                      <button onClick={() => handleDelete(item.id)} className="action-btn delete">
                        🗑️ 删除
                      </button>
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
