import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft, Inbox, Star, Sparkles, Search, StickyNote,
  ExternalLink, Check, FileText, Copy, Download, Trash2, FolderOpen, Braces, Share2, Edit2, Clock3, Palette, Bot, Lock, MoreHorizontal, Maximize2
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
import { getUserTags as getUserTagsSvc } from '../../services/clipboardService';
import AIAssistantPanel from '../../features/ai-assistant/components/AIAssistantPanel';
import ItemTags from '../ItemCard/ItemTags';
import NoteDisplay from '../ItemCard/NoteDisplay';
import FilePreviewItem from './FilePreview';
import ImageLightbox from '../ImageLightbox/ImageLightbox';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

function PreviewPanel() {
  const { t, i18n } = useTranslation();
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isToolbarCompact, setIsToolbarCompact] = useState(false);
  const [showSecondaryTools, setShowSecondaryTools] = useState(false);
  const [openFeedback, setOpenFeedback] = useState(null); // 'open' | 'reveal'
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [previewToast, setPreviewToast] = useState('');
  const [copiedToolbarAction, setCopiedToolbarAction] = useState(null);
  const [showTimestampConverted, setShowTimestampConverted] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [debouncedTagSuggestionQuery, setDebouncedTagSuggestionQuery] = useState('');
  const [backendUserTags, setBackendUserTags] = useState([]);
  const toolbarRef = useRef(null);
  const toolbarCopyTimerRef = useRef(null);
  const previewToastTimerRef = useRef(null);
  const panelRef = useRef(null);
  const contentSelectableRef = useRef(null);

  const previewItem = useAppStore(s => s.previewItem);
  const switchToWorkbench = useAppStore(s => s.switchToWorkbench);
  const backFromPreview = useAppStore(s => s.backFromPreview);
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
  const isProUser = useAppStore(s => s.isProUser);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const items = useAppStore(s => s.items);
  const itemsRevision = useAppStore(s => s.itemsRevision);
  const openShareModal = useAppStore(s => s.openShareModal);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const selectedItemIds = useAppStore(s => s.selectedItemIds);

  // 澶囨敞鐩稿叧
  const editingNoteId = useAppStore(s => s.editingNoteId);
  const editNote = useAppStore(s => s.editNote);
  const setEditNote = useAppStore(s => s.setEditNote);
  const startEditNote = useAppStore(s => s.startEditNote);
  const saveNote = useAppStore(s => s.saveNote);
  const cancelNoteEdit = useAppStore(s => s.cancelNoteEdit);

  // 鏍囩鐩稿叧
  const selectedTags = useAppStore(s => s.selectedTags);
  const addingTagItemId = useAppStore(s => s.addingTagItemId);
  const newTagInput = useAppStore(s => s.newTagInput);
  const setNewTagInput = useAppStore(s => s.setNewTagInput);
  const startAddTag = useAppStore(s => s.startAddTag);
  const cancelAddTag = useAppStore(s => s.cancelAddTag);
  const addTagToItem = useAppStore(s => s.addTagToItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);

  // Prefer hydrated preview payload while still inheriting fast-changing flags from list state.
  const item = useMemo(() => {
    if (!previewItem?.id) return null;
    const latest = items.find(i => i.id === previewItem.id);
    if (!latest) return previewItem;
    return {
      ...latest,
      content: previewItem.content ?? latest.content,
      original_content: previewItem.original_content ?? latest.original_content,
      ocr_text: previewItem.ocr_text ?? latest.ocr_text,
      content_truncated: Boolean(previewItem.content_truncated),
      ocr_truncated: Boolean(previewItem.ocr_truncated),
    };
  }, [items, previewItem]);

  if (!item) {
    switchToWorkbench();
    return null;
  }

  const isCopied = copiedItemId === item.id && copyFeedbackSource === 'preview';
  const tags = getTags(item.tags);
  const hasAITags = tags.some(tag => tag.startsWith('AI:'));
  const shouldShowAIButton = aiEnabled && item.type_ === 'text' && item.content && !hasAITags;
  const aiLocked = shouldShowAIButton && !isProUser;
  const shouldShowOCRButton = ocrEnabled && item.type_ === 'image' && !item.ocr_text;
  const ocrLocked = shouldShowOCRButton && !isProUser;
  const textOpenableUrls = useMemo(() => {
    if (item.type_ !== 'text') return [];
    return extractOpenableUrls(item.content);
  }, [item.type_, item.content]);
  const textOpenablePaths = useMemo(() => {
    if (item.type_ !== 'text') return [];
    return extractOpenableFilePaths(item.content);
  }, [item.type_, item.content]);
  const shouldShowOpenButton = item.type_ === 'link' || item.type_ === 'file' || textOpenablePaths.length > 0 || textOpenableUrls.length > 0;
  const shouldShowRevealButton = item.type_ === 'file' || (item.type_ === 'image' && !!item.image_paths) || textOpenablePaths.length > 0;
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
  const previewTypeClass = item.code_language ? 'type-code' : `type-${item.type_ || 'text'}`;
  const itemTypeLabel = useMemo(() => {
    const typeKey = item.code_language
      ? 'code'
      : (['text', 'image', 'file', 'link'].includes(item.type_) ? item.type_ : 'all');
    return t(`search.typeFilter.${typeKey}`);
  }, [item.code_language, item.type_, t]);
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
      if (previewToastTimerRef.current) {
        clearTimeout(previewToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCopiedToolbarAction(null);
  }, [item.id]);

  useEffect(() => {
    setShowSecondaryTools(false);
  }, [item.id, isEditingContent]);

  useEffect(() => {
    if (!isToolbarCompact) {
      setShowSecondaryTools(false);
    }
  }, [isToolbarCompact]);

  useEffect(() => {
    setShowTimestampConverted(false);
  }, [item.id]);

  useEffect(() => {
    setShowAIAssistant(false);
  }, [item.id]);

  const showPreviewToast = useCallback((message, duration = 2000) => {
    if (!message) return;
    setPreviewToast(message);
    if (previewToastTimerRef.current) {
      clearTimeout(previewToastTimerRef.current);
    }
    previewToastTimerRef.current = setTimeout(() => {
      setPreviewToast('');
      previewToastTimerRef.current = null;
    }, duration);
  }, []);

  // 鏀堕泦骞跺垏鍥炴敹闆嗙
  const handlePreviewPinToggle = async () => {
    const wasPinned = item.is_pinned;
    await togglePin(item);
    if (wasPinned) {
      switchToWorkbench();
    }
  };

  // 寮€濮嬬紪杈戝唴瀹?
  const handleStartEditContent = () => {
    setEditContent(item.content || '');
    setIsEditingContent(true);
  };

  // 鍐呭鍖洪敭鐩樹簨浠跺鐞?
  const handleContentKeyDown = (e) => {
    // Ctrl+A / Cmd+A: select only current preview content block, not whole page
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      if (selectPreviewContent()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  // 鍐呭鍖哄弻鍑昏涓?
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
        const copied = await handleCopy(item, 'preview');
        if (!copied) {
          showPreviewToast(t('workbench.copySkippedQollectSource'));
        }
      }
    }
  };

  // 鍒犻櫎鎸夐挳鐐瑰嚮
  const handleDeleteClick = () => {
    if (showDeleteConfirm) {
      deleteItem(item);
    } else {
      setShowDeleteConfirm(true);
      showPreviewToast(t('item.confirmDelete'));
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const handlePreviewCopy = useCallback(async () => {
    const copied = await handleCopy(item, 'preview');
    if (!copied) {
      showPreviewToast(t('workbench.copySkippedQollectSource'));
    }
  }, [handleCopy, item, showPreviewToast, t]);

  // 淇濆瓨鍐呭缂栬緫
  const handleSaveContent = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const updatedItem = {
        ...item,
        content: editContent,
        content_updated: true,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await useAppStore.getState().loadItems();
      setIsEditingContent(false);
    } catch (error) {
      console.error('淇濆瓨鍐呭澶辫触:', error);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTagSuggestionQuery(newTagInput.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [newTagInput]);

  useEffect(() => {
    let cancelled = false;
    getUserTagsSvc(debouncedTagSuggestionQuery, 120)
      .then((tags) => {
        if (cancelled) return;
        if (!Array.isArray(tags)) {
          setBackendUserTags([]);
          return;
        }
        const seenTags = new Set();
        const normalized = [];
        tags.forEach((tag) => {
          if (typeof tag !== 'string') return;
          const normalizedTag = tag.trim();
          if (!normalizedTag || normalizedTag.startsWith('AI:') || seenTags.has(normalizedTag)) return;
          seenTags.add(normalizedTag);
          normalized.push(normalizedTag);
        });
        setBackendUserTags(normalized);
      })
      .catch((error) => {
        console.error('[PreviewPanel] load user tags failed:', error);
        if (!cancelled) setBackendUserTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedTagSuggestionQuery, itemsRevision]);

  const filteredUserTags = useMemo(() => {
    const query = newTagInput.trim().toLowerCase();
    if (!query) return backendUserTags;

    const prefixMatches = [];
    const partialMatches = [];
    backendUserTags.forEach((tag) => {
      const normalizedTag = tag.toLowerCase();
      if (!normalizedTag.includes(query)) return;
      if (normalizedTag.startsWith(query)) {
        prefixMatches.push(tag);
      } else {
        partialMatches.push(tag);
      }
    });
    return [...prefixMatches, ...partialMatches];
  }, [backendUserTags, newTagInput]);

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
    if (openFeedback === 'open') return;
    setOpenFeedback('open');
    setTimeout(() => setOpenFeedback(null), 1500);
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
  }, [handleOpenItem, handleOpenUrl, item, textOpenablePaths, textOpenableUrls, openFeedback]);

  const handleReveal = useCallback(() => {
    if (openFeedback === 'reveal') return;
    setOpenFeedback('reveal');
    setTimeout(() => setOpenFeedback(null), 1500);
    if (item.type_ === 'file' || item.type_ === 'image') {
      handleRevealInFolder(item);
      return;
    }
    if (textOpenablePaths.length > 0) {
      invoke('reveal_file_path', { path: textOpenablePaths[0] }).catch((error) => {
        console.error('reveal file path failed:', error);
      });
    }
  }, [handleRevealInFolder, item, textOpenablePaths, openFeedback]);

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
      const imageSrc = getImageOriginal(item.image_paths);
      const openImageOnlyView = () => setLightboxSrc(imageSrc);
      return (
        <div
          ref={contentSelectableRef}
          className="preview-image-content"
          onDoubleClick={openImageOnlyView}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={t('item.imageHoverZoomHint')}
        >
          <div className="preview-image-stage">
            <img src={imageSrc} alt="" />
            <div className="preview-image-hover-hint">{t('item.imageHoverZoomHint')}</div>
            <button
              type="button"
              className="preview-image-only-btn"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openImageOnlyView();
              }}
            >
              <Maximize2 size={12} />
              <span>{t('item.imageOnlyView')}</span>
            </button>
          </div>
          <div className="preview-image-inline-actions">
            <button
              type="button"
              className="preview-image-inline-btn"
              onClick={openImageOnlyView}
            >
              <Maximize2 size={12} />
              <span>{t('item.imageOnlyView')}</span>
            </button>
            <span className="preview-image-inline-hint">{t('item.imageLightboxHint')}</span>
          </div>
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
    <div className={`preview-panel ${previewTypeClass}`} ref={panelRef}>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <div className="preview-nav">
        <div className="preview-nav-main">
          <button className="preview-back-btn" onClick={backFromPreview}>
            <ArrowLeft size={16} />
          </button>
          <div className="preview-nav-context">
            <span className="preview-nav-type">{itemTypeLabel}</span>
            <span className="preview-nav-divider">|</span>
            <span className="preview-nav-source">{getSourceApp(item.metadata)}</span>
            <span className="preview-nav-divider">|</span>
            <span className="preview-nav-updated">{formatDate(item.updated_at, i18n.language)}</span>
          </div>
        </div>
        <div className="preview-nav-actions">
          <button
            className={`preview-action-btn copy-btn ${isCopied ? 'copied' : ''}`}
            onClick={handlePreviewCopy}
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
            title={item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems || 10 })}
          >
            <Inbox size={16} />
          </button>
          {shouldShowSaveImageButton && (
            <button
              className="preview-action-btn image-only-btn"
              onClick={() => setLightboxSrc(getImageOriginal(item.image_paths))}
              title={t('item.imageOnlyView')}
              aria-label={t('item.imageOnlyView')}
            >
              <Maximize2 size={16} />
            </button>
          )}
          <span className="preview-nav-action-divider" aria-hidden="true" />
          <button
            className={`preview-action-btn delete-btn ${showDeleteConfirm ? 'confirm' : ''}`}
            onClick={handleDeleteClick}
            title={showDeleteConfirm ? t('item.confirmDelete') : t('item.delete')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* 鏍囩鍖?*/}
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

      {/* 鍐呭鍖?*/}
      <div className={`preview-content-area ${isEditingContent ? 'editing' : ''} ${showAIAssistant ? 'ai-assistant-mode' : ''}`}>
        {isCopied && (
          <div className="copy-success-toast">
            <Check size={16} /> {t('item.copied')}
          </div>
        )}
        {previewToast && (
          <div className="preview-action-toast" role="status" aria-live="polite">
            {previewToast}
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

      {/* 澶囨敞鍖?- 鍐呭涓嬫柟锛屼綔涓烘壒娉?*/}
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

      {/* 鍏冧俊鎭?- 搴曢儴鍙傝€?*/}
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
          <span className="preview-meta-time">{formatDate(item.updated_at, i18n.language)}</span>
          <span className="preview-meta-source">{getSourceApp(item.metadata)}</span>
        </div>
      )}

      {/* 宸ュ叿鏍?*/}
      <div
        ref={toolbarRef}
        className={`preview-toolbar ${isToolbarCompact ? 'compact' : ''} ${showSecondaryTools ? 'show-secondary' : ''}`}
      >
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
                className={`preview-tool-btn secondary ${copiedToolbarAction === 'plain-text' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('plain-text', () => handleCopyPlainText(item.content, 'preview'))}
              >
                {copiedToolbarAction === 'plain-text' ? <Check size={14} /> : <FileText size={14} />}
                <span>{copiedToolbarAction === 'plain-text' ? t('item.copied') : t('item.copyPlainText')}</span>
              </button>
            )}
            {isJson && (
              <button
                className={`preview-tool-btn secondary ${copiedToolbarAction === 'json' ? 'copied' : ''}`}
                onClick={() => runToolbarCopyAction('json', handleFormatJsonCopy)}
              >
                {copiedToolbarAction === 'json' ? <Check size={14} /> : <Braces size={14} />}
                <span>{copiedToolbarAction === 'json' ? t('item.copied') : t('item.formatJsonCopy')}</span>
              </button>
            )}
            {pureColorPreview && (
              <button
                className={`preview-tool-btn secondary color-format ${copiedToolbarAction === 'hex' ? 'copied' : ''}`}
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
                className={`preview-tool-btn secondary color-format ${copiedToolbarAction === 'rgb' ? 'copied' : ''}`}
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
                className={`preview-tool-btn secondary color-format ${copiedToolbarAction === 'hsl' ? 'copied' : ''}`}
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
                className={`preview-tool-btn secondary ${showTimestampConverted ? 'active' : ''}`}
                onClick={() => setShowTimestampConverted((prev) => !prev)}
                title={t('item.convertTimestamp')}
              >
                <Clock3 size={14} />
                <span>{t('item.convertTimestamp')}</span>
              </button>
            )}
            {shouldShowAIButton && (
              <button
                className={`preview-tool-btn ${aiLocked ? 'locked' : ''}`}
                onClick={() => aiLocked ? useAppStore.getState().setShowSettings(true, 'license') : generateAITags(item)}
                disabled={!aiLocked && generatingAI === item.id}
                title={aiLocked ? t('license.proFeature') : undefined}
              >
                {aiLocked ? <Lock size={14} /> : <Sparkles size={14} />}
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
                className={`preview-tool-btn ${ocrLocked ? 'locked' : ''}`}
                onClick={() => ocrLocked ? useAppStore.getState().setShowSettings(true, 'license') : handleOCR(item)}
                disabled={!ocrLocked && ocrProcessing === item.id}
                title={ocrLocked ? t('license.proFeature') : undefined}
              >
                {ocrLocked ? <Lock size={14} /> : <Search size={14} />}
                <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
              </button>
            )}
            {isToolbarCompact && (
              <button
                className={`preview-tool-btn tool-more-btn ${showSecondaryTools ? 'active' : ''}`}
                onClick={() => setShowSecondaryTools(prev => !prev)}
                title={t('workbench.moreActions')}
                aria-pressed={showSecondaryTools}
              >
                <MoreHorizontal size={14} />
                <span>{t('workbench.moreActions')}</span>
              </button>
            )}
            {shouldShowOpenButton && (
              <button className={`preview-tool-btn secondary ${openFeedback === 'open' ? 'clicked-feedback' : ''}`} onClick={handleOpen} title={openButtonTitle}>
                {openFeedback === 'open' ? <Check size={14} /> : <ExternalLink size={14} />}
                <span>{openFeedback === 'open' ? t('item.opened') : t('item.open')}</span>
              </button>
            )}
            {shouldShowRevealButton && (
              <button className={`preview-tool-btn secondary ${openFeedback === 'reveal' ? 'clicked-feedback' : ''}`} onClick={handleReveal} title={t('item.revealInFolder')}>
                {openFeedback === 'reveal' ? <Check size={14} /> : <FolderOpen size={14} />}
                <span>{openFeedback === 'reveal' ? t('item.opened') : t('item.revealInFolder')}</span>
              </button>
            )}
            {shouldShowSaveImageButton && (
              <button
                className="preview-tool-btn secondary"
                onClick={() => setLightboxSrc(getImageOriginal(item.image_paths))}
                title={t('item.imageOnlyView')}
              >
                <Maximize2 size={14} />
                <span>{t('item.imageOnlyView')}</span>
              </button>
            )}
            {shouldShowSaveImageButton && (
              <button
                className="preview-tool-btn secondary"
                onClick={() => handleSaveImageAs(item)}
                title={t('item.saveImageAs')}
              >
                <Download size={14} />
                <span>{t('item.saveAs')}</span>
              </button>
            )}
            {item.type_ !== 'image' && item.type_ !== 'file' && !item.code_language && (
              <button className="preview-tool-btn secondary" onClick={handleStartEditContent}>
                <Edit2 size={14} />
                <span>{t('panel.editContent')}</span>
              </button>
            )}
            <button className="preview-tool-btn secondary" onClick={() => openShareModal(item)}>
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
