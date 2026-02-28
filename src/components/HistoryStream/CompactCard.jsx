import { memo, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Inbox, FileText, Image, Type, Link, Code, GripVertical, ExternalLink, Expand, Check, FolderOpen, Palette } from 'lucide-react';
import {
  formatDate,
  formatHistoryCardTime,
  getTimelineColor,
  getContentPreview,
  getFileName,
  getFileList,
  parseUrl,
  getLinkPreviewTitle,
} from '../../utils/formatters';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import { getImageThumbnail } from '../../utils/imageHelpers';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../utils/cardBackgrounds';
import useAppStore from '../../store/useAppStore';
import { openHistoryEditorWindow } from '../../services/windowService';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TypeIcon = ({ type, hasCodeLanguage }) => {
  const size = 11;
  if (hasCodeLanguage) return <Code size={size} />;
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
  isFocused,
  isCopied,
  timeTick,
  searchExplain,
  onDragStart,
  supportsNativeExternalDrag,
  onStartExternalDrag,
  onTogglePin,
  onToggleFavorite,
  onOpenItem,
  onRevealInFolder,
  onSetCardBackground,
  onTagClick,
}) {
  const { t, i18n } = useTranslation();
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef(null);
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
  const canDragOut = supportsNativeExternalDrag && (item.type_ === 'file' || item.type_ === 'image');
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

  const cardClasses = [
    'compact-card',
    itemTypeClass,
    hasCustomCardBackground && 'custom-bg',
    item.is_pinned && 'pinned',
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
    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="compact-card-image">
          <img
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
          <div className="compact-card-link">
            <img
              className="compact-link-favicon"
              src={parsed.favicon}
              alt=""
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'inline'; }}
            />
            <Link size={14} className="compact-link-fallback" style={{ display: 'none' }} />
            <div className="compact-link-info">
              <span className="compact-link-title">{title || parsed.domain}</span>
              <span className="compact-link-domain">{parsed.domain}</span>
              {decodedPath && <span className="compact-link-path">{decodedPath}</span>}
            </div>
          </div>
        );
      }
    }
    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      return (
        <div className="compact-card-text">
          {files.map(f => getFileName(f)).join(', ')}
        </div>
      );
    }
    if (item.code_language && item.content) {
      return (
        <Suspense fallback={<div className="compact-card-text">{getContentPreview(item.content)}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={3} compact />
        </Suspense>
      );
    }
    return (
      <div className="compact-card-text">
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
      draggable="true"
      onDragStart={(e) => onDragStart && onDragStart(item, e)}
    >
      <div className="compact-card-header">
        <TypeIcon type={item.type_} hasCodeLanguage={!!item.code_language} />
        <span className="compact-card-time">
          {timeLabel}
        </span>
        <span className="compact-card-source" title={sourceApp}>
          {sourceApp}
        </span>
        <div className="compact-card-badges-wrap" ref={colorPickerRef}>
          <div className="compact-card-badges">
            {canDragOut && (
              <button
                type="button"
                className="badge-btn badge-dragout"
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
                className="badge-btn badge-open"
                onClick={(e) => { e.stopPropagation(); onOpenItem?.(item); }}
                title={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
                aria-label={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
              >
                <ExternalLink size={10} />
              </button>
            )}
            {(item.type_ === 'file' || item.type_ === 'image') && (
              <button
                type="button"
                className="badge-btn badge-open"
                onClick={(e) => { e.stopPropagation(); onRevealInFolder?.(item); }}
                title={t('item.revealInFolder')}
                aria-label={t('item.revealInFolder')}
              >
                <FolderOpen size={10} />
              </button>
            )}
            {item.type_ !== 'file' && (
              <button
                type="button"
                className="badge-btn badge-window"
                onClick={(e) => {
                  e.stopPropagation();
                  void openHistoryEditorWindow(item.id, t);
                }}
                title={t('item.openInNewWindow')}
                aria-label={t('item.openInNewWindow')}
              >
                <Expand size={10} />
              </button>
            )}
            <button
              type="button"
              className={`badge-btn badge-color ${hasCustomCardBackground ? 'tinted' : ''}`}
              onMouseDown={(e) => {
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
              <Palette size={10} />
            </button>
            <button
              type="button"
              className={`badge-btn badge-pin ${item.is_pinned ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onTogglePin?.(item); }}
              title={t('item.pin', { max: 10 })}
              aria-label={item.is_pinned ? t('item.unpin') : t('item.pin', { max: 10 })}
            >
              <Inbox size={10} />
            </button>
            <button
              type="button"
              className={`badge-btn badge-fav ${item.is_favorite ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(item); }}
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
      <div className="compact-card-body">
        {isCopied && (
          <div className="copy-success-toast">
            <Check size={16} /> {useAppStore.getState().lastCopyWasAutoPaste ? t('item.autoPasted') : t('item.copied')}
          </div>
        )}
        {renderContent()}
      </div>
      {userTags.length > 0 && (
        <div className="compact-card-tags">
          {userTags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="compact-tag clickable"
              onClick={(e) => { e.stopPropagation(); onTagClick?.(tag); }}
            >
              {tag}
            </span>
          ))}
          {userTags.length > 3 && (
            <span className="compact-tag more">+{userTags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(CompactCard);
