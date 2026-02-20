import { memo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Inbox, FileText, Image, Type, Link, Code, GripVertical, ExternalLink, Check, FolderOpen } from 'lucide-react';
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
import useAppStore from '../../store/useAppStore';

const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

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
  onDragStart,
  onStartExternalDrag,
  onTogglePin,
  onToggleFavorite,
  onOpenItem,
  onRevealInFolder,
  onTagClick,
}) {
  const { t, i18n } = useTranslation();
  const timelineColor = getTimelineColor(item.created_at);
  const timeLabel = formatHistoryCardTime(
    item.created_at,
    i18n.language,
    timeTick,
    t('item.justNow'),
  );
  const tags = getTags(item.tags);
  const userTags = tags.filter(tag => !tag.startsWith('AI:'));
  const canDragOut = item.type_ === 'file' || item.type_ === 'image';
  const canOpen = item.type_ === 'link' || item.type_ === 'file';

  const cardClasses = [
    'compact-card',
    item.is_pinned && 'pinned',
    item.is_favorite && 'favorite',
    isSelected && 'selected',
    isMultiSelected && 'multi-selected',
    isFocused && 'keyboard-focused',
    isCopied && 'copied',
  ].filter(Boolean).join(' ');

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
      style={{ '--timeline-color': timelineColor }}
      title={`${formatDate(item.created_at, i18n.language)} · ${getSourceApp(item.metadata)}`}
      draggable="true"
      onDragStart={(e) => onDragStart && onDragStart(item, e)}
    >
      <div className="compact-card-header">
        <TypeIcon type={item.type_} hasCodeLanguage={!!item.code_language} />
        <span className="compact-card-time">
          {timeLabel}
        </span>
        <div className="compact-card-badges">
          {canDragOut && (
            <button
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
            >
              <GripVertical size={10} />
            </button>
          )}
          {canOpen && (
            <button
              className="badge-btn badge-open"
              onClick={(e) => { e.stopPropagation(); onOpenItem?.(item); }}
              title={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
            >
              <ExternalLink size={10} />
            </button>
          )}
          {item.type_ === 'file' && (
            <button
              className="badge-btn badge-open"
              onClick={(e) => { e.stopPropagation(); onRevealInFolder?.(item); }}
              title={t('item.revealInFolder')}
            >
              <FolderOpen size={10} />
            </button>
          )}
          <button
            className={`badge-btn badge-pin ${item.is_pinned ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(item); }}
            title={t('preview.pin')}
          >
            <Inbox size={10} />
          </button>
          <button
            className={`badge-btn badge-fav ${item.is_favorite ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(item); }}
            title={t('preview.favorite')}
          >
            <Star size={10} fill={item.is_favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
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
