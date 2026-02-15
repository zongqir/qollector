import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, FileText, Image, Type, Link } from 'lucide-react';
import { formatDate, getTimelineColor, getContentPreview, getFileName, getFileList } from '../../utils/formatters';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import { getImageThumbnail } from '../../utils/imageHelpers';

const TypeIcon = ({ type }) => {
  const size = 14;
  switch (type) {
    case 'image': return <Image size={size} />;
    case 'file': return <FileText size={size} />;
    case 'link': return <Link size={size} />;
    default: return <Type size={size} />;
  }
};

function CompactCard({ item, isSelected, onDragStart }) {
  const { t, i18n } = useTranslation();
  const timelineColor = getTimelineColor(item.created_at);
  const tags = getTags(item.tags);
  const userTags = tags.filter(tag => !tag.startsWith('AI:'));

  const cardClasses = [
    'compact-card',
    item.is_favorite && 'favorite',
    isSelected && 'selected',
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
    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      return (
        <div className="compact-card-text">
          {files.map(f => getFileName(f)).join(', ')}
        </div>
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
        <TypeIcon type={item.type_} />
        <span className="compact-card-time">
          {formatDate(item.created_at, i18n.language)}
        </span>
        <div className="compact-card-badges">
          {item.is_favorite && <Star size={12} className="badge-fav" fill="currentColor" />}
        </div>
      </div>
      <div className="compact-card-body">
        {renderContent()}
      </div>
      {userTags.length > 0 && (
        <div className="compact-card-tags">
          {userTags.slice(0, 3).map(tag => (
            <span key={tag} className="compact-tag">{tag}</span>
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
