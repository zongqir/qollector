import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, FileText, GripVertical } from 'lucide-react';
import { getContentPreview, getFileList, getFileName } from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags } from '../../utils/tagHelpers';

function CollectionCard({ item, isCopied, onUnpin, onClick, onDoubleClick, dragListeners }) {
  const { t } = useTranslation();
  const tags = getTags(item.tags).filter(tag => !tag.startsWith('AI:'));

  const renderContent = () => {
    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="collection-card-image">
          <img
            src={getImageOriginal(item.image_paths)}
            alt=""
            loading="lazy"
          />
          {item.ocr_text && (
            <div className="collection-card-ocr">
              <div className="ocr-label">{t('item.recognizedText')}</div>
              <div className="ocr-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      );
    }
    if (item.type_ === 'file') {
      return (
        <div className="collection-card-files">
          {getFileList(item.content).map((path, idx) => (
            <div key={idx} className="file-item">
              <FileText size={16} />
              <span>{getFileName(path)}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="collection-card-text">
        {getContentPreview(item.content)}
      </div>
    );
  };

  return (
    <div
      className={`collection-card ${isCopied ? 'copied' : ''}`}
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
    >
      {isCopied && (
        <div className="copy-success-toast">
          <Check size={16} /> {t('item.copied')}
        </div>
      )}
      <button
        className="collection-card-remove"
        onClick={(e) => { e.stopPropagation(); onUnpin(); }}
        title={t('collection.removeFromCollection')}
      >
        <X size={14} />
      </button>
      {dragListeners && (
        <div className="collection-card-drag" {...dragListeners}>
          <GripVertical size={14} />
        </div>
      )}
      <div className="collection-card-content">
        {renderContent()}
      </div>
      {(item.user_note || tags.length > 0) && (
        <div className="collection-card-footer">
          {item.user_note && (
            <div className="collection-card-note">{item.user_note}</div>
          )}
          {tags.length > 0 && (
            <div className="collection-card-tags">
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

export default memo(CollectionCard);
