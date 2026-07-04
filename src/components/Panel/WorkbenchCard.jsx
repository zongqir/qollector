import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Folder, ExternalLink, FileText, Palette, Star, Type, Image, Link, Code, GripVertical } from 'lucide-react';
import {
  getContentPreview,
  formatHistoryCardTime,
  getFileList,
  getFileName,
  parseUrl,
  getLinkPreviewTitle,
} from '../../utils/formatters';
import { getImageThumbnail } from '../../utils/imageHelpers';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import { getCardTagPreviewLimit } from '../../utils/cardDensity';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../utils/cardBackgrounds';
import useAppStore from '../../store/useAppStore';

// Lazy load FileIcon to reduce initial bundle size
const FileIconLazy = lazy(() =>
  import('react-file-icon').then(module => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...defaultStyles[extension]} {...props} />;
    }
  }))
);
const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

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
    default: return <Type size={size} />;
  }
};

function WorkbenchCard({
  item,
  timeTick,
  isCopied,
  isMultiSelected,
  isSortMode,
  isSortAnchor,
  isUnpinConfirmArmed,
  onUnpin,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
  onContextMenu,
  onOpenItem,
  onSetCardBackground,
  supportsNativeExternalDrag,
  onStartExternalDrag,
}) {
  const { t, i18n } = useTranslation();
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef(null);
  const tags = getTags(item.tags).filter(tag => !tag.startsWith('AI:'));
  const tagPreviewLimit = getCardTagPreviewLimit('workbench', { isMiniMode });
  const visibleTags = tags.slice(0, tagPreviewLimit);
  const hiddenTagsCount = Math.max(tags.length - tagPreviewLimit, 0);
  const userNote = typeof item.user_note === 'string' ? item.user_note.trim() : '';
  const sourceApp = getSourceApp(item.metadata);
  const timeLabel = formatHistoryCardTime(
    item.updated_at,
    i18n.language,
    timeTick,
    t('item.justNow'),
  );
  const cardBackground = useMemo(
    () => getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item.metadata)),
    [item.metadata],
  );
  const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;
  const canDragOut = supportsNativeExternalDrag
    && (
      item?.type_ === 'file'
      || item?.type_ === 'image'
    );

  useEffect(() => {
    if (!showColorPicker) return undefined;
    const handlePointerDown = (event) => {
      if (colorPickerRef.current?.contains(event.target)) return;
      setShowColorPicker(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [showColorPicker]);

  const handleBackgroundSelect = useCallback((backgroundId) => {
    onSetCardBackground?.(item, backgroundId);
    setShowColorPicker(false);
  }, [item, onSetCardBackground]);

  const stopActionPointerDown = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const stopActionClick = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const preventActionDrag = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleCardKeyDown = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onClick?.(event);
  }, [onClick]);

  const renderContent = () => {
    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="workbench-card-image panel-card-content-image">
          <img
            className="panel-card-content-image-media"
            src={getImageThumbnail(item.image_paths)}
            alt=""
            loading="lazy"
          />
          {item.ocr_text && (
            <div className="workbench-card-ocr panel-card-image-ocr">
              <div className="ocr-label">{t('item.recognizedText')}</div>
              <div className="ocr-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      );
    }
    if (item.type_ === 'link') {
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
          <div className="workbench-card-link panel-card-content-link">
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
                onClick={(e) => { e.stopPropagation(); onOpenItem?.(item); }}
              />
            </div>
            {title && <div className="link-title panel-card-link-title">{title}</div>}
            {decodedPath && <div className="link-path panel-card-link-aux">{decodedPath}</div>}
          </div>
        );
      }
    }
    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      const isSingle = files.length === 1;
      return (
        <div className={`workbench-card-files panel-card-content-files ${isSingle ? 'single-file' : ''}`}>
          {files.map((path, idx) => {
            const name = getFileName(path);
            const folder = isFolder(path);
            const ext = getExt(name);
            return (
              <div key={idx} className="file-item panel-card-file-item">
                {folder ? (
                  <Folder size={isSingle ? 32 : 20} color="#f5c542" fill="#f5c542" className="file-icon panel-card-file-icon" />
                ) : (
                  <Suspense fallback={<FileText size={isSingle ? 32 : 20} className="file-icon panel-card-file-icon" />}>
                    <div className="file-icon panel-card-file-icon" style={{ width: isSingle ? 32 : 20 }}>
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
    if (item.code_language && item.content) {
      return (
        <Suspense fallback={<div className="workbench-card-text panel-card-content-text">{getContentPreview(item.content)}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={8} compact />
        </Suspense>
      );
    }
    return (
      <div className="workbench-card-text panel-card-content-text">
        {getContentPreview(item.content)}
      </div>
    );
  };

  const cardClasses = [
    'workbench-card',
    'panel-card-shell',
    isSortMode && 'sort-enabled',
    isSortAnchor && 'sort-anchor',
    item.is_favorite && 'favorite',
    hasCustomCardBackground && 'custom-bg',
    isCopied && 'copied',
    isMultiSelected && 'multi-selected',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      style={hasCustomCardBackground ? { '--workbench-card-accent': cardBackground.accent } : undefined}
      role="button"
      tabIndex={0}
      aria-label={t('item.clickToPreview')}
      onPointerDownCapture={onPointerDownCapture}
      onClick={onClick}
      onKeyDown={handleCardKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(e); }}
    >
      {isCopied && (
        <div className="copy-success-toast">
          <Check size={16} /> {t('item.copied')}
        </div>
      )}
      <div className="workbench-card-header panel-card-header">
        <div className="workbench-card-head-main panel-card-head-main">
          <span className="workbench-card-type-icon panel-card-type-icon" aria-hidden="true">
            <CardTypeIcon type={item.type_} hasCodeLanguage={Boolean(item.code_language)} />
          </span>
          <div className="workbench-card-meta panel-card-meta">
            <span className="workbench-card-time panel-card-time">{timeLabel}</span>
            {sourceApp && (
              <span className="workbench-card-source panel-card-source" title={sourceApp}>
                {sourceApp}
              </span>
            )}
          </div>
        </div>
        {item.is_favorite && (
          <span
            className="workbench-card-state-chip panel-card-state-chip favorite"
            title={t('item.favorite')}
            aria-label={t('item.favorite')}
          >
            <Star size={10} fill="currentColor" />
          </span>
        )}
      </div>
      <div className="workbench-card-tools panel-card-actions panel-card-actions--hover-reveal" ref={colorPickerRef}>
        {canDragOut && (
          <button
            type="button"
            className="workbench-card-dragout panel-card-action-btn"
            draggable={false}
            data-longpress-ignore="true"
            onPointerDown={stopActionPointerDown}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartExternalDrag?.(item);
            }}
            onDragStart={preventActionDrag}
            onClick={stopActionClick}
            title={t('toolbar.dragToApp')}
            aria-label={t('toolbar.dragToApp')}
          >
            <GripVertical size={13} />
          </button>
        )}
        <button
          type="button"
          className={`workbench-card-color panel-card-action-btn ${hasCustomCardBackground ? 'tinted' : ''}`}
          draggable={false}
          data-longpress-ignore="true"
          onPointerDown={stopActionPointerDown}
          onMouseDown={stopActionPointerDown}
          onDragStart={preventActionDrag}
          onClick={(e) => {
            stopActionClick(e);
            setShowColorPicker(prev => !prev);
          }}
          title={t('item.cardBackground.button')}
          aria-label={t('item.cardBackground.button')}
        >
          <Palette size={13} />
        </button>
        <button
          type="button"
          className={`workbench-card-remove panel-card-action-btn ${isUnpinConfirmArmed ? 'confirm' : ''}`}
          draggable={false}
          data-longpress-ignore="true"
          onPointerDown={stopActionPointerDown}
          onMouseDown={stopActionPointerDown}
          onDragStart={preventActionDrag}
          onClick={(e) => {
            stopActionClick(e);
            onUnpin();
          }}
          title={isUnpinConfirmArmed ? t('workbench.confirmRemoveFromWorkbench') : t('workbench.removeFromWorkbench')}
          aria-label={isUnpinConfirmArmed ? t('workbench.confirmRemoveFromWorkbench') : t('workbench.removeFromWorkbench')}
        >
          <X size={14} />
        </button>
        {showColorPicker && (
          <div
            className="workbench-card-color-picker"
            onPointerDown={stopActionPointerDown}
            onMouseDown={stopActionPointerDown}
            onClick={(e) => e.stopPropagation()}
          >
            {CARD_BACKGROUND_PRESETS.map((preset) => {
              const isActive = preset.id === cardBackground.id;
              const isDefault = preset.id === CARD_BACKGROUND_DEFAULT_ID;
              return (
                <button
                  type="button"
                  key={preset.id}
                  className={`workbench-card-color-dot ${isActive ? 'active' : ''} ${isDefault ? 'default' : ''}`}
                  style={!isDefault ? { '--card-color-dot': preset.dot } : undefined}
                  title={t(preset.labelKey)}
                  aria-label={t(preset.labelKey)}
                  draggable={false}
                  data-longpress-ignore="true"
                  onPointerDown={stopActionPointerDown}
                  onMouseDown={stopActionPointerDown}
                  onDragStart={preventActionDrag}
                  onClick={(e) => {
                    stopActionClick(e);
                    handleBackgroundSelect(preset.id);
                  }}
                >
                  {isDefault && <span className="workbench-card-color-dot-reset"></span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="workbench-card-content panel-card-body">
        {renderContent()}
      </div>
      {(userNote || tags.length > 0) && (
        <div className="workbench-card-footer panel-card-footer">
          {userNote && (
            <div className="workbench-card-note panel-card-note" title={userNote}>{userNote}</div>
          )}
          {visibleTags.length > 0 && (
            <div className="workbench-card-tags panel-card-tags">
              {visibleTags.map(tag => (
                <span key={tag} className="workbench-card-tag panel-card-tag">{tag}</span>
              ))}
              {hiddenTagsCount > 0 && (
                <span className="workbench-card-tag panel-card-tag more">+{hiddenTagsCount}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WorkbenchCard);
