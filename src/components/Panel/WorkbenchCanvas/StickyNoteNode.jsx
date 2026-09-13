import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, Handle, Position } from '@xyflow/react';
import {
  Pencil,
  Sparkles,
  Palette,
  X,
  GripVertical,
  Check,
  Loader2,
  FileText,
  Languages,
  ListOrdered,
  RefreshCw,
  Folder,
  ExternalLink,
  Star,
  Type,
  Image,
  Link,
  Code,
} from 'lucide-react';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';
import {
  getContentPreview,
  formatHistoryCardTime,
  getFileList,
  getFileName,
  parseUrl,
  getLinkPreviewTitle,
} from '../../../utils/formatters';
import { getImageThumbnail } from '../../../utils/imageHelpers';
import { getSourceApp, getTags } from '../../../utils/tagHelpers';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../../utils/cardBackgrounds';
import { INTERNAL_DRAG_MIME } from '../../../constants/dragDrop';

// Lazy load FileIcon to reduce bundle size
const FileIconLazy = lazy(() =>
  import('react-file-icon').then((module) => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...defaultStyles[extension]} {...props} />;
    },
  }))
);

const CodeBlock = lazy(() => import('../../CodeBlock/CodeBlock'));

const getExt = (filename) => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

const isFolder = (path) => {
  if (path.endsWith('/') || path.endsWith('\\')) return true;
  const name = path.split(/[/\\]/).pop() || '';
  return !name.includes('.');
};

const CardTypeIcon = ({ type, hasCodeLanguage }) => {
  const size = 11;
  if (hasCodeLanguage) return <Code size={size} />;
  switch (type) {
    case 'image': return <Image size={size} />;
    case 'file': return <FileText size={size} />;
    case 'link': return <Link size={size} />;
    default: return null;
  }
};

function StickyNoteNode({ data, selected }) {
  const {
    item,
    onUpdateContent,
    onSetCardBackground,
    onEditItem,
    onPreviewItem,
    onOpenItem,
    onRevealInFolder,
    onContextMenu,
    supportsNativeExternalDrag,
    onStartExternalDrag,
    onResizeNode,
    onResizeNodeEnd,
    onUnpin,
    onCopy,
    isCopied,
    t,
    uiLanguage = 'zh-CN',
    aiEnabled = false,
  } = data;

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [localContent, setLocalContent] = useState(() => item?.content || '');
  const saveContentTimeoutRef = useRef(null);
  const aiMenuRef = useRef(null);
  const colorPickerRef = useRef(null);

  // Sync external content changes (e.g. from AI or refresh)
  useEffect(() => {
    setLocalContent(item?.content || '');
  }, [item?.content]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (saveContentTimeoutRef.current) {
        clearTimeout(saveContentTimeoutRef.current);
      }
    };
  }, []);

  const handleContentChange = useCallback(
    (e) => {
      const newText = e.target.value;
      setLocalContent(newText);
      if (saveContentTimeoutRef.current) {
        clearTimeout(saveContentTimeoutRef.current);
      }
      saveContentTimeoutRef.current = setTimeout(() => {
        onUpdateContent?.(item?.id, newText);
      }, 350);
    },
    [item?.id, onUpdateContent]
  );

  const handleContentBlur = useCallback(() => {
    if (saveContentTimeoutRef.current) {
      clearTimeout(saveContentTimeoutRef.current);
      saveContentTimeoutRef.current = null;
    }
    onUpdateContent?.(item?.id, localContent);
  }, [item?.id, localContent, onUpdateContent]);

  // Popover dismiss on outside pointerdown
  useEffect(() => {
    if (!showAiMenu && !showColorPicker) return undefined;
    const handleClickOutside = (event) => {
      if (showAiMenu && !aiMenuRef.current?.contains(event.target)) {
        setShowAiMenu(false);
      }
      if (showColorPicker && !colorPickerRef.current?.contains(event.target)) {
        setShowColorPicker(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [showAiMenu, showColorPicker]);

  const tags = useMemo(
    () => getTags(item?.tags).filter((tag) => !tag.startsWith('AI:')),
    [item?.tags]
  );
  const tagPreviewLimit = 3;
  const visibleTags = tags.slice(0, tagPreviewLimit);
  const hiddenTagsCount = Math.max(tags.length - tagPreviewLimit, 0);
  const userNote = typeof item?.user_note === 'string' ? item.user_note.trim() : '';
  const sourceApp = getSourceApp(item?.metadata);

  const cardBackground = useMemo(
    () => getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item?.metadata)),
    [item?.metadata]
  );
  const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;

  const canDragOut = supportsNativeExternalDrag && (item?.type_ === 'file' || item?.type_ === 'image');

  const formattedTime = useMemo(() => {
    if (!item?.updated_at && !item?.created_at) return '';
    return formatHistoryCardTime(
      item.updated_at || item.created_at,
      uiLanguage,
      Date.now(),
      t ? t('item.justNow') : '刚刚'
    );
  }, [item?.created_at, item?.updated_at, uiLanguage, t]);

  const typeBadgeText = useMemo(() => {
    if (item?.code_language) {
      return item.code_language.toUpperCase();
    }
    const rawType = item?.type_ || 'text';
    switch (rawType) {
      case 'code':
        return t ? t('item.type.code') || '代码' : '代码';
      case 'image':
        return t ? t('item.type.image') || '图片' : '图片';
      case 'file':
        return t ? t('item.type.file') || '文件' : '文件';
      case 'link':
      case 'url':
        return t ? t('item.type.link') || '链接' : '链接';
      default:
        return '';
    }
  }, [item?.code_language, item?.type_, t]);

  // Direct bottom-right corner drag resizer (100% reliable)
  const handleResizeCornerPointerDown = useCallback(
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const targetNode = event.currentTarget.closest('.react-flow__node');
      const startW = targetNode?.offsetWidth || 280;
      const startH = targetNode?.offsetHeight || 190;

      const onPointerMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        const newW = Math.max(180, Math.min(1200, Math.round(startW + deltaX)));
        const newH = Math.max(110, Math.min(900, Math.round(startH + deltaY)));
        onResizeNode?.(item?.id, newW, newH);
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        onResizeNodeEnd?.(item?.id);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [item?.id, onResizeNode, onResizeNodeEnd]
  );

  const handleRunAi = useCallback(
    async (taskType, extraPrompt = '') => {
      if (aiRunning || !item?.content?.trim()) return;
      setShowAiMenu(false);
      setAiRunning(true);
      try {
        const response = await runPromptAssistantTask({
          taskType,
          input: item.content,
          uiLanguage,
          outputLanguage: resolveOutputLanguageFromUi(uiLanguage),
          tone: 'professional',
          length: 'medium',
          extraInstruction: extraPrompt || undefined,
        });
        const output = typeof response?.output === 'string' ? response.output.trim() : '';
        if (output) {
          onUpdateContent?.(item.id, output);
        }
      } catch (error) {
        console.error('[StickyNote] AI Task failed:', error);
      } finally {
        setAiRunning(false);
      }
    },
    [aiRunning, item?.content, item?.id, onUpdateContent, uiLanguage]
  );

  const stopActionClick = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const renderContent = () => {
    if (item?.type_ === 'image' && item.image_paths) {
      return (
        <div
          className="sticky-note-image panel-card-content-image"
          onClick={(e) => {
            e.stopPropagation();
            onPreviewItem?.(item);
          }}
        >
          <img
            className="panel-card-content-image-media"
            src={getImageThumbnail(item.image_paths)}
            alt=""
            loading="lazy"
          />
          {item.ocr_text && (
            <div className="sticky-note-ocr panel-card-image-ocr">
              <div className="ocr-label">{t ? t('item.recognizedText') : '识别文字'}</div>
              <div className="ocr-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      );
    }

    if (item?.type_ === 'link') {
      const parsed = parseUrl(item.content);
      if (parsed) {
        const title = getLinkPreviewTitle(item);
        let decodedPath = parsed.path;
        try {
          decodedPath = parsed.path ? decodeURIComponent(parsed.path) : '';
        } catch {
          decodedPath = parsed.path;
        }
        return (
          <div className="sticky-note-link panel-card-content-link">
            <div className="link-header">
              <img
                className="link-favicon"
                src={parsed.favicon}
                alt=""
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <span className="link-domain panel-card-link-meta">{parsed.domain}</span>
              <ExternalLink
                size={12}
                className="link-external"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenItem?.(item);
                }}
              />
            </div>
            {title && <div className="link-title panel-card-link-title">{title}</div>}
            {decodedPath && <div className="link-path panel-card-link-aux">{decodedPath}</div>}
          </div>
        );
      }
    }

    if (item?.type_ === 'file') {
      const files = getFileList(item.content);
      const isSingle = files.length === 1;
      return (
        <div className={`sticky-note-files panel-card-content-files ${isSingle ? 'single-file' : ''}`}>
          {files.map((path, idx) => {
            const name = getFileName(path);
            const folder = isFolder(path);
            const ext = getExt(name);
            return (
              <div key={idx} className="file-item panel-card-file-item">
                {folder ? (
                  <Folder size={isSingle ? 28 : 18} color="#f5c542" fill="#f5c542" className="file-icon panel-card-file-icon" />
                ) : (
                  <Suspense fallback={<FileText size={isSingle ? 28 : 18} className="file-icon panel-card-file-icon" />}>
                    <div className="file-icon panel-card-file-icon" style={{ width: isSingle ? 28 : 18 }}>
                      <FileIconLazy extension={ext} />
                    </div>
                  </Suspense>
                )}
                <span className="panel-card-file-name">{name}</span>
              </div>
            );
          })}
        </div>
      );
    }

    if (item?.code_language && item?.content) {
      return (
        <Suspense fallback={<div className="sticky-note-text-display">{getContentPreview(item.content)}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={7} compact />
        </Suspense>
      );
    }

    return (
      <div className="sticky-note-text-display">
        <textarea
          className="sticky-note-textarea nodrag nopan nowheel"
          value={localContent}
          onChange={handleContentChange}
          onBlur={handleContentBlur}
          placeholder={t ? t('workbench.expandedNotePlaceholder') || '写下你的想法...' : '写下你的想法...'}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.target.blur();
            }
          }}
        />
      </div>
    );
  };

  return (
    <div
      className={`sticky-note-node ${selected ? 'selected' : ''} ${isCopied ? 'is-copied' : ''}`}
      data-custom-bg={hasCustomCardBackground}
      style={hasCustomCardBackground ? { '--wb-card-accent': cardBackground.accent } : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={(e) => {
        if (e.target?.closest?.('textarea') || e.target?.closest?.('input') || e.target?.closest?.('button') || e.target?.closest?.('a')) {
          return;
        }
        e.stopPropagation();
        onCopy?.(item);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(item, e);
      }}
    >
      {/* Inner Card (Keeps border-radius & clipping without hiding outer resize handles) */}
      <div className="sticky-note-card">
        {/* Header */}
        <div className="sticky-note-header">
          <div className="sticky-note-header-left">
            <div
              className="sticky-note-drag-handle"
              title={t ? t('workbench.dragMove') || '按住拖动' : '按住拖动'}
              draggable={true}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(INTERNAL_DRAG_MIME, JSON.stringify({ id: item?.id, fromCanvas: true }));
                e.dataTransfer.setData('text/plain', item?.content || '');
                e.dataTransfer.effectAllowed = 'copyMove';
                document.documentElement.setAttribute('data-internal-drag', 'true');
              }}
              onDragEnd={() => {
                document.documentElement.removeAttribute('data-internal-drag');
              }}
            >
              <GripVertical size={13} />
            </div>
            {(Boolean(item?.code_language) || ['image', 'file', 'link', 'url'].includes(item?.type_)) && (
              <div className="sticky-note-type-pill">
                <CardTypeIcon type={item?.type_} hasCodeLanguage={Boolean(item?.code_language)} />
                {typeBadgeText ? <span className="sticky-note-type-name">{typeBadgeText}</span> : null}
              </div>
            )}
            {formattedTime && <span className="sticky-note-time">{formattedTime}</span>}
            {sourceApp && (
              <span className="sticky-note-source" title={sourceApp}>
                {sourceApp}
              </span>
            )}
            {item?.is_favorite && (
              <span className="sticky-note-star" title={t ? t('item.favorite') : '收藏'}>
                <Star size={10} fill="currentColor" />
              </span>
            )}
          </div>

          <div className="sticky-note-header-actions" ref={colorPickerRef}>
            {canDragOut && (
              <button
                type="button"
                className="sticky-note-action-btn"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStartExternalDrag?.(item);
                }}
                onClick={stopActionClick}
                title={t ? t('toolbar.dragToApp') : '拖拽到外部应用'}
              >
                <GripVertical size={13} />
              </button>
            )}

            {aiEnabled && (
              <button
                type="button"
                className="sticky-note-action-btn ai-btn"
                onClick={(e) => {
                  stopActionClick(e);
                  setShowColorPicker(false);
                  setShowAiMenu((prev) => !prev);
                }}
                title={t ? t('workbench.aiAssistant') || 'AI 助手' : 'AI 助手'}
                disabled={aiRunning}
              >
                {aiRunning ? (
                  <Loader2 size={13} className="sticky-ai-spinner" />
                ) : (
                  <Sparkles size={13} />
                )}
              </button>
            )}

            <button
              type="button"
              className="sticky-note-action-btn"
              onClick={(e) => {
                stopActionClick(e);
                onEditItem?.(item);
              }}
              title={t ? t('item.editNote') || '编辑' : '编辑'}
            >
              <Pencil size={12} />
            </button>

            <button
              type="button"
              className={`sticky-note-action-btn ${hasCustomCardBackground ? 'tinted' : ''}`}
              onClick={(e) => {
                stopActionClick(e);
                setShowAiMenu(false);
                setShowColorPicker((prev) => !prev);
              }}
              title={t ? t('item.cardBackground.button') || '卡片配色' : '卡片配色'}
            >
              <Palette size={13} />
            </button>

            <button
              type="button"
              className="sticky-note-action-btn danger"
              onClick={(e) => {
                stopActionClick(e);
                onUnpin?.(item);
              }}
              title={t ? t('workbench.removeFromWorkbench') || '移出工作台' : '移出工作台'}
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          className="sticky-note-body"
          onClick={(e) => {
            // If clicking directly on text body without button, preview or trigger edit
            if (!e.target.closest('button') && !e.target.closest('a') && !e.target.closest('.link-external')) {
              // Click to preview/inspect
            }
          }}
        >
          {renderContent()}
        </div>

        {/* Footer (Note & Tags) */}
        {(userNote || tags.length > 0) && (
          <div className="sticky-note-footer">
            {userNote && (
              <div className="sticky-note-note" title={userNote}>
                {userNote}
              </div>
            )}
            {visibleTags.length > 0 && (
              <div className="sticky-note-tags">
                {visibleTags.map((tag) => (
                  <span key={tag} className="sticky-note-tag">
                    {tag}
                  </span>
                ))}
                {hiddenTagsCount > 0 && (
                  <span className="sticky-note-tag more">+{hiddenTagsCount}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tactile Corner Resize Indicator (Direct Grab & Drag) */}
        <div
          className="sticky-note-resize-corner"
          onPointerDown={handleResizeCornerPointerDown}
          onMouseDown={(e) => e.stopPropagation()}
          title={t ? t('workbench.dragResize') || '拖拽缩放大小' : '拖拽缩放大小'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6"/>
            <line x1="9" y1="5.5" x2="5.5" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6"/>
            <line x1="9" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.6"/>
          </svg>
        </div>
      </div>

      {/* AI Menu Popover */}
      {showAiMenu && (
        <div className="sticky-ai-popover" ref={aiMenuRef} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() =>
              handleRunAi(
                'rewrite',
                'Format, clean up extra spaces/newlines, and make clear bullet points if appropriate.'
              )
            }
          >
            <FileText size={13} />
            <span>{t ? t('aiAssistant.tasks.format') || '排版整理' : '排版整理'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('translate')}
          >
            <Languages size={13} />
            <span>{t ? t('aiAssistant.tasks.translate') || '中英翻译' : '中英翻译'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('extract')}
          >
            <ListOrdered size={13} />
            <span>{t ? t('aiAssistant.tasks.extract') || '提取要点' : '提取要点'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('rewrite')}
          >
            <RefreshCw size={13} />
            <span>{t ? t('aiAssistant.tasks.rewrite') || '润色优化' : '润色优化'}</span>
          </button>
        </div>
      )}

      {/* Color Picker Popover (Matches Qollect Design System CARD_BACKGROUND_PRESETS) */}
      {showColorPicker && (
        <div
          className="sticky-color-popover"
          ref={colorPickerRef}
          onClick={(e) => e.stopPropagation()}
        >
          {CARD_BACKGROUND_PRESETS.map((preset) => {
            const isActive = preset.id === cardBackground.id;
            const isDefault = preset.id === CARD_BACKGROUND_DEFAULT_ID;
            return (
              <button
                key={preset.id}
                type="button"
                className={`sticky-color-dot ${isActive ? 'active' : ''} ${isDefault ? 'default' : ''}`}
                style={!isDefault ? { '--card-color-dot': preset.dot, background: preset.dot } : undefined}
                onClick={() => {
                  onSetCardBackground?.(item, preset.id);
                  setShowColorPicker(false);
                }}
                title={t ? t(preset.labelKey) : preset.id}
                aria-label={t ? t(preset.labelKey) : preset.id}
              >
                {isDefault && <span className="sticky-color-dot-reset"></span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 4-Direction Magnetic Connection Handles (Top, Right, Bottom, Left) */}
      <Handle type="target" position={Position.Top} id="top-target" className="sticky-handle sticky-handle-top" />
      <Handle type="source" position={Position.Top} id="top-source" className="sticky-handle sticky-handle-top" />

      <Handle type="target" position={Position.Right} id="right-target" className="sticky-handle sticky-handle-right" />
      <Handle type="source" position={Position.Right} id="right-source" className="sticky-handle sticky-handle-right" />

      <Handle type="target" position={Position.Bottom} id="bottom-target" className="sticky-handle sticky-handle-bottom" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" className="sticky-handle sticky-handle-bottom" />

      <Handle type="target" position={Position.Left} id="left-target" className="sticky-handle sticky-handle-left" />
      <Handle type="source" position={Position.Left} id="left-source" className="sticky-handle sticky-handle-left" />

      {/* Edge Resizer Handles (Rendered after card for high z-index priority) */}
      <NodeResizer
        minWidth={180}
        minHeight={110}
        maxWidth={1200}
        maxHeight={900}
        isVisible={selected || isHovered}
        lineClassName="sticky-resize-line"
        handleClassName="sticky-resize-handle"
      />
    </div>
  );
}

export default memo(StickyNoteNode);

