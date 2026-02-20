import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft, Inbox, Star, Sparkles, Search, StickyNote,
  ExternalLink, Check, FileText, Copy, Download, Trash2, FolderOpen, Braces, Share2, Edit2, Clock3, Palette, Bot
} from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import {
  getContentPreview,
  getFileList,
  getFileName,
  formatDate,
  extractOpenableUrls,
  extractOpenableFilePaths,
  detectTimestampCandidate,
  formatTimestampCandidate,
  parsePureColorText,
} from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags, getSourceApp } from '../../utils/tagHelpers';
import AIAssistantPanel from '../../features/ai-assistant/components/AIAssistantPanel';
import ItemTags from '../ItemCard/ItemTags';
import NoteDisplay from '../ItemCard/NoteDisplay';
import FilePreviewItem from './FilePreview';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

function PreviewPanel() {
  const { t, i18n } = useTranslation();
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isToolbarCompact, setIsToolbarCompact] = useState(false);
  const [copiedToolbarAction, setCopiedToolbarAction] = useState(null);
  const [showTimestampConverted, setShowTimestampConverted] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const toolbarRef = useRef(null);
  const toolbarCopyTimerRef = useRef(null);
  const panelRef = useRef(null);
  const contentSelectableRef = useRef(null);

  const previewItem = useAppStore(s => s.previewItem);
  const switchToCollection = useAppStore(s => s.switchToCollection);
  const togglePin = useAppStore(s => s.togglePin);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const generateAITags = useAppStore(s => s.generateAITags);
  const handleOCR = useAppStore(s => s.handleOCR);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleOpenUrl = useAppStore(s => s.handleOpenUrl);
  const handleRevealInFolder = useAppStore(s => s.handleRevealInFolder);
  const handleSaveImageAs = useAppStore(s => s.handleSaveImageAs);
  const handleCopy = useAppStore(s => s.handleCopy);
  const handleCopyPlainText = useAppStore(s => s.handleCopyPlainText);
  const deleteItem = useAppStore(s => s.deleteItem);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const generatingAI = useAppStore(s => s.generatingAI);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const ocrProcessing = useAppStore(s => s.ocrProcessing);
  const ocrEnabled = useAppStore(s => s.ocrEnabled);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const items = useAppStore(s => s.items);
  const openShareModal = useAppStore(s => s.openShareModal);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const selectedItemIds = useAppStore(s => s.selectedItemIds);

  // 备注相关
  const editingNoteId = useAppStore(s => s.editingNoteId);
  const editNote = useAppStore(s => s.editNote);
  const setEditNote = useAppStore(s => s.setEditNote);
  const startEditNote = useAppStore(s => s.startEditNote);
  const saveNote = useAppStore(s => s.saveNote);
  const cancelNoteEdit = useAppStore(s => s.cancelNoteEdit);

  // 标签相关
  const selectedTags = useAppStore(s => s.selectedTags);
  const addingTagItemId = useAppStore(s => s.addingTagItemId);
  const newTagInput = useAppStore(s => s.newTagInput);
  const setNewTagInput = useAppStore(s => s.setNewTagInput);
  const startAddTag = useAppStore(s => s.startAddTag);
  const cancelAddTag = useAppStore(s => s.cancelAddTag);
  const addTagToItem = useAppStore(s => s.addTagToItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);

  // 从 items 中获取最新的 previewItem 数据（因为可能被更新了）
  const item = items.find(i => i.id === previewItem?.id) || previewItem;

  if (!item) {
    switchToCollection();
    return null;
  }

  const isCopied = copiedItemId === item.id && copyFeedbackSource === 'preview';
  const tags = getTags(item.tags);
  const hasAITags = tags.some(tag => tag.startsWith('AI:'));
  const shouldShowAIButton = aiEnabled && item.type_ === 'text' && item.content && !hasAITags;
  const shouldShowOCRButton = ocrEnabled && item.type_ === 'image' && !item.ocr_text;
  const textOpenableUrls = useMemo(() => {
    if (item.type_ !== 'text') return [];
    return extractOpenableUrls(item.content);
  }, [item.type_, item.content]);
  const textOpenablePaths = useMemo(() => {
    if (item.type_ !== 'text') return [];
    return extractOpenableFilePaths(item.content);
  }, [item.type_, item.content]);
  const shouldShowOpenButton = item.type_ === 'link' || item.type_ === 'file' || textOpenablePaths.length > 0 || textOpenableUrls.length > 0;
  const shouldShowRevealButton = item.type_ === 'file' || textOpenablePaths.length > 0;
  const shouldShowSaveImageButton = item.type_ === 'image' && !!item.image_paths;
  const isJson = item.code_language && item.code_language.toLowerCase() === 'json' && item.content;
  const assistantSourceText = useMemo(() => {
    if (item.type_ === 'image') {
      return item.ocr_text || item.content || '';
    }
    return item.content || '';
  }, [item.content, item.ocr_text, item.type_]);
  const canUseAIAssistant = assistantSourceText.trim().length > 0;
  const pureColorPreview = useMemo(() => {
    if (item.type_ !== 'text') return null;
    return parsePureColorText(item.content);
  }, [item.type_, item.content]);
  const timestampCandidate = useMemo(() => {
    if (item.type_ !== 'text') return null;
    return detectTimestampCandidate(item.content);
  }, [item.type_, item.content]);
  const convertedTimestampText = useMemo(() => (
    timestampCandidate ? formatTimestampCandidate(timestampCandidate, i18n.language) : ''
  ), [timestampCandidate, i18n.language]);
  const shouldShowTimestampConvertButton = Boolean(timestampCandidate && convertedTimestampText);
  const openButtonTitle = (item.type_ === 'file' || textOpenablePaths.length > 0) ? t('item.openFile') : t('item.openLink');
  const selectPreviewContent = useCallback(() => {
    const contentEl = contentSelectableRef.current;
    const selection = window.getSelection();
    if (!contentEl || !selection) return false;

    const range = document.createRange();
    range.selectNodeContents(contentEl);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  // Check if toolbar needs compact mode (when buttons would wrap to multiple lines)
  useEffect(() => {
    if (!toolbarRef.current) return;

    let timeoutId = null;

    const checkToolbarWidth = () => {
      if (timeoutId) clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar) return;

        // Create a temporary clone to measure full width
        const clone = toolbar.cloneNode(true);
        clone.style.position = 'absolute';
        clone.style.visibility = 'hidden';
        clone.style.width = 'auto';
        clone.style.display = 'flex';
        clone.style.flexWrap = 'nowrap';
        clone.classList.remove('compact');

        toolbar.parentElement.appendChild(clone);

        // Measure the natural width needed
        const naturalWidth = clone.scrollWidth;
        const availableWidth = toolbar.clientWidth;

        // Clean up
        toolbar.parentElement.removeChild(clone);

        // Add buffer for safety
        const needsCompact = naturalWidth > (availableWidth - 10);

        setIsToolbarCompact(needsCompact);
      }, 150);
    };

    checkToolbarWidth();
    const resizeObserver = new ResizeObserver(checkToolbarWidth);
    resizeObserver.observe(toolbarRef.current);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [item.id, isEditingContent]);

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleGlobalSelectAll = (e) => {
      if (isEditingContent) return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
      if (isEditableElement(e.target)) return;

      const panelEl = panelRef.current;
      if (!panelEl) return;

      const target = e.target;
      const activeElement = document.activeElement;
      const targetInsidePanel = target instanceof Node && panelEl.contains(target);
      const activeInsidePanel = activeElement instanceof Node && panelEl.contains(activeElement);
      const bodyTarget = target === document.body || target === document.documentElement;
      if (!targetInsidePanel && !activeInsidePanel && !bodyTarget) return;

      if (selectPreviewContent()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleGlobalSelectAll, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalSelectAll, true);
    };
  }, [isEditingContent, selectPreviewContent]);

  useEffect(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    selection.removeAllRanges();
  }, [item.id]);

  useEffect(() => {
    return () => {
      if (toolbarCopyTimerRef.current) {
        clearTimeout(toolbarCopyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCopiedToolbarAction(null);
  }, [item.id]);

  useEffect(() => {
    setShowTimestampConverted(false);
  }, [item.id]);

  useEffect(() => {
    setShowAIAssistant(false);
  }, [item.id]);

  // 收集并切回收集箱
  const handlePreviewPinToggle = async () => {
    const wasPinned = item.is_pinned;
    await togglePin(item);
    if (wasPinned) {
      switchToCollection();
    }
  };

  // 开始编辑内容
  const handleStartEditContent = () => {
    setEditContent(item.content || '');
    setIsEditingContent(true);
  };

  // 内容区键盘事件处理
  const handleContentKeyDown = (e) => {
    // Ctrl+A / Cmd+A: select only current preview content block, not whole page
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      if (selectPreviewContent()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  // 内容区双击行为
  const handleContentDoubleClick = async () => {
    if (item.type_ === 'file') {
      // file open
      await handleOpenItem(item);
    } else {
      // copy content only (not the whole item)
      if (item.content) {
        await handleCopyPlainText(item.content, 'preview');
      } else if (item.type_ === 'image') {
        // for image, copy the image itself
        await handleCopy(item, 'preview');
      }
    }
  };

  // 删除按钮点击
  const handleDeleteClick = () => {
    if (showDeleteConfirm) {
      deleteItem(item);
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  // 保存内容编辑
  const handleSaveContent = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const updatedItem = {
        ...item,
        content: editContent,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await useAppStore.getState().loadItems();
      setIsEditingContent(false);
    } catch (error) {
      console.error('保存内容失败:', error);
    }
  };

  // 计算用户标签（用于标签建议）
  const rankedUserTags = useMemo(() => {
    const statsByTag = new Map();
    items.forEach((candidate) => {
      const rankTimestamp = Math.max(candidate.updated_at || 0, candidate.created_at || 0);
      const uniqueUserTags = new Set(
        getTags(candidate.tags).filter(tag => !tag.startsWith('AI:')),
      );
      uniqueUserTags.forEach((tag) => {
        const existing = statsByTag.get(tag);
        if (existing) {
          existing.count += 1;
          if (rankTimestamp > existing.lastUsedAt) existing.lastUsedAt = rankTimestamp;
          return;
        }
        statsByTag.set(tag, { tag, count: 1, lastUsedAt: rankTimestamp });
      });
    });
    return Array.from(statsByTag.values())
      .sort((a, b) => (
        b.count - a.count
        || b.lastUsedAt - a.lastUsedAt
        || a.tag.localeCompare(b.tag)
      ))
      .map(stat => stat.tag);
  }, [items]);

  const filteredUserTags = useMemo(() => {
    const query = newTagInput.trim().toLowerCase();
    if (!query) return rankedUserTags;

    const prefixMatches = [];
    const partialMatches = [];
    rankedUserTags.forEach((tag) => {
      const normalizedTag = tag.toLowerCase();
      if (!normalizedTag.includes(query)) return;
      if (normalizedTag.startsWith(query)) {
        prefixMatches.push(tag);
      } else {
        partialMatches.push(tag);
      }
    });
    return [...prefixMatches, ...partialMatches];
  }, [rankedUserTags, newTagInput]);

  const handleTagInputKeyDown = (itemObj, e) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      addTagToItem(itemObj, newTagInput.trim());
    } else if (e.key === 'Escape') {
      cancelAddTag();
    }
  };

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleQuickTagShortcut = (e) => {
      if (!historyTagShortcutEnabled || isEditingContent) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 't') return;
      if (isEditableElement(e.target)) return;
      if (selectedItemIds.length > 0) return;

      e.preventDefault();
      e.stopPropagation();

      if (addingTagItemId !== item.id) {
        startAddTag(item);
        return;
      }

      const inputEl = panelRef.current?.querySelector('.preview-tags-section .add-tag-input');
      if (inputEl instanceof HTMLInputElement) {
        inputEl.focus();
        inputEl.select();
      }
    };

    window.addEventListener('keydown', handleQuickTagShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleQuickTagShortcut, true);
    };
  }, [historyTagShortcutEnabled, isEditingContent, addingTagItemId, item, startAddTag, selectedItemIds.length]);

  const handleOpen = useCallback(() => {
    if (item.type_ === 'link' || item.type_ === 'file') {
      handleOpenItem(item);
      return;
    }
    if (textOpenablePaths.length > 0) {
      invoke('open_file_path', { path: textOpenablePaths[0] }).catch((error) => {
        console.error('open file path failed:', error);
      });
      return;
    }
    if (textOpenableUrls.length > 0) {
      handleOpenUrl(textOpenableUrls[0]);
    }
  }, [handleOpenItem, handleOpenUrl, item, textOpenablePaths, textOpenableUrls]);

  const handleReveal = useCallback(() => {
    if (item.type_ === 'file') {
      handleRevealInFolder(item);
      return;
    }
    if (textOpenablePaths.length > 0) {
      invoke('reveal_file_path', { path: textOpenablePaths[0] }).catch((error) => {
        console.error('reveal file path failed:', error);
      });
    }
  }, [handleRevealInFolder, item, textOpenablePaths]);

  const handleFormatJsonCopy = useCallback(() => {
    try {
      const formatted = JSON.stringify(JSON.parse(item.content), null, 2);
      handleCopyPlainText(formatted, 'preview');
    } catch {
      handleCopyPlainText(item.content, 'preview');
    }
  }, [item.content, handleCopyPlainText]);

  const setToolbarCopiedFeedback = useCallback((actionKey) => {
    setCopiedToolbarAction(actionKey);
    if (toolbarCopyTimerRef.current) {
      clearTimeout(toolbarCopyTimerRef.current);
    }
    toolbarCopyTimerRef.current = setTimeout(() => {
      setCopiedToolbarAction((current) => (current === actionKey ? null : current));
      toolbarCopyTimerRef.current = null;
    }, 1100);
  }, []);

  const runToolbarCopyAction = useCallback(async (actionKey, copyAction) => {
    await copyAction();
    setToolbarCopiedFeedback(actionKey);
  }, [setToolbarCopiedFeedback]);

  const renderContent = () => {
    if (isEditingContent && item.type_ !== 'image' && item.type_ !== 'file') {
      return (
        <textarea
          className="preview-edit-textarea"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          wrap="soft"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) handleSaveContent();
            if (e.key === 'Escape') setIsEditingContent(false);
          }}
          autoFocus
        />
      );
    }

    if (item.code_language && item.content) {
      return (
        <div
          ref={contentSelectableRef}
          className="preview-code-content"
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={t('item.doubleClickToCopy')}
        >
          <Suspense fallback={<div className="preview-text-content">{item.content}</div>}>
            <CodeBlock code={item.content} language={item.code_language} maxLines={200} />
          </Suspense>
        </div>
      );
    }

    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div
          ref={contentSelectableRef}
          className="preview-image-content"
          onDoubleClick={handleContentDoubleClick}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={t('item.doubleClickToCopy')}
        >
          <img src={getImageOriginal(item.image_paths)} alt="" />
          {item.ocr_text && (
            <div className="preview-ocr">
              <div className="ocr-label">{t('item.recognizedText')}</div>
              <div className="ocr-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      );
    }
    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      return (
        <div
          ref={contentSelectableRef}
          className="preview-file-content"
          onDoubleClick={handleContentDoubleClick}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={t('item.doubleClickToOpen')}
        >
          {files.map((path, idx) => (
            <FilePreviewItem key={idx} filePath={path.trim()} />
          ))}
        </div>
      );
    }
    return (
      <div
        ref={contentSelectableRef}
        className="preview-text-content"
        onDoubleClick={handleContentDoubleClick}
        onKeyDown={handleContentKeyDown}
        tabIndex={0}
        title={item.type_ === 'file' ? t('item.doubleClickToOpen') : t('item.doubleClickToCopy')}
      >
        {getContentPreview(item.content)}
      </div>
    );
  };

  return (
    <div className="preview-panel" ref={panelRef}>
      {/* 顶部导航 */}
      <div className="preview-nav">
        <button className="preview-back-btn" onClick={switchToCollection}>
          <ArrowLeft size={16} />
        </button>
        <div className="preview-nav-actions">
          <button
            className={`preview-action-btn copy-btn ${isCopied ? 'copied' : ''}`}
            onClick={() => handleCopy(item, 'preview')}
            title={t('item.copy')}
          >
            <Copy size={16} />
          </button>
          <button
            className={`preview-action-btn favorite-btn ${item.is_favorite ? 'active' : ''}`}
            onClick={() => toggleFavorite(item)}
            title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
          >
            <Star size={16} fill={item.is_favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className={`preview-action-btn pin-btn ${item.is_pinned ? 'active' : ''}`}
            onClick={handlePreviewPinToggle}
            title={item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems || 5 })}
          >
            <Inbox size={16} />
          </button>
          <button
            className={`preview-action-btn delete-btn ${showDeleteConfirm ? 'confirm' : ''}`}
            onClick={handleDeleteClick}
            title={showDeleteConfirm ? t('item.confirmDelete') : t('item.delete')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* 标签区 */}
      <div className="preview-tags-section">
        <ItemTags
          item={item}
          selectedTags={selectedTags}
          onTagClick={handleTagClick}
          addingTagItemId={addingTagItemId}
          newTagInput={newTagInput}
          onNewTagInputChange={setNewTagInput}
          onTagInputKeyDown={handleTagInputKeyDown}
          onStartAddTag={startAddTag}
          onCancelAddTag={cancelAddTag}
          onAddTagToItem={addTagToItem}
          filteredUserTags={filteredUserTags}
          hideTypeTag
          singleRow
        />
      </div>

      {/* 内容区 */}
      <div className={`preview-content-area ${isEditingContent ? 'editing' : ''} ${showAIAssistant ? 'ai-assistant-mode' : ''}`}>
        {isCopied && (
          <div className="copy-success-toast">
            <Check size={16} /> {t('item.copied')}
          </div>
        )}
        <AIAssistantPanel
          open={showAIAssistant}
          sourceText={assistantSourceText}
          sourceType={item.type_}
          onClose={() => setShowAIAssistant(false)}
        />
        {!showAIAssistant && !isEditingContent && pureColorPreview && (
          <div className="preview-color-card">
            <div
              className="preview-color-card-swatch"
              style={{ backgroundColor: pureColorPreview.previewCss }}
            />
            <div className="preview-color-card-values">
              <div className="preview-color-card-row">
                <span className="preview-color-card-label">HEX</span>
                <code>{pureColorPreview.hex}</code>
              </div>
              <div className="preview-color-card-row">
                <span className="preview-color-card-label">RGB</span>
                <code>{pureColorPreview.rgb}</code>
              </div>
              <div className="preview-color-card-row">
                <span className="preview-color-card-label">HSL</span>
                <code>{pureColorPreview.hsl}</code>
              </div>
            </div>
          </div>
        )}
        {!showAIAssistant && renderContent()}
      </div>

      {/* 备注区 - 内容下方，作为批注 */}
      {!showAIAssistant && !isEditingContent && (
        <div className="preview-note-section">
          <NoteDisplay
            item={item}
            editingNoteId={editingNoteId}
            editNote={editNote}
            onEditNoteChange={setEditNote}
            onStartEditNote={startEditNote}
            onSaveNote={saveNote}
            onCancelNoteEdit={cancelNoteEdit}
          />
          {!item.user_note && editingNoteId !== item.id && (
            <button className="preview-add-note-btn" onClick={() => startEditNote(item)}>
              <StickyNote size={12} />
              <span>{t('item.addNote')}</span>
            </button>
          )}
        </div>
      )}

      {/* 元信息 - 底部参考 */}
      {!showAIAssistant && !isEditingContent && (
        <div className="preview-meta">
          {pureColorPreview && (
            <span className="preview-meta-color">
              <span
                className="preview-meta-color-swatch"
                style={{ backgroundColor: pureColorPreview.previewCss }}
              />
              <span className="preview-meta-color-text">{pureColorPreview.hex}</span>
            </span>
          )}
          {showTimestampConverted && convertedTimestampText && (
            <span className="preview-meta-timestamp">
              {t('item.timestampConverted')}: {convertedTimestampText}
            </span>
          )}
          <span className="preview-meta-time">{formatDate(item.created_at, i18n.language)}</span>
          <span className="preview-meta-source">{getSourceApp(item.metadata)}</span>
        </div>
      )}

      {/* 工具栏 */}
      <div ref={toolbarRef} className={`preview-toolbar ${isToolbarCompact ? 'compact' : ''}`}>
        {isEditingContent ? (
          <>
            <span className="preview-toolbar-hint">{t('editModal.saveHint')}</span>
            <button className="preview-tool-btn" onClick={() => setIsEditingContent(false)}>
              <span>{t('panel.cancelEdit')}</span>
            </button>
            <button className="preview-tool-btn active" onClick={handleSaveContent}>
              <Check size={14} />
              <span>{t('panel.saveContent')}</span>
            </button>
          </>
        ) : (
          <>
            {item.has_raw_formats && item.content && (
              <button
                className={`preview-tool-btn ${copiedToolbarAction === 'plain-text' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('plain-text', () => handleCopyPlainText(item.content, 'preview'))}
              >
                {copiedToolbarAction === 'plain-text' ? <Check size={14} /> : <FileText size={14} />}
                <span>{copiedToolbarAction === 'plain-text' ? t('item.copied') : t('item.copyPlainText')}</span>
              </button>
            )}
            {isJson && (
              <button
                className={`preview-tool-btn ${copiedToolbarAction === 'json' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('json', handleFormatJsonCopy)}
              >
                {copiedToolbarAction === 'json' ? <Check size={14} /> : <Braces size={14} />}
                <span>{copiedToolbarAction === 'json' ? t('item.copied') : t('item.formatJsonCopy')}</span>
              </button>
            )}
            {pureColorPreview && (
              <button
                className={`preview-tool-btn color-format ${copiedToolbarAction === 'hex' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('hex', () => handleCopyPlainText(pureColorPreview.hex, 'preview'))}
                title={t('item.copyHex')}
              >
                {copiedToolbarAction === 'hex' ? <Check size={14} /> : <Palette size={14} />}
                <span>{t('item.copyHex')}</span>
                <span className="compact-label">HEX</span>
              </button>
            )}
            {pureColorPreview && (
              <button
                className={`preview-tool-btn color-format ${copiedToolbarAction === 'rgb' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('rgb', () => handleCopyPlainText(pureColorPreview.rgb, 'preview'))}
                title={t('item.copyRgb')}
              >
                {copiedToolbarAction === 'rgb' ? <Check size={14} /> : <Palette size={14} />}
                <span>{t('item.copyRgb')}</span>
                <span className="compact-label">RGB</span>
              </button>
            )}
            {pureColorPreview && (
              <button
                className={`preview-tool-btn color-format ${copiedToolbarAction === 'hsl' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('hsl', () => handleCopyPlainText(pureColorPreview.hsl, 'preview'))}
                title={t('item.copyHsl')}
              >
                {copiedToolbarAction === 'hsl' ? <Check size={14} /> : <Palette size={14} />}
                <span>{t('item.copyHsl')}</span>
                <span className="compact-label">HSL</span>
              </button>
            )}
            {shouldShowTimestampConvertButton && (
              <button
                className={`preview-tool-btn ${showTimestampConverted ? 'active' : ''}`}
                onClick={() => setShowTimestampConverted((prev) => !prev)}
                title={t('item.convertTimestamp')}
              >
                <Clock3 size={14} />
                <span>{t('item.convertTimestamp')}</span>
              </button>
            )}
            {shouldShowAIButton && (
              <button
                className="preview-tool-btn"
                onClick={() => generateAITags(item)}
                disabled={generatingAI === item.id}
              >
                <Sparkles size={14} />
                <span>{generatingAI === item.id ? t('item.generating') : t('item.aiTag')}</span>
              </button>
            )}
            <button
              className={`preview-tool-btn ${showAIAssistant ? 'active' : ''}`}
              onClick={() => setShowAIAssistant(prev => !prev)}
              disabled={!canUseAIAssistant}
              title={!canUseAIAssistant ? t('aiAssistant.noInput') : t('aiAssistant.open')}
            >
              <Bot size={14} />
              <span>{t('aiAssistant.open')}</span>
            </button>
            {shouldShowOCRButton && (
              <button
                className="preview-tool-btn"
                onClick={() => handleOCR(item)}
                disabled={ocrProcessing === item.id}
              >
                <Search size={14} />
                <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
              </button>
            )}
            {shouldShowOpenButton && (
              <button className="preview-tool-btn" onClick={handleOpen} title={openButtonTitle}>
                <ExternalLink size={14} />
                <span>{t('item.open')}</span>
              </button>
            )}
            {shouldShowRevealButton && (
              <button className="preview-tool-btn" onClick={handleReveal} title={t('item.revealInFolder')}>
                <FolderOpen size={14} />
                <span>{t('item.revealInFolder')}</span>
              </button>
            )}
            {shouldShowSaveImageButton && (
              <button
                className="preview-tool-btn"
                onClick={() => handleSaveImageAs(item)}
                title={t('item.saveImageAs')}
              >
                <Download size={14} />
                <span>{t('item.saveAs')}</span>
              </button>
            )}
            {item.type_ !== 'image' && item.type_ !== 'file' && !item.code_language && !item.has_raw_formats && (
              <button className="preview-tool-btn" onClick={handleStartEditContent}>
                <Edit2 size={14} />
                <span>{t('panel.editContent')}</span>
              </button>
            )}
            <button className="preview-tool-btn" onClick={() => openShareModal(item)}>
              <Share2 size={14} />
              <span>{t('share.button')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;
