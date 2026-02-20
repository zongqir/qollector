import { memo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Folder, ExternalLink, FileText } from 'lucide-react';
import {
  getContentPreview,
  getFileList,
  getFileName,
  parseUrl,
  getLinkPreviewTitle,
} from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags } from '../../utils/tagHelpers';

// Lazy load FileIcon to reduce initial bundle size
const FileIconLazy = lazy(() =>
  import('react-file-icon').then(module => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...defaultStyles[extension]} {...props} />;
    }
  }))
);

const getExt = (filename) => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

const isFolder = (path) => {
  if (path.endsWith('/') || path.endsWith('\\')) return true;
  const name = path.split(/[/\\]/).pop() || '';
  return !name.includes('.');
};

function CollectionCard({
  item,
  isCopied,
  isMultiSelected,
  onUnpin,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
  onOpenItem,
}) {
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
          <div className="collection-card-link">
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
        <div className={`collection-card-files ${isSingle ? 'single-file' : ''}`}>
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
    return (
      <div className="collection-card-text">
        {getContentPreview(item.content)}
      </div>
    );
  };

  return (
    <div
      className={`collection-card ${isCopied ? 'copied' : ''} ${isMultiSelected ? 'multi-selected' : ''}`}
      onPointerDownCapture={onPointerDownCapture}
      onClick={onClick}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(e); }}
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
