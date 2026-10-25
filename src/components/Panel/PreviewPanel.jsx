import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowLeft, Inbox, Star, Sparkles, Search, StickyNote,
  ExternalLink, Check, FileText, Copy, Download, Trash2, FolderOpen, Braces, Share2, Edit2, Clock3, Palette, Bot, Lock, MoreHorizontal, Maximize2, Languages, Mail, RefreshCw, ScanText
} from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { buildItemDerivations } from '../../store/modules/itemsIndex';
import {
  getContentPreview,
  getFileList,
  getFileName,
  formatDate,
  extractOpenableUrls,
  extractOpenableFilePaths,
  detectTimestampCandidate,
  formatTimestampCandidate,
  isDateTimeCandidate,
  parsePureColorText,
} from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags, getSourceApp } from '../../utils/tagHelpers';
import { getUserTags as getUserTagsSvc } from '../../services/clipboardService';
import { getTranslationFromMetadata } from '../../utils/translationHelpers';
import { getAiRetrievalFromMetadata } from '../../utils/filenameNaming';
import AIAssistantPanel from '../../features/ai-assistant/components/AIAssistantPanel';
import ItemTags from '../ItemCard/ItemTags';
import NoteDisplay from '../ItemCard/NoteDisplay';
import FilePreviewItem from './FilePreview';
import ImageLightbox from '../ImageLightbox/ImageLightbox';
import { isCurlCommand } from '../../utils/curlParser';
import CurlBox from '../CurlBox/CurlBox';
import { resolveMatchingTransforms } from '../../utils/transforms/index.js';
import { TextChunkSplitter } from './TextChunkSplitter';
import { sendClipboardItemViaEmail } from '../../services/emailRelayService';
import MarkdownView from './MarkdownView';
import { isLikelyMarkdown } from '../../utils/markdownRenderer';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

function PreviewPanel() {
  const { t, i18n } = useTranslation();
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isToolbarCompact, setIsToolbarCompact] = useState(false);
  const [showSecondaryTools, setShowSecondaryTools] = useState(false);
  const [panelMetrics, setPanelMetrics] = useState({ width: 0, height: 0 });
  const [openFeedback, setOpenFeedback] = useState(null); // 'open' | 'reveal'
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [previewToast, setPreviewToast] = useState('');
  const [copiedToolbarAction, setCopiedToolbarAction] = useState(null);
  const [showDecodedView, setShowDecodedView] = useState(false);
  const [showMarkdownRaw, setShowMarkdownRaw] = useState(false);
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
  const itemsRevision = useAppStore(s => s.itemsRevision);
  const openShareModal = useAppStore(s => s.openShareModal);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const selectedItemIds = useAppStore(s => s.selectedItemIds);
  const emailRelayConfig = useAppStore(s => s.emailRelayConfig);
  const textChunkSplitterEnabled = useAppStore(s => s.textChunkSplitterEnabled);
  const emailRelayEnabled = useAppStore(s => s.emailRelayEnabled);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const previewItemId = previewItem?.id ?? null;
  const livePreviewItem = useAppStore(useCallback(
    (state) => {
      if (!previewItemId) return null;
      return state.itemsById?.get(previewItemId) || null;
    },
    [previewItemId],
  ));

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
  const setWorkbenchPanelEnabled = useAppStore(s => s.setWorkbenchPanelEnabled);

  const handleEmptyBack = useCallback(() => {
    backFromPreview();
    setWorkbenchPanelEnabled(false);
  }, [backFromPreview, setWorkbenchPanelEnabled]);

  // Prefer hydrated preview payload while still inheriting fast-changing flags from list state.
  const item = useMemo(() => {
    if (!previewItemId) return null;
    const latest = livePreviewItem;
    if (!latest) return previewItem;

    const hasHydratedContent = Boolean(
      previewItem && !previewItem.content_truncated && previewItem.content != null
    );
    const hasHydratedOcr = Boolean(
      previewItem && !previewItem.ocr_truncated && previewItem.ocr_text != null
    );

    return {
      ...latest,
      content: hasHydratedContent ? previewItem.content : (latest.content ?? previewItem?.content),
      original_content: previewItem?.original_content ?? latest.original_content,
      ocr_text: hasHydratedOcr ? previewItem.ocr_text : (latest.ocr_text ?? previewItem?.ocr_text),
      content_truncated: hasHydratedContent
        ? false
        : Boolean(previewItem?.content_truncated ?? latest.content_truncated),
      ocr_truncated: hasHydratedOcr
        ? false
        : Boolean(previewItem?.ocr_truncated ?? latest.ocr_truncated),
    };
  }, [livePreviewItem, previewItem, previewItemId]);

  if (!item) {
    return (
      <div className="preview-panel preview-panel--empty" ref={panelRef}>
        <div className="preview-empty-state">
          <Inbox size={42} strokeWidth={1.4} className="preview-empty-icon" />
          <div className="preview-empty-title">
            {t('preview.noItemSelected', '未选择条目')}
          </div>
          <div className="preview-empty-hint">
            {t('preview.selectHint', '在左侧点击或使用方向键选中条目以查看高保真预览与详情')}
          </div>
          <button
            type="button"
            className="preview-empty-back-btn"
            onClick={handleEmptyBack}
          >
            <ArrowLeft size={13} />
            {t('preview.backToList', '返回列表')}
          </button>
        </div>
      </div>
    );
  }

  const isCopied = copiedItemId === item.id && copyFeedbackSource === 'preview';
  const tags = getTags(item.tags);
  const hasAITags = tags.some(tag => tag.startsWith('AI:'));
  const shouldShowAIButton = aiEnabled && item.type_ === 'text' && item.content && !hasAITags;
  const aiLocked = shouldShowAIButton && !isProUser;
  const shouldShowOCRButton = Boolean(item.type_ === 'image' && !item.ocr_text);
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
  const isCurlCandidate = useMemo(() => {
    if (item.type_ !== 'text' || !item.content) return false;
    return isCurlCommand(item.content);
  }, [item.type_, item.content]);
  const isDateTime = useMemo(() => {
    if (item.type_ !== 'text' || !item.content) return false;
    return isDateTimeCandidate(item.content);
  }, [item.type_, item.content]);
  const convertedTimestampText = useMemo(() => (
    timestampCandidate ? formatTimestampCandidate(timestampCandidate, i18n.language) : ''
  ), [timestampCandidate, i18n.language]);

  const activeTransforms = useMemo(() => {
    if (!item?.content || (item.type_ !== 'text' && item.type_ !== 'code' && !item.code_language)) {
      return [];
    }
    return resolveMatchingTransforms(item.content, { language: i18n.language });
  }, [item?.content, item?.type_, item?.code_language, i18n.language]);

  const previewableRule = useMemo(() => {
    return activeTransforms.find((r) => r.previewable) || null;
  }, [activeTransforms]);

  const contentToDisplay = useMemo(() => {
    if (showDecodedView && previewableRule) {
      return previewableRule.apply(item.content, { language: i18n.language });
    }
    return item.content || '';
  }, [showDecodedView, previewableRule, item.content, i18n.language]);

  useEffect(() => {
    setShowDecodedView(false);
  }, [item?.id]);
  const openButtonTitle = (item.type_ === 'file' || textOpenablePaths.length > 0) ? t('item.openFile') : t('item.openLink');
  const previewTypeClass = item.code_language ? 'type-code' : `type-${item.type_ || 'text'}`;
  const aiRetrieval = useMemo(() => getAiRetrievalFromMetadata(item?.metadata), [item?.metadata]);
  const itemTypeLabel = useMemo(() => {
    if (isCurlCandidate) return t('curl.badge', 'cURL');
    if (isDateTime) return t('search.typeFilter.time', '时间');
    const typeKey = item.code_language
      ? 'code'
      : (['text', 'image', 'file', 'link'].includes(item.type_) ? item.type_ : 'all');
    return t(`search.typeFilter.${typeKey}`);
  }, [isCurlCandidate, isDateTime, item.code_language, item.type_, t]);
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

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return undefined;

    const updatePanelMetrics = () => {
      const rect = panelEl.getBoundingClientRect();
      setPanelMetrics({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    updatePanelMetrics();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updatePanelMetrics);
      return () => window.removeEventListener('resize', updatePanelMetrics);
    }

    const observer = new ResizeObserver(updatePanelMetrics);
    observer.observe(panelEl);
    return () => observer.disconnect();
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
    setShowAIAssistant(false);
    setIsEditingContent(false);
    setShowMarkdownRaw(false);
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


  // 寮€濮嬬紪杈戝唴瀹?
  const handleStartEditContent = () => {
    setShowAIAssistant(false);
    cancelNoteEdit();
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
      if (contentToDisplay) {
        await handleCopyPlainText(contentToDisplay, 'preview');
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

  const handleQuickSendEmail = async (e) => {
    e?.stopPropagation();
    if (!item || isSendingEmail) return;
    if (!emailRelayConfig?.from_address) {
      showPreviewToast(t('item.emailNotConfigured'));
      return;
    }
    setIsSendingEmail(true);
    try {
      const recipients = await sendClipboardItemViaEmail({
        itemId: item.id,
        recipients: [],
      });
      showPreviewToast(t('item.sentToEmailToast', { email: recipients || emailRelayConfig.from_address }));
    } catch (err) {
      console.error('Send clipboard item via email failed:', err);
      showPreviewToast(t('item.sendEmailFailed', { error: String(err) }));
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleTriggerOCR = useCallback(async () => {
    if (!item || item.type_ !== 'image' || ocrProcessing === item.id) return;
    try {
      const text = await handleOCR(item);
      if (text && text.trim()) {
        showPreviewToast(t('item.recognizedText'));
      } else {
        showPreviewToast(t('item.noTextRecognized', { defaultValue: '未识别到有效文字' }));
      }
    } catch (err) {
      const rawMsg = String(err?.message || err || '');
      const isNotConfigured = rawMsg.includes('not initialized') || rawMsg.includes('未初始化');
      showPreviewToast(
        isNotConfigured
          ? t('settings.ocr.notConfigured', { defaultValue: 'OCR 服务未初始化，请先在设置中配置' })
          : t('item.ocrFailed', { defaultValue: `OCR 识别失败: ${rawMsg}` })
      );
    }
  }, [handleOCR, item, ocrProcessing, showPreviewToast, t]);

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
      const updatedAt = Math.floor(Date.now() / 1000);
      const updatedItem = {
        ...item,
        content: editContent,
        content_updated: true,
        content_truncated: false,
        updated_at: updatedAt,
      };
      await invoke('update_item', { item: updatedItem });
      useAppStore.setState((state) => {
        const nextItems = state.items.map((candidate) => (
          candidate.id === updatedItem.id
            ? {
              ...candidate,
              content: updatedItem.content,
              content_updated: updatedItem.content_updated,
              content_truncated: false,
              updated_at: updatedAt,
            }
            : candidate
        ));
        return {
          items: nextItems,
          ...buildItemDerivations(nextItems),
          previewItem: state.previewItem?.id === updatedItem.id
            ? {
              ...state.previewItem,
              ...updatedItem,
            }
            : state.previewItem,
          itemsRevision: state.itemsRevision + 1,
        };
      });
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

  useEffect(() => {
    const handleGlobalEscape = (e) => {
      if (e.key !== 'Escape') return;
      if (lightboxSrc) return;
      if (isEditingContent) return;
      if (editingNoteId) return;
      if (addingTagItemId) return;
      backFromPreview();
    };
    window.addEventListener('keydown', handleGlobalEscape);
    return () => window.removeEventListener('keydown', handleGlobalEscape);
  }, [lightboxSrc, isEditingContent, editingNoteId, addingTagItemId, backFromPreview]);

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
            if (e.key === 'Enter' && e.ctrlKey) {
              e.stopPropagation();
              handleSaveContent();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              e.preventDefault();
              setIsEditingContent(false);
            }
          }}
          autoFocus
        />
      );
    }

    const isMarkdownText = Boolean(
      item.type_ !== 'image' &&
      item.type_ !== 'file' &&
      contentToDisplay &&
      (item.code_language === 'markdown' || isLikelyMarkdown(contentToDisplay))
    );

    if (isMarkdownText && !showMarkdownRaw) {
      return (
        <div className="preview-text-wrapper">
          {textChunkSplitterEnabled && (
            <TextChunkSplitter
              text={contentToDisplay}
              onCopyChunk={(chunkText) => handleCopyPlainText(chunkText, 'preview')}
              showToast={showPreviewToast}
            />
          )}
          <div className="preview-transform-toggle-bar">
            <span className="preview-transform-toggle-hint">
              <FileText size={13} />
              <span>{t('transforms.markdownDoc')}</span>
            </span>
            <div className="preview-transform-pill-group">
              <button
                type="button"
                className="preview-transform-pill active"
                onClick={() => setShowMarkdownRaw(false)}
              >
                {t('transforms.markdownRender')}
              </button>
              <button
                type="button"
                className="preview-transform-pill"
                onClick={() => setShowMarkdownRaw(true)}
              >
                {t('transforms.markdownRaw')}
              </button>
            </div>
          </div>
          <div
            ref={contentSelectableRef}
            className="preview-markdown-content"
            tabIndex={0}
            title={t('item.doubleClickToCopy')}
          >
            <MarkdownView
              content={contentToDisplay}
              onDoubleClick={handleContentDoubleClick}
              onKeyDown={handleContentKeyDown}
              tabIndex={0}
              title={t('item.doubleClickToCopy')}
            />
          </div>
        </div>
      );
    }

    if (item.code_language && item.content) {
      const PreviewableIcon = previewableRule?.icon;
      return (
        <div className="preview-text-wrapper">
          {textChunkSplitterEnabled && (
            <TextChunkSplitter
              text={contentToDisplay}
              onCopyChunk={(chunkText) => handleCopyPlainText(chunkText, 'preview')}
              showToast={showPreviewToast}
            />
          )}
          {isMarkdownText && showMarkdownRaw && (
            <div className="preview-transform-toggle-bar">
              <span className="preview-transform-toggle-hint">
                <FileText size={13} />
                <span>{t('transforms.markdownDoc')}</span>
              </span>
              <div className="preview-transform-pill-group">
                <button
                  type="button"
                  className="preview-transform-pill"
                  onClick={() => setShowMarkdownRaw(false)}
                >
                  {t('transforms.markdownRender')}
                </button>
                <button
                  type="button"
                  className="preview-transform-pill active"
                  onClick={() => setShowMarkdownRaw(true)}
                >
                  {t('transforms.markdownRaw')}
                </button>
              </div>
            </div>
          )}
          {previewableRule && (
            <div className="preview-transform-toggle-bar">
              <span className="preview-transform-toggle-hint">
                <PreviewableIcon size={13} />
                <span>{t(previewableRule.titleKey)}</span>
              </span>
              <div className="preview-transform-pill-group">
                <button
                  type="button"
                  className={`preview-transform-pill ${!showDecodedView ? 'active' : ''}`}
                  onClick={() => setShowDecodedView(false)}
                >
                  {t('transforms.viewRaw')}
                </button>
                <button
                  type="button"
                  className={`preview-transform-pill ${showDecodedView ? 'active' : ''}`}
                  onClick={() => setShowDecodedView(true)}
                >
                  {t('transforms.viewTransformed')}
                </button>
              </div>
            </div>
          )}
          <div
            ref={contentSelectableRef}
            className="preview-code-content"
            onKeyDown={handleContentKeyDown}
            tabIndex={0}
            title={t('item.doubleClickToCopy')}
          >
            <Suspense fallback={<div className="preview-text-content">{contentToDisplay}</div>}>
              <CodeBlock code={contentToDisplay} language={item.code_language} maxLines={200} />
            </Suspense>
          </div>
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
          </div>
          <div className="preview-image-inline-actions">
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
    const translation = getTranslationFromMetadata(item.metadata);
    const PreviewableIcon = previewableRule?.icon;
    return (
      <div className="preview-text-wrapper">
        {textChunkSplitterEnabled && (
          <TextChunkSplitter
            text={contentToDisplay}
            onCopyChunk={(chunkText) => handleCopyPlainText(chunkText, 'preview')}
            showToast={showPreviewToast}
          />
        )}
        {isMarkdownText && showMarkdownRaw && (
          <div className="preview-transform-toggle-bar">
            <span className="preview-transform-toggle-hint">
              <FileText size={13} />
              <span>{t('transforms.markdownDoc')}</span>
            </span>
            <div className="preview-transform-pill-group">
              <button
                type="button"
                className="preview-transform-pill"
                onClick={() => setShowMarkdownRaw(false)}
              >
                {t('transforms.markdownRender')}
              </button>
              <button
                type="button"
                className="preview-transform-pill active"
                onClick={() => setShowMarkdownRaw(true)}
              >
                {t('transforms.markdownRaw')}
              </button>
            </div>
          </div>
        )}
        {previewableRule && (
          <div className="preview-transform-toggle-bar">
            <span className="preview-transform-toggle-hint">
              <PreviewableIcon size={13} />
              <span>{t(previewableRule.titleKey)}</span>
            </span>
            <div className="preview-transform-pill-group">
              <button
                type="button"
                className={`preview-transform-pill ${!showDecodedView ? 'active' : ''}`}
                onClick={() => setShowDecodedView(false)}
              >
                {t('transforms.viewRaw')}
              </button>
              <button
                type="button"
                className={`preview-transform-pill ${showDecodedView ? 'active' : ''}`}
                onClick={() => setShowDecodedView(true)}
              >
                {t('transforms.viewTransformed')}
              </button>
            </div>
          </div>
        )}
        <div
          ref={contentSelectableRef}
          className="preview-text-content"
          onDoubleClick={handleContentDoubleClick}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={item.type_ === 'file' ? t('item.doubleClickToOpen') : t('item.doubleClickToCopy')}
        >
          {getContentPreview(contentToDisplay)}
        </div>
        {translation && (
          <div className="preview-translation-card" style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--primary-color)' }}>
                <Languages size={14} />
                <span>{t('item.translatedText')}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>({translation.source_lang} ➔ {translation.target_lang})</span>
              </div>
              <button
                type="button"
                className="preview-trans-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(translation.text);
                  setPreviewToast(t('item.translationCopied'));
                  setTimeout(() => setPreviewToast(''), 1500);
                }}
                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Copy size={11} /> {t('item.copyTranslation')}
              </button>
            </div>
            <div style={{ fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
              {translation.text}
            </div>
          </div>
        )}
      </div>
    );
  };

  const isNoteEditing = editingNoteId === item.id;
  const previewBodyRef = useRef(null);
  const noteSectionRef = useRef(null);
  const wasNoteEditingRef = useRef(false);

  useEffect(() => {
    if (isNoteEditing) {
      wasNoteEditingRef.current = true;
      const timer = setTimeout(() => {
        if (noteSectionRef.current && previewBodyRef.current) {
          const targetTop = noteSectionRef.current.offsetTop;
          previewBodyRef.current.scrollTo({
            top: targetTop,
            behavior: 'smooth',
          });
        }
      }, 50);
      return () => clearTimeout(timer);
    } else if (wasNoteEditingRef.current) {
      wasNoteEditingRef.current = false;
      if (previewBodyRef.current) {
        previewBodyRef.current.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }
  }, [isNoteEditing]);

  useEffect(() => {
    wasNoteEditingRef.current = false;
    if (previewBodyRef.current) {
      previewBodyRef.current.scrollTop = 0;
    }
  }, [item?.id]);

  return (
    <div className={`preview-panel ${previewTypeClass}`} ref={panelRef}>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      <div className="preview-nav">
        <div className="preview-nav-main">
          <button
            type="button"
            className="preview-back-btn"
            onClick={() => {
              if (editingNoteId) {
                cancelNoteEdit();
              }
              backFromPreview();
            }}
            title={t('common.back', '返回')}
            aria-label={t('common.back', '返回')}
          >
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

      {/* 滚动容器 */}
      <div
        ref={previewBodyRef}
        className={`preview-body ${showAIAssistant ? 'ai-assistant-mode' : ''} ${isEditingContent ? 'content-editing-mode' : ''} ${isNoteEditing ? 'note-editing-mode' : ''}`}
      >
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
          {!showAIAssistant && !isEditingContent && isCurlCandidate && (
            <CurlBox item={item} onFeedback={showPreviewToast} />
          )}
          {!showAIAssistant && renderContent()}
        </div>

        {/* 备注区 - 内容下方，作为批注 */}
        {!showAIAssistant && !isEditingContent && (
          <div
            ref={noteSectionRef}
            className={`preview-note-section ${isNoteEditing ? 'is-editing' : ''} ${item.user_note ? 'has-note' : ''}`}
          >
            {isNoteEditing && (
              <div className="preview-note-header">
                <div className="preview-note-header-title">
                  <StickyNote size={14} />
                  <span>{item.user_note ? t('item.editNote') : t('item.addNote')}</span>
                </div>
                <span className="preview-note-header-hint">{t('edit.noteScrollHint', '往上滚动可查看原文')}</span>
              </div>
            )}
            <NoteDisplay
              item={item}
              editingNoteId={editingNoteId}
              editNote={editNote}
              onEditNoteChange={setEditNote}
              onStartEditNote={startEditNote}
              onSaveNote={saveNote}
              onCancelNoteEdit={cancelNoteEdit}
              variant="preview"
            />
            {!item.user_note && editingNoteId !== item.id && (
              <button
                type="button"
                className="preview-add-note-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditNote(item);
                }}
              >
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
            {convertedTimestampText && (
              <span className="preview-meta-timestamp">
                {t('item.timestampConverted')}: {convertedTimestampText}
              </span>
            )}
            <span className="preview-meta-time">{formatDate(item.updated_at, i18n.language)}</span>
            <span className="preview-meta-source">{getSourceApp(item.metadata)}</span>
            {aiRetrieval?.summary && (
              <span
                className="preview-meta-ai-summary"
                title={aiRetrieval.queries?.length ? aiRetrieval.queries.join(' | ') : aiRetrieval.summary}
              >
                💡 {aiRetrieval.summary}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 工具栏 */}
      <div
        ref={toolbarRef}
        className={`preview-toolbar ${isToolbarCompact ? 'compact' : ''} ${showSecondaryTools ? 'show-secondary' : ''}`}
      >
          {isEditingContent ? (
            <>
              <span className="preview-toolbar-hint">{t('editModal.saveHint')}</span>
              <button
                type="button"
                className="preview-tool-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingContent(false);
                }}
              >
                <span>{t('panel.cancelEdit')}</span>
              </button>
              <button
                type="button"
                className="preview-tool-btn active"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveContent();
                }}
              >
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
              {/* 动态转换规则快捷动作 */}
              {activeTransforms.map((rule) => {
                const IconComponent = rule.icon;
                const isCopied = copiedToolbarAction === rule.id;
                return (
                  <button
                    key={rule.id}
                    type="button"
                    className={`preview-tool-btn secondary ${isCopied ? 'copied' : ''}`}
                    onClick={() => runToolbarCopyAction(rule.id, () => handleCopyPlainText(rule.apply(item.content, { language: i18n.language }), 'preview'))}
                    title={t(rule.titleKey)}
                  >
                    {isCopied ? <Check size={14} /> : <IconComponent size={14} />}
                    <span>{isCopied ? t('item.copied') : t(rule.labelKey)}</span>
                  </button>
                );
              })}
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
                type="button"
                className={`preview-tool-btn ${showAIAssistant ? 'active' : ''}`}
                onClick={() => {
                  if (!showAIAssistant) {
                    setIsEditingContent(false);
                  }
                  setShowAIAssistant(prev => !prev);
                }}
                disabled={!canUseAIAssistant}
                title={!canUseAIAssistant ? t('aiAssistant.noInput') : t('aiAssistant.open')}
              >
                <Bot size={14} />
                <span>{t('aiAssistant.open')}</span>
              </button>
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
                  onClick={() => handleSaveImageAs(item)}
                  title={t('item.saveImageAs')}
                >
                  <Download size={14} />
                  <span>{t('item.saveAs')}</span>
                </button>
              )}
              {emailRelayEnabled && emailRelayConfig?.from_address && (
                <button
                  type="button"
                  className={`preview-tool-btn secondary email-tool-btn ${isSendingEmail ? 'loading' : ''}`}
                  onClick={handleQuickSendEmail}
                  disabled={isSendingEmail}
                  title={t('item.sendToEmailHint', { email: emailRelayConfig.from_address })}
                >
                  {isSendingEmail ? <RefreshCw size={14} className="spin-icon" /> : <Mail size={14} />}
                  <span>{t('item.sendToEmailBtn')}</span>
                </button>
              )}
              {item.type_ !== 'image' && item.type_ !== 'file' && !item.code_language && (
                <button
                  type="button"
                  className="preview-tool-btn secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEditContent();
                  }}
                >
                  <Edit2 size={14} />
                  <span>{t('panel.editContent')}</span>
                </button>
              )}
              <button
                type="button"
                className={`preview-tool-btn secondary ${isNoteEditing ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isNoteEditing) {
                    cancelNoteEdit();
                  } else {
                    if (showAIAssistant) setShowAIAssistant(false);
                    startEditNote(item);
                  }
                }}
                title={item.user_note ? t('item.editNote') : t('item.addNote')}
              >
                <StickyNote size={14} />
                <span>{item.user_note ? t('item.editNote') : t('item.addNote')}</span>
              </button>
              <button className="preview-tool-btn secondary" onClick={() => openShareModal(item)}>
                <Share2 size={14} />
                <span>{t('share.button')}</span>
              </button>
              {shouldShowOCRButton && (
                <button
                  type="button"
                  className={`preview-tool-btn secondary ocr-tool-btn ${ocrProcessing === item.id ? 'loading' : ''}`}
                  onClick={handleTriggerOCR}
                  disabled={ocrProcessing === item.id}
                  title={ocrProcessing === item.id ? t('item.ocrRecognizing') : t('item.recognizeText')}
                >
                  {ocrProcessing === item.id ? (
                    <RefreshCw size={14} className="spin-icon" />
                  ) : (
                    <ScanText size={14} />
                  )}
                  <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
                </button>
              )}
            </>
          )}
        </div>
    </div>
  );
}

export default PreviewPanel;
