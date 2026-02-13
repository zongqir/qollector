import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import Settings from './Settings';
import DragDrop from './DragDrop';

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
  const [selectedType, setSelectedType] = useState('all'); // 独立的类型筛选（单选）
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [processedItemIds, setProcessedItemIds] = useState(new Set());
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 }); // 虚拟滚动：只渲染前20项
  const contentRef = useRef(null);
  const clickTimerRef = useRef(null); // 用于区分单击和双击
  const [copiedItemId, setCopiedItemId] = useState(null); // 用于显示复制成功反馈
  const [addingTagItemId, setAddingTagItemId] = useState(null); // 正在添加标签的项目ID
  const [newTagInput, setNewTagInput] = useState(''); // 新标签输入

  // 打开图片预览窗口
  const openImagePreview = async (imagePath) => {
    try {
      // 解析 JSON 格式的路径
      let originalPath = imagePath;
      try {
        const paths = JSON.parse(imagePath);
        originalPath = paths.original || paths.raw || imagePath;
      } catch {
        // 如果不是 JSON，直接使用原路径
      }

      const windowLabel = `preview-${Date.now()}`;

      // 开发模式和生产模式使用不同的 URL
      const isDev = window.location.hostname === 'localhost';
      const baseUrl = isDev
        ? 'http://localhost:5173/public/preview.html'
        : 'preview.html';

      const webview = new WebviewWindow(windowLabel, {
        url: `${baseUrl}?path=${encodeURIComponent(originalPath)}`,
        title: '图片预览',
        width: 800,
        height: 600,
        center: true,
        resizable: true,
        alwaysOnTop: true,
        decorations: true,
        skipTaskbar: false
      });

      await webview.once('tauri://created', () => {
        console.log('预览窗口已创建');
      });

      await webview.once('tauri://error', (e) => {
        console.error('预览窗口创建失败:', e);
      });
    } catch (error) {
      console.error('打开预览窗口失败:', error);
      alert('打开预览窗口失败: ' + error);
    }
  };

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
      // 显示复制成功反馈
      setCopiedItemId(item.id);
      setTimeout(() => setCopiedItemId(null), 1000); // 1秒后隐藏
      console.log('已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败: ' + error);
    }
  };

  // 处理内容区域的点击，区分单击和双击
  const handleContentClick = (item, e) => {
    e.stopPropagation();

    // 清除之前的定时器
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    // 设置延迟执行单击操作（300ms）
    clickTimerRef.current = setTimeout(() => {
      // 所有类型都执行复制
      handleCopy(item, e);
      clickTimerRef.current = null;
    }, 300);
  };

  // 处理双击
  const handleContentDoubleClick = (item, e, isImage = false) => {
    e.stopPropagation();

    // 清除单击定时器，防止单击操作执行
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (isImage) {
      // 图片双击打开预览
      openImagePreview(item.image_paths);
    } else {
      // 文本双击进入编辑
      startEdit(item);
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

  // 开始添加标签
  const startAddTag = (item, e) => {
    if (e) e.stopPropagation();
    setAddingTagItemId(item.id);
    setNewTagInput('');
  };

  // 取消添加标签
  const cancelAddTag = () => {
    setAddingTagItemId(null);
    setNewTagInput('');
  };

  // 添加标签到项目
  const addTagToItem = async (item, tagToAdd) => {
    try {
      const existingTags = getTags(item.tags);
      // 避免重复添加
      if (existingTags.includes(tagToAdd)) {
        cancelAddTag();
        return;
      }

      const newTags = [...existingTags, tagToAdd];
      const updatedItem = {
        ...item,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      cancelAddTag();
    } catch (error) {
      console.error('添加标签失败:', error);
      alert('添加标签失败: ' + error);
    }
  };

  // 处理标签输入回车
  const handleTagInputKeyDown = (item, e) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      addTagToItem(item, newTagInput.trim());
    } else if (e.key === 'Escape') {
      cancelAddTag();
    }
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

  // 拖出功能：处理拖拽开始
  const handleDragStart = (item, e) => {
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
      let appName = metadata.source_app || 'Unknown';
      // 去掉 .exe 后缀
      if (appName.toLowerCase().endsWith('.exe')) {
        appName = appName.slice(0, -4);
      }
      return appName;
    } catch {
      return 'Unknown';
    }
  };

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

  // 过滤标签建议
  const filteredUserTags = useMemo(() => {
    if (!newTagInput.trim()) return allUserTags;
    const query = newTagInput.toLowerCase();
    return allUserTags.filter(tag => tag.toLowerCase().includes(query));
  }, [allUserTags, newTagInput]);

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
      // 独立类型筛选（优先级最高）
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
  }, [items, selectedTags, selectedType, debouncedSearchQuery]);

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
      <DragDrop onItemAdded={loadItems} />

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

        {/* 类型筛选 - 单选，大屏显示 */}
        <div className="type-filter-group">
          <button
            onClick={() => setSelectedType('all')}
            className={`type-filter-btn ${selectedType === 'all' ? 'active' : ''}`}
          >
            全部
          </button>
          <button
            onClick={() => setSelectedType('text')}
            className={`type-filter-btn ${selectedType === 'text' ? 'active' : ''}`}
          >
            📝 文本
          </button>
          <button
            onClick={() => setSelectedType('image')}
            className={`type-filter-btn ${selectedType === 'image' ? 'active' : ''}`}
          >
            🖼️ 图片
          </button>
          <button
            onClick={() => setSelectedType('file')}
            className={`type-filter-btn ${selectedType === 'file' ? 'active' : ''}`}
          >
            📁 文件
          </button>
          <button
            onClick={() => setSelectedType('link')}
            className={`type-filter-btn ${selectedType === 'link' ? 'active' : ''}`}
          >
            🔗 链接
          </button>
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
                      const isTypeTag = tag.startsWith('类型:');
                      const isUserTag = !isAITag && !isSourceTag && !isTypeTag;
                      // 显示标签：AI标签去掉"AI:"，来源标签去掉"来源:"，类型标签去掉"类型:"
                      const displayTag = isAITag ? tag.substring(3) :
                                        isSourceTag ? tag.substring(3) :
                                        isTypeTag ? tag.substring(3) :
                                        tag;
                      return (
                        <div
                          key={tag}
                          onClick={() => toggleTagFilter(tag)}
                          className={`tag-dropdown-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                        >
                          <span className="tag-check">{selectedTags.includes(tag) ? '✓' : ''}</span>
                          <span className={`tag-text ${isAITag ? 'ai-tag-text' : ''} ${isUserTag ? 'user-tag-text' : ''} ${isSourceTag ? 'source-tag-text' : ''} ${isTypeTag ? 'type-tag-text' : ''}`}>
                            {isTypeTag && <span className="type-badge">T</span>}
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
              <div
                key={item.id}
                className="item-card"
                title={`${formatDate(item.created_at)} · ${getSourceApp(item.metadata)}`}
              >
                {/* Tags display - 顺序：类型、人工标签、来源标签、AI标签 */}
                <div className="item-tags">
                  {/* 类型标签 */}
                  {item.type_ && (
                    <span className="tag type-tag">
                      {item.type_ === 'text' && '文本'}
                      {item.type_ === 'image' && '图片'}
                      {item.type_ === 'file' && '文件'}
                      {item.type_ === 'link' && '链接'}
                    </span>
                  )}
                  {/* 用户标签（人工标签） */}
                  {getTags(item.tags).filter(tag => !tag.startsWith('AI:')).map((tag, idx) => (
                    <span key={`user-${idx}`} className="tag user-tag">
                      {tag}
                    </span>
                  ))}
                  {/* 来源标签 */}
                  {getSourceApp(item.metadata) !== 'Unknown' && (
                    <span className="tag source-tag">
                      {getSourceApp(item.metadata)}
                    </span>
                  )}
                  {/* AI标签 */}
                  {getTags(item.tags).filter(tag => tag.startsWith('AI:')).map((tag, idx) => (
                    <span key={`ai-${idx}`} className="tag ai-tag">
                      {tag.substring(3)}
                    </span>
                  ))}

                  {/* 添加标签按钮/输入框 */}
                  {addingTagItemId === item.id ? (
                    <div className="add-tag-input-wrapper">
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => handleTagInputKeyDown(item, e)}
                        placeholder="输入标签..."
                        className="add-tag-input"
                        autoFocus
                        onBlur={() => {
                          // 延迟关闭，让点击建议有时间触发
                          setTimeout(() => cancelAddTag(), 200);
                        }}
                      />
                      {/* 标签建议下拉 */}
                      {filteredUserTags.length > 0 && newTagInput.trim() && (
                        <div className="tag-suggestions">
                          {filteredUserTags.slice(0, 5).map((tag, idx) => (
                            <div
                              key={idx}
                              className="tag-suggestion-item"
                              onMouseDown={(e) => {
                                e.preventDefault(); // 防止失焦
                                addTagToItem(item, tag);
                              }}
                            >
                              {tag}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      className="add-tag-btn"
                      onClick={(e) => startAddTag(item, e)}
                      title="添加标签"
                    >
                      +
                    </button>
                  )}
                </div>

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
                  {/* 拖出按钮 */}
                  <span
                    draggable="true"
                    onDragStart={(e) => handleDragStart(item, e)}
                    className="toolbar-btn drag-handle"
                    title="拖拽到其他应用"
                  >
                    <span className="toolbar-btn-icon">⠿</span>
                    <span>拖出</span>
                  </span>

                  <div className="toolbar-divider"></div>

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
                      className={`item-content clickable ${expandedItemId === item.id ? 'expanded' : ''} ${copiedItemId === item.id ? 'copied' : ''}`}
                      onClick={(e) => handleContentClick(item, e)}
                      onDoubleClick={(e) => handleContentDoubleClick(item, e, item.type_ === 'image')}
                    >
                      {/* Hover提示 */}
                      <div className="content-hover-tip">
                        <div className="hover-actions">单击复制 | 双击{item.type_ === 'image' ? '预览' : '编辑'}</div>
                      </div>

                      {/* 复制成功反馈 */}
                      {copiedItemId === item.id && (
                        <div className="copy-success-toast">
                          ✓ 已复制
                        </div>
                      )}

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
