import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useTranslation } from 'react-i18next';
import Settings from './Settings';
import DragDrop from './DragDrop';

function App() {
  const { t, i18n } = useTranslation();
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

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
  };

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
        title: t('preview.title'),
        width: 800,
        height: 600,
        center: true,
        resizable: true,
        alwaysOnTop: true,
        decorations: false,
        skipTaskbar: false
      });

      await webview.once('tauri://created', () => {
        console.log(t('preview.created'));
      });

      await webview.once('tauri://error', (e) => {
        console.error(t('preview.createFailed', { error: e }));
      });
    } catch (error) {
      console.error(t('preview.createFailed', { error }));
      alert(t('error.previewFailed', { error }));
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
      console.error(t('error.loadFailed', { error }));
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
      console.error(t('error.copyFailed', { error }));
      alert(t('error.copyFailed', { error }));
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
      console.error(t('error.togglePinFailed', { error }));
      alert(t('error.togglePinFailed', { error }));
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
      console.error(t('error.toggleWindowPinFailed', { error }));
      alert(t('error.toggleWindowPinFailed', { error }));
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
      console.error(t('error.ocrFailed', { error }));
      alert(t('error.ocrFailed', { error }));
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
      console.error(t('error.updateFailed', { error }));
      alert(t('error.updateFailed', { error }));
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
      console.error(t('error.saveFailed', { error }));
      alert(t('error.saveFailed', { error }));
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
      console.error(t('error.addTagFailed', { error }));
      alert(t('error.addTagFailed', { error }));
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
    // 使用当前语言的本地化格式
    return date.toLocaleString(i18n.language);
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

  // 点击标签进行筛选
  const handleTagClick = (tag, e) => {
    e.stopPropagation();

    // 判断是否已选中
    const isSelected = selectedTags.includes(tag);

    if (isSelected) {
      // 取消选中
      setSelectedTags(prev => prev.filter(t => t !== tag));
    } else {
      // 添加选中
      setSelectedTags(prev => [...prev, tag]);
    }
  };

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
          <div className="titlebar-title">{t('app.title')}</div>
        </div>
        <div className="titlebar-buttons">
          <button
            onClick={toggleLanguage}
            className="titlebar-btn lang-btn"
            title={i18n.language === 'zh-CN' ? 'Switch to English' : '切换到中文'}
          >
            {i18n.language === 'zh-CN' ? '🌐 EN' : '🌐 中'}
          </button>
          <button
            onClick={toggleWindowAlwaysOnTop}
            className={`titlebar-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
            title={isAlwaysOnTop ? t('titlebar.unpin') : t('titlebar.pin')}
          >
            📌
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.minimize();
            }}
            className="titlebar-btn"
            title={t('titlebar.minimize')}
          >
            ─
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.toggleMaximize();
            }}
            className="titlebar-btn"
            title={t('titlebar.maximize')}
          >
            □
          </button>
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.close();
            }}
            className="titlebar-btn close-btn"
            title={t('titlebar.close')}
          >
            ✕
          </button>
        </div>
      </div>

      <header className="header">
        <div className="search-box">
          <input
            type="text"
            placeholder={t('search.placeholder')}
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

        {/* 标签筛选状态提示 */}
        {selectedTags.length > 0 && (
          <div className="filter-status">
            <span className="filter-status-text">
              {t('toolbar.filteringBy', { count: selectedTags.length })}
            </span>
            <button
              onClick={() => setSelectedTags([])}
              className="clear-filter-btn"
              title={t('toolbar.clearAll')}
            >
              ✕ {t('toolbar.clearFilter')}
            </button>
          </div>
        )}

        {/* 类型筛选 - 单选，大屏显示 */}
        <div className="type-filter-group">
          <button
            onClick={() => setSelectedType('all')}
            className={`type-filter-btn ${selectedType === 'all' ? 'active' : ''}`}
          >
            {t('search.typeFilter.all')}
          </button>
          <button
            onClick={() => setSelectedType('text')}
            className={`type-filter-btn ${selectedType === 'text' ? 'active' : ''}`}
          >
            📝 {t('search.typeFilter.text')}
          </button>
          <button
            onClick={() => setSelectedType('image')}
            className={`type-filter-btn ${selectedType === 'image' ? 'active' : ''}`}
          >
            🖼️ {t('search.typeFilter.image')}
          </button>
          <button
            onClick={() => setSelectedType('file')}
            className={`type-filter-btn ${selectedType === 'file' ? 'active' : ''}`}
          >
            📁 {t('search.typeFilter.file')}
          </button>
          <button
            onClick={() => setSelectedType('link')}
            className={`type-filter-btn ${selectedType === 'link' ? 'active' : ''}`}
          >
            🔗 {t('search.typeFilter.link')}
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
                {selectedTags.length > 0 ? t('toolbar.selectedTags', { count: selectedTags.length }) : t('toolbar.filterTags')}
              </span>
              <span className="dropdown-arrow">{showTagFilter ? '▲' : '▼'}</span>
            </button>
            {showTagFilter && (
              <div className="tag-dropdown">
                <div className="tag-dropdown-search">
                  <input
                    type="text"
                    placeholder={t('toolbar.searchTags')}
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
                    <div className="tag-dropdown-empty">{t('toolbar.noTagsFound')}</div>
                  )}
                </div>
                {selectedTags.length > 0 && (
                  <div className="tag-dropdown-footer">
                    <button onClick={() => setSelectedTags([])} className="clear-selection-btn">
                      {t('toolbar.clearAll')}
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
            {searchQuery ? t('search.noResults') : t('app.noItems')}
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
                  {item.type_ && (() => {
                    const typeMap = {
                      'text': '类型:文本',
                      'image': '类型:图片',
                      'file': '类型:文件',
                      'link': '类型:链接'
                    };
                    const typeTag = typeMap[item.type_];
                    const displayName = t(`search.typeFilter.${item.type_}`);
                    return (
                      <span
                        className={`tag type-tag ${selectedTags.includes(typeTag) ? 'selected' : ''}`}
                        onClick={(e) => handleTagClick(typeTag, e)}
                        title={t('item.clickToFilterType')}
                      >
                        {displayName}
                      </span>
                    );
                  })()}
                  {/* 用户标签（人工标签） */}
                  {getTags(item.tags).filter(tag => !tag.startsWith('AI:')).map((tag, idx) => (
                    <span
                      key={`user-${idx}`}
                      className={`tag user-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
                      onClick={(e) => handleTagClick(tag, e)}
                      title={t('item.clickToFilter')}
                    >
                      {tag}
                    </span>
                  ))}
                  {/* 来源标签 */}
                  {getSourceApp(item.metadata) !== 'Unknown' && (() => {
                    const sourceTag = `来源:${getSourceApp(item.metadata)}`;
                    return (
                      <span
                        className={`tag source-tag ${selectedTags.includes(sourceTag) ? 'selected' : ''}`}
                        onClick={(e) => handleTagClick(sourceTag, e)}
                        title={t('item.clickToFilterSource')}
                      >
                        {getSourceApp(item.metadata)}
                      </span>
                    );
                  })()}
                  {/* AI标签 */}
                  {getTags(item.tags).filter(tag => tag.startsWith('AI:')).map((tag, idx) => {
                    const displayTag = tag.substring(3);
                    return (
                      <span
                        key={`ai-${idx}`}
                        className={`tag ai-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
                        onClick={(e) => handleTagClick(tag, e)}
                        title={t('item.clickToFilterAI')}
                      >
                        {displayTag}
                      </span>
                    );
                  })}

                  {/* 添加标签按钮/输入框 */}
                  {addingTagItemId === item.id ? (
                    <div className="add-tag-input-wrapper">
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => handleTagInputKeyDown(item, e)}
                        placeholder={t('edit.enterTag')}
                        className="add-tag-input"
                        autoFocus
                        onBlur={() => {
                          // 延迟关闭，让点击建议有时间触发
                          setTimeout(() => cancelAddTag(), 200);
                        }}
                      />
                      {/* 标签建议下拉 - 改进：始终显示（如果有标签） */}
                      {filteredUserTags.length > 0 && (
                        <div className="tag-suggestions">
                          {filteredUserTags.slice(0, 8).map((tag, idx) => (
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
                      title={t('item.addTag')}
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
                      placeholder={t('edit.notePlaceholder')}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                          saveNote(item);
                        } else if (e.key === 'Escape') {
                          cancelNoteEdit();
                        }
                      }}
                    />
                    <button onClick={() => saveNote(item)} className="note-btn-save" title={t('item.saveNote')}>✓</button>
                    <button onClick={cancelNoteEdit} className="note-btn-cancel" title={t('item.cancelNote')}>✕</button>
                  </div>
                ) : item.user_note ? (
                  <div
                    className="note-display-bar"
                    onClick={() => startEditNote(item)}
                    title={t('item.clickToEditNote')}
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
                    title={t('toolbar.dragToApp')}
                  >
                    <span className="toolbar-btn-icon">⠿</span>
                    <span>{t('toolbar.dragOut')}</span>
                  </span>

                  <div className="toolbar-divider"></div>

                  {/* 置顶按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(item, e);
                    }}
                    className={`toolbar-btn pin-btn ${item.is_pinned ? 'active' : ''}`}
                    title={item.is_pinned ? t('item.unpin') : t('item.pin')}
                  >
                    <span className="toolbar-btn-icon">📌</span>
                    <span>{item.is_pinned ? t('item.pinned') : t('item.pin')}</span>
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
                        title={generatingAI === item.id ? t('item.aiGenerating') : t('item.generateAITags')}
                      >
                        <span className="toolbar-btn-icon">
                          {generatingAI === item.id ? '⏳' : '✨'}
                        </span>
                        <span>{generatingAI === item.id ? t('item.generating') : t('item.aiTag')}</span>
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
                        title={ocrProcessing === item.id ? t('item.ocrRecognizing') : t('item.recognizeText')}
                      >
                        <span className="toolbar-btn-icon">
                          {ocrProcessing === item.id ? '⏳' : '🔍'}
                        </span>
                        <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
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
                    title={item.user_note ? t('item.editNote') : t('item.addNote')}
                  >
                    <span className="toolbar-btn-icon">📝</span>
                    <span>{item.user_note ? t('item.editNote') : t('item.addNote')}</span>
                  </button>

                  {/* 展开按钮 */}
                  <div className="toolbar-divider"></div>
                  <button
                    onClick={(e) => toggleExpand(item.id, e)}
                    className={`toolbar-btn expand-btn ${expandedItemId === item.id ? 'active' : ''}`}
                    title={expandedItemId === item.id ? t('item.collapse') : t('item.expandAll')}
                  >
                    <span className="toolbar-btn-icon">{expandedItemId === item.id ? '▲' : '▼'}</span>
                    <span>{expandedItemId === item.id ? t('item.collapse') : t('item.expand')}</span>
                  </button>
                </div>

                {editingId === item.id ? (
                  <div className="edit-mode">
                    {item.type_ !== 'image' && (
                      <>
                        <label className="edit-label">{t('edit.content')}</label>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="edit-textarea"
                          rows={5}
                        />
                      </>
                    )}

                    <label className="edit-label">{t('edit.note')}</label>
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      className="edit-textarea"
                      rows={2}
                      placeholder={t('edit.notePlaceholder')}
                    />

                    <div className="edit-actions">
                      <button onClick={() => saveEdit(item)} className="save-btn">
                        ✓ {t('edit.save')}
                      </button>
                      <button onClick={cancelEdit} className="cancel-btn">
                        ✕ {t('edit.cancel')}
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
                        <div className="hover-actions">{t('item.clickToCopy')} | {item.type_ === 'image' ? t('item.doubleClickToPreview') : t('item.doubleClickToEdit')}</div>
                      </div>

                      {/* 复制成功反馈 */}
                      {copiedItemId === item.id && (
                        <div className="copy-success-toast">
                          ✓ {t('item.copied')}
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
                              <div className="ocr-text-header">{t('item.recognizedText')}</div>
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
