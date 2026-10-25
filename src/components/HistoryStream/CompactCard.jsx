import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, FileText, Folder, Image, Type, Link, Code, GripVertical, ExternalLink, Check, FolderOpen, Palette, Terminal, Languages, Copy, Clock3 } from 'lucide-react';
import {
  formatDate,
  formatHistoryCardTime,
  getTimelineColor,
  getContentPreview,
  getFileName,
  getFileList,
  parseUrl,
  getLinkPreviewTitle,
  isDateTimeCandidate,
} from '../../utils/formatters';
import { isCurlCommand, parseCurl } from '../../utils/curlParser';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import { getImageThumbnail } from '../../utils/imageHelpers';
import { getCardTagPreviewLimit } from '../../utils/cardDensity';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../utils/cardBackgrounds';
import { getTranslationFromMetadata } from '../../utils/translationHelpers';
import useAppStore from '../../store/useAppStore';
import { INTERNAL_DRAG_MIME } from '../../constants/dragDrop';
import { shouldIgnoreDragStartTarget } from '../../utils/previewInteractionPolicy';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));
const FileIconLazy = lazy(() =>
  import('react-file-icon').then(module => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...(defaultStyles[extension] || {})} {...props} />;
    }
  }))
);

const getExt = (filename) => {
  const parts = String(filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

const isFolderPath = (path) => {
  const raw = String(path || '');
  if (!raw) return false;
  if (raw.endsWith('/') || raw.endsWith('\\')) return true;
  const name = raw.split(/[/\\]/).pop() || '';
  return !name.includes('.');
};

const looksLikeFileLine = (line) => {
  const raw = String(line || '').trim();
  if (!raw) return false;
  const normalized = raw.replace(/^file:\/\//i, '');
  const name = getFileName(normalized);
  if (!name) return false;
  if (normalized.includes('\\') || normalized.includes('/')) return true;
  return /\.[a-z0-9]{1,8}$/i.test(name);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TypeIcon = ({ type, hasCodeLanguage, isCurl, isDateTime, hasTranslation }) => {
  const size = 11;
  if (isCurl) return <Terminal size={size} />;
  if (hasCodeLanguage) return <Code size={size} />;
  if (isDateTime && (type === 'text' || !type)) return <Clock3 size={size} />;
  if (hasTranslation && (type === 'text' || !type)) return <Languages size={size} />;
  switch (type) {
    case 'image': return <Image size={size} />;
    case 'file': return <FileText size={size} />;
    case 'link': return <Link size={size} />;
    default: return <Type size={size} />;
  }
};

function CompactCard({
  item,
  isSelected,
  isMultiSelected,
  isSelectionMode,
  isFocused,
  isCopied,
  timeTick,
  searchExplain,
  supportsNativeExternalDrag,
  onStartExternalDrag,
  onToggleFavorite,
  onOpenItem,
  onRevealInFolder,
  onSetCardBackground,
  onTagClick,
  onToggleMultiSelect,
  onDoubleClick,
}) {
  const { t, i18n } = useTranslation();
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [copiedTranslation, setCopiedTranslation] = useState(false);
  const colorPickerRef = useRef(null);
  const translation = useMemo(() => getTranslationFromMetadata(item.metadata), [item.metadata]);
  const timelineColor = getTimelineColor(item.updated_at);
  const timeLabel = formatHistoryCardTime(
    item.updated_at,
    i18n.language,
    timeTick,
    t('item.justNow'),
  );
  const sourceApp = getSourceApp(item.metadata);
  const tags = getTags(item.tags);
  const userTags = tags.filter(tag => !tag.startsWith('AI:'));
  const tagPreviewLimit = getCardTagPreviewLimit('history', { isMiniMode });
  const visibleUserTags = userTags.slice(0, tagPreviewLimit);
  const hiddenUserTagsCount = Math.max(userTags.length - tagPreviewLimit, 0);
  const isCurl = useMemo(() => {
    if (item.type_ !== 'text' || !item.content) return false;
    return isCurlCommand(item.content);
  }, [item.type_, item.content]);
  const isDateTime = useMemo(() => {
    if (item.type_ !== 'text' || !item.content) return false;
    return isDateTimeCandidate(item.content);
  }, [item.type_, item.content]);
  const userNote = typeof item.user_note === 'string' ? item.user_note.trim() : '';
  const canDragOut = supportsNativeExternalDrag
    && (
      item.type_ === 'file'
      || item.type_ === 'image'
      || (item.type_ === 'text' && typeof item.content === 'string' && item.content.trim().length > 0)
    );
  const canOpen = item.type_ === 'link' || item.type_ === 'file';
  const cardBackground = useMemo(
    () => getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item.metadata)),
    [item.metadata],
  );
  const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;
  const itemTypeClass = item.code_language ? 'type-code' : `type-${item.type_ || 'text'}`;
  const searchSources = Array.isArray(searchExplain?.sources) ? searchExplain.sources : [];
  const searchSnippet = typeof searchExplain?.snippet === 'string' ? searchExplain.snippet : '';
  const searchHighlightTerm = typeof searchExplain?.highlightTerm === 'string' ? searchExplain.highlightTerm : '';

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

  const cardClasses = [
    'compact-card',
    'panel-card-shell',
    itemTypeClass,
    hasCustomCardBackground && 'custom-bg',
    item.is_favorite && 'favorite',
    isSelected && 'selected',
    isMultiSelected && 'multi-selected',
    isFocused && 'keyboard-focused',
    isCopied && 'copied',
  ].filter(Boolean).join(' ');

  const renderHighlightedSnippet = useCallback((text, term) => {
    const normalizedText = typeof text === 'string' ? text : '';
    if (!normalizedText) return null;
    const normalizedTerm = typeof term === 'string' ? term.trim() : '';
    if (!normalizedTerm) return normalizedText;

    const regex = new RegExp(`(${escapeRegExp(normalizedTerm)})`, 'ig');
    const fragments = normalizedText.split(regex);
    if (fragments.length <= 1) return normalizedText;

    return fragments.map((fragment, index) => {
      if (fragment.toLowerCase() === normalizedTerm.toLowerCase()) {
        return <mark key={`${fragment}-${index}`}>{fragment}</mark>;
      }
      return <span key={`${fragment}-${index}`}>{fragment}</span>;
    });
  }, []);

  const renderContent = () => {
    const getRenderableFileLines = () => {
      if (item.type_ === 'file') {
        return getFileList(item.content || '');
      }

      // Compatibility: some old Windows Explorer captures were stored as text.
      if (item.type_ !== 'text') return [];
      const source = String(sourceApp || '').toLowerCase();
      const likelyFileSource = source.includes('windows')
        || source.includes('explorer')
        || source.includes('finder')
        || source.includes('file manager')
        || source.includes('文件资源管理器');
      if (!likelyFileSource) return [];

      const lines = getFileList(item.content || '');
      if (lines.length === 0) return [];
      const fileLikeCount = lines.reduce((count, line) => (
        count + (looksLikeFileLine(line) ? 1 : 0)
      ), 0);
      if (fileLikeCount === 0) return [];
      if (lines.length === 1 && fileLikeCount !== 1) return [];
      if (lines.length > 1 && fileLikeCount < Math.ceil(lines.length / 2)) return [];
      return lines;
    };

    const renderableFiles = getRenderableFileLines();
    if (renderableFiles.length > 0) {
      const visibleCount = isMiniMode ? 1 : 2;
      const visibleFiles = renderableFiles.slice(0, visibleCount);
      return (
        <div className="compact-card-files panel-card-content-files">
          {visibleFiles.map((filePath, index) => {
            const name = getFileName(filePath);
            const isFolder = isFolderPath(filePath);
            const ext = getExt(name);
            return (
              <div key={`${filePath}-${index}`} className="compact-card-file-item panel-card-file-item">
                {isFolder ? (
                  <Folder size={14} className="compact-card-file-icon panel-card-file-icon file-icon-folder" />
                ) : (
                  <Suspense fallback={<FileText size={14} className="compact-card-file-icon panel-card-file-icon" />}>
                    <span className="compact-card-file-icon panel-card-file-icon">
                      <FileIconLazy extension={ext} />
                    </span>
                  </Suspense>
                )}
                <span className="compact-card-file-name panel-card-file-name" title={name}>{name}</span>
                {!isFolder && ext && <span className="compact-card-file-ext panel-card-file-ext">{ext}</span>}
              </div>
            );
          })}
          {renderableFiles.length > visibleCount && (
            <div className="compact-card-file-more panel-card-file-more">+{renderableFiles.length - visibleCount}</div>
          )}
        </div>
      );
    }

    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="compact-card-image panel-card-content-image">
          <img
            className="panel-card-content-image-media"
            src={getImageThumbnail(item.image_paths)}
            alt=""
            loading="lazy"
          />
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
          <div className="compact-card-link panel-card-content-link">
            <img
              className="compact-link-favicon"
              src={parsed.favicon}
              alt=""
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget;
                if (img) img.style.display = 'none';
                const fallback = img?.nextElementSibling;
                if (fallback && fallback.style) {
                  fallback.style.display = 'inline';
                }
              }}
            />
            <Link size={14} className="compact-link-fallback" style={{ display: 'none' }} />
            <div className="compact-link-info">
              <span className="compact-link-title panel-card-link-title">{title || parsed.domain}</span>
              <span className="compact-link-domain panel-card-link-meta">{parsed.domain}</span>
              {decodedPath && <span className="compact-link-path panel-card-link-aux">{decodedPath}</span>}
            </div>
          </div>
        );
      }
    }
    if (item.code_language && item.content) {
      return (
        <Suspense fallback={<div className="compact-card-text panel-card-content-text">{getContentPreview(item.content)}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={3} compact />
        </Suspense>
      );
    }
    if (isCurl) {
      const parsed = parseCurl(item.content);
      if (parsed) {
        return (
          <div className="compact-card-curl panel-card-content-curl">
            <div className="compact-curl-header">
              <span className={`compact-curl-badge method-${(parsed.method || 'GET').toLowerCase()}`}>
                {parsed.method || 'GET'}
              </span>
              <span className="compact-curl-path" title={parsed.url}>
                {parsed.pathname || '/'}
              </span>
            </div>
            <div className="compact-curl-preview">
              {getContentPreview(item.content)}
            </div>
          </div>
        );
      }
    }
    if (showTranslation && translation?.text) {
      return (
        <div className="compact-card-text panel-card-content-text compact-card-translated">
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: '10px', color: 'var(--primary-color)', fontWeight: 500 }}>
            <Languages size={10} />
            <span>{t('item.translatedText')} ({translation.source_lang} ➔ {translation.target_lang})</span>
          </div>
          {getContentPreview(translation.text)}
        </div>
      );
    }
    return (
      <div className="compact-card-text panel-card-content-text">
        {getContentPreview(item.content)}
      </div>
    );
  };

  return (
    <div
      className={cardClasses}
      style={{
        '--timeline-color': timelineColor,
        ...(hasCustomCardBackground ? { '--compact-card-accent': cardBackground.accent } : {}),
      }}
      title={`${formatDate(item.updated_at, i18n.language)} - ${getSourceApp(item.metadata)}`}
      onDoubleClick={onDoubleClick}
      draggable={!isSelectionMode}
      onDragStart={(e) => {
        if (shouldIgnoreDragStartTarget(e.target)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData(INTERNAL_DRAG_MIME, JSON.stringify({ id: item.id }));
        e.dataTransfer.setData('text/plain', item.content || '');
        e.dataTransfer.effectAllowed = 'copyMove';
        document.documentElement.setAttribute('data-internal-drag', 'true');
      }}
      onDragEnd={() => {
        document.documentElement.removeAttribute('data-internal-drag');
      }}
    >
      <div className="compact-card-header panel-card-header">
        {isSelectionMode && (
          <button
            type="button"
            className={`compact-card-select-toggle ${isMultiSelected ? 'checked' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleMultiSelect?.();
            }}
            title={isMultiSelected ? t('multiSelect.unselectItem') : t('multiSelect.selectItem')}
            aria-label={isMultiSelected ? t('multiSelect.unselectItem') : t('multiSelect.selectItem')}
            aria-pressed={isMultiSelected}
          >
            <span className="compact-card-select-indicator">
              {isMultiSelected ? <Check size={10} /> : null}
            </span>
          </button>
        )}
        <div className="compact-card-head-main panel-card-head-main">
          <span className="compact-card-type-icon panel-card-type-icon" aria-hidden="true">
            <TypeIcon
              type={item.type_}
              hasCodeLanguage={!!item.code_language}
              isCurl={isCurl}
              isDateTime={isDateTime}
              hasTranslation={Boolean(translation)}
            />
          </span>
          <span className="compact-card-time panel-card-time">
            {timeLabel}
          </span>
          <span className="compact-card-source panel-card-source" title={sourceApp}>
            {sourceApp}
          </span>
          {item.is_favorite && (
            <div className="compact-card-state panel-card-state">
              <span
                className="compact-card-state-chip panel-card-state-chip favorite"
                title={t('item.favorite')}
                aria-label={t('item.favorite')}
              >
                <Star size={9} fill="currentColor" />
              </span>
            </div>
          )}
        </div>
        <div className="compact-card-badges-wrap" ref={colorPickerRef}>
          <div className="compact-card-badges panel-card-actions panel-card-actions--hover-reveal">
            {canDragOut && (
              <button
                type="button"
                className="badge-btn panel-card-action-btn badge-dragout"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStartExternalDrag?.(item);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={t('toolbar.dragToApp')}
                aria-label={t('toolbar.dragToApp')}
              >
                <GripVertical size={10} />
              </button>
            )}
            {canOpen && (
              <button
                type="button"
                className="badge-btn panel-card-action-btn badge-open"
                draggable={false}
                data-longpress-ignore="true"
                onPointerDown={stopActionPointerDown}
                onMouseDown={stopActionPointerDown}
                onDragStart={preventActionDrag}
                onClick={(e) => {
                  stopActionClick(e);
                  onOpenItem?.(item);
                }}
                title={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
                aria-label={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
              >
                <ExternalLink size={10} />
              </button>
            )}
            {(item.type_ === 'file' || item.type_ === 'image') && (
              <button
                type="button"
                className="badge-btn panel-card-action-btn badge-open"
                draggable={false}
                data-longpress-ignore="true"
                onPointerDown={stopActionPointerDown}
                onMouseDown={stopActionPointerDown}
                onDragStart={preventActionDrag}
                onClick={(e) => {
                  stopActionClick(e);
                  onRevealInFolder?.(item);
                }}
                title={t('item.revealInFolder')}
                aria-label={t('item.revealInFolder')}
              >
                <FolderOpen size={10} />
              </button>
            )}
            {translation && (
              <button
                type="button"
                className={`badge-btn panel-card-action-btn badge-translate ${showTranslation ? 'active' : ''}`}
                draggable={false}
                data-longpress-ignore="true"
                onPointerDown={stopActionPointerDown}
                onMouseDown={stopActionPointerDown}
                onDragStart={preventActionDrag}
                onClick={(e) => {
                  stopActionClick(e);
                  setShowTranslation(prev => !prev);
                }}
                title={showTranslation ? t('item.showOriginal') : t('item.showTranslation')}
                aria-label={showTranslation ? t('item.showOriginal') : t('item.showTranslation')}
              >
                <Languages size={10} />
              </button>
            )}
            {translation && (
              <button
                type="button"
                className="badge-btn panel-card-action-btn badge-copy-trans"
                draggable={false}
                data-longpress-ignore="true"
                onPointerDown={stopActionPointerDown}
                onMouseDown={stopActionPointerDown}
                onDragStart={preventActionDrag}
                onClick={(e) => {
                  stopActionClick(e);
                  navigator.clipboard.writeText(translation.text);
                  setCopiedTranslation(true);
                  setTimeout(() => setCopiedTranslation(false), 1500);
                }}
                title={t('item.copyTranslation')}
                aria-label={t('item.copyTranslation')}
              >
                {copiedTranslation ? <Check size={10} /> : <Copy size={10} />}
              </button>
            )}
            <button
              type="button"
              className={`badge-btn panel-card-action-btn badge-color ${hasCustomCardBackground ? 'tinted' : ''}`}
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
              <Palette size={10} />
            </button>
            <button
              type="button"
              className={`badge-btn panel-card-action-btn badge-fav ${item.is_favorite ? 'active' : ''}`}
              draggable={false}
              data-longpress-ignore="true"
              onPointerDown={stopActionPointerDown}
              onMouseDown={stopActionPointerDown}
              onDragStart={preventActionDrag}
              onClick={(e) => {
                stopActionClick(e);
                onToggleFavorite?.(item);
              }}
              title={t('item.favorite')}
              aria-label={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
            >
              <Star size={10} fill={item.is_favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
          {showColorPicker && (
            <div
              className="compact-card-color-picker"
              onMouseDown={(e) => {
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
                    key={preset.id}
                    type="button"
                    className={`compact-card-color-dot ${isActive ? 'active' : ''} ${isDefault ? 'default' : ''}`}
                    style={!isDefault ? { '--card-color-dot': preset.dot } : undefined}
                    title={t(preset.labelKey)}
                    aria-label={t(preset.labelKey)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleBackgroundSelect(preset.id);
                    }}
                  >
                    {isDefault && <span className="compact-card-color-dot-reset"></span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {(searchSources.length > 0 || searchSnippet) && (
        <div className="compact-card-search-context">
          {searchSources.length > 0 && (
            <div className="compact-card-search-sources">
              {searchSources.map((sourceKey) => (
                <span key={sourceKey} className="search-source-chip">
                  {t(`search.matchSource.${sourceKey}`)}
                </span>
              ))}
            </div>
          )}
          {searchSnippet && (
            <div className="compact-card-search-snippet">
              {renderHighlightedSnippet(searchSnippet, searchHighlightTerm)}
            </div>
          )}
        </div>
      )}
      <div className="compact-card-body panel-card-body">
        {isCopied && (
          <div className="copy-success-toast">
            <Check size={16} /> {useAppStore.getState().lastCopyWasAutoPaste ? t('item.autoPasted') : t('item.copied')}
          </div>
        )}
        {renderContent()}
      </div>
      {(userNote || userTags.length > 0) && (
        <div className="compact-card-footer panel-card-footer">
          {userNote && (
            <div className="compact-card-note panel-card-note" title={userNote}>
              {userNote}
            </div>
          )}
          {visibleUserTags.length > 0 && (
            <div className="compact-card-tags panel-card-tags">
              {visibleUserTags.map(tag => (
                <span
                  key={tag}
                  className="compact-tag panel-card-tag clickable"
                  onClick={(e) => { e.stopPropagation(); onTagClick?.(tag); }}
                >
                  {tag}
                </span>
              ))}
              {hiddenUserTagsCount > 0 && (
                <span className="compact-tag panel-card-tag more">+{hiddenUserTagsCount}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(CompactCard);
