import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { FileText, Music, Film, File } from 'lucide-react';
import PdfPreview from './PdfPreview';
import { getFileName } from '../../utils/formatters';
import './FilePreview.css';

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function FilePreviewItem({ filePath }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke('preview_file', { filePath })
      .then(result => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [filePath]);

  if (error) {
    return (
      <div className="file-preview-item">
        <div className="file-preview-header">
          <FileText size={14} />
          <span className="file-name">{getFileName(filePath)}</span>
        </div>
        <div className="file-preview-error">{t('filePreview.fileNotFound')}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="file-preview-item">
        <div className="file-preview-header">
          <FileText size={14} />
          <span className="file-name">{getFileName(filePath)}</span>
        </div>
        <div className="file-preview-loading">{t('filePreview.loading')}</div>
      </div>
    );
  }

  const assetSrc = convertFileSrc(data.file_path);
  const typeIcon = {
    image: <FileText size={14} />,
    text: <FileText size={14} />,
    audio: <Music size={14} />,
    video: <Film size={14} />,
    pdf: <FileText size={14} />,
    binary: <File size={14} />,
  }[data.preview_type] || <File size={14} />;

  const renderBody = () => {
    switch (data.preview_type) {
      case 'image':
        return <img src={assetSrc} alt={data.file_name} loading="lazy" />;

      case 'text':
        if (!data.text_content) {
          return <div className="file-preview-error">{t('filePreview.fileTooLarge')}</div>;
        }
        return (
          <>
            <div className="file-preview-text">{data.text_content}</div>
            {data.text_truncated && (
              <div className="file-preview-text-truncated">{t('filePreview.textTruncated')}</div>
            )}
          </>
        );

      case 'audio':
        return <audio controls preload="metadata" src={assetSrc} />;

      case 'video':
        return <video controls preload="metadata" src={assetSrc} />;

      case 'pdf':
        if (data.file_size > 50 * 1024 * 1024) {
          return <div className="file-preview-error">{t('filePreview.fileTooLarge')}</div>;
        }
        return <PdfPreview src={assetSrc} />;

      default:
        return (
          <div className="file-preview-binary">
            <File size={20} />
            <span>{data.file_name}</span>
          </div>
        );
    }
  };

  return (
    <div className="file-preview-item">
      <div className="file-preview-header">
        {typeIcon}
        <span className="file-name">{data.file_name}</span>
        <span className="file-size">{formatFileSize(data.file_size)}</span>
      </div>
      <div className="file-preview-body">
        {renderBody()}
      </div>
    </div>
  );
}

export default FilePreviewItem;
