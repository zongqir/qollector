import { useTranslation } from 'react-i18next';
import { getContentPreview, getFileList, getFileName } from '../../utils/formatters';
import { getImageThumbnail, getImageOriginal } from '../../utils/imageHelpers';

function ItemContent({
  item, isExpanded, isCopied,
  onClick, onDoubleClick,
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`item-content clickable ${isExpanded ? 'expanded' : ''} ${isCopied ? 'copied' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {isCopied && (
        <div className="copy-success-toast">
          ✓ {t('item.copied')}
        </div>
      )}

      {item.type_ === 'image' && item.image_paths ? (
        <div className={`image-content-wrapper ${item.ocr_text ? 'has-ocr' : ''}`}>
          <div className="image-container">
            <img
              src={isExpanded ? getImageOriginal(item.image_paths) : getImageThumbnail(item.image_paths)}
              alt="Clipboard image"
              className="clipboard-image"
              loading="lazy"
            />
          </div>
          {item.ocr_text && (
            <div className="ocr-text-container">
              <div className="ocr-text-header">{t('item.recognizedText')}</div>
              <div className="ocr-text-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      ) : item.type_ === 'file' ? (
        <div className="file-list">
          {getFileList(item.content).map((path, idx) => (
            <div key={idx} className="file-item">
              <span className="file-icon">📄</span>
              <span className="file-name">{getFileName(path)}</span>
            </div>
          ))}
        </div>
      ) : (
        getContentPreview(item.content)
      )}
    </div>
  );
}

export default ItemContent;
