import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Folder, ExternalLink, FileText, Palette } from 'lucide-react';
import {
  getContentPreview,
  getFileList,
  getFileName,
  parseUrl,
  getLinkPreviewTitle,
} from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags } from '../../utils/tagHelpers';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../utils/cardBackgrounds';

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

function WorkbenchCard({
  item,
  isCopied,
  isMultiSelected,
  onUnpin,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
  onContextMenu,
  onOpenItem,
  onSetCardBackground,
}) {
  const { t } = useTranslation();
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef(null);
  const tags = getTags(item.tags).filter(tag => !tag.startsWith('AI:'));
  const cardBackground = useMemo(
    () => getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item.metadata)),
    [item.metadata],
  );
  const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;

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
        <div className="workbench-card-image">
          <img
            src={getImageOriginal(item.image_paths)}
            alt=""
            loading="lazy"
          />
          {item.ocr_text && (
            <div className="workbench-card-ocr">
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
          <div className="workbench-card-link">
            <div className="link-header">
              <img
                className="link-favicon"
                src={parsed.favicon}
                alt=""
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <span className="link-domain">{parsed.domain}</span>
              <ExternalLink
                size={12}
                className="link-external"
                onClick={(e) => { e.stopPropagation(); onOpenItem?.(item); }}
              />
            </div>
            {title && <div className="link-title">{title}</div>}
            {decodedPath && <div className="link-path">{decodedPath}</div>}
          </div>
        );
      }
    }
    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      const isSingle = files.length === 1;
      return (
        <div className={`workbench-card-files ${isSingle ? 'single-file' : ''}`}>
          {files.map((path, idx) => {
            const name = getFileName(path);
            const folder = isFolder(path);
            const ext = getExt(name);
            return (
              <div key={idx} className="file-item">
                {folder ? (
                  <Folder size={isSingle ? 32 : 20} color="#f5c542" fill="#f5c542" className="file-icon" />
                ) : (
                  <Suspense fallback={<FileText size={isSingle ? 32 : 20} className="file-icon" />}>
                    <div className="file-icon" style={{ width: isSingle ? 32 : 20 }}>
                      <FileIconLazy extension={ext} />
                    </div>
                  </Suspense>
                )}
                <span>{name}</span>
              </div>
            );
          })}
        </div>
      );
    }
    if (item.code_language && item.content) {
      return (
        <Suspense fallback={<div className="workbench-card-text">{getContentPreview(item.content)}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={8} compact />
        </Suspense>
      );
    }
    return (
      <div className="workbench-card-text">
        {getContentPreview(item.content)}
      </div>
    );
  };

  const cardClasses = [
    'workbench-card',
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
      <div className="workbench-card-tools" ref={colorPickerRef}>
        <button
          type="button"
          className={`workbench-card-color ${hasCustomCardBackground ? 'tinted' : ''}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowColorPicker(prev => !prev);
          }}
          title={t('item.cardBackground.button')}
          aria-label={t('item.cardBackground.button')}
        >
          <Palette size={13} />
        </button>
        <button
          type="button"
          className="workbench-card-remove"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => { e.stopPropagation(); onUnpin(); }}
          title={t('workbench.removeFromWorkbench')}
          aria-label={t('workbench.removeFromWorkbench')}
        >
          <X size={14} />
        </button>
        {showColorPicker && (
          <div
            className="workbench-card-color-picker"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
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
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
      <div className="workbench-card-content">
        {renderContent()}
      </div>
      {(item.user_note || tags.length > 0) && (
        <div className="workbench-card-footer">
          {item.user_note && (
            <div className="workbench-card-note">{item.user_note}</div>
          )}
          {tags.length > 0 && (
            <div className="workbench-card-tags">
              {tags.map(tag => (
                <span key={tag} className="compact-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WorkbenchCard);
