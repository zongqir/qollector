import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { ArrowLeft, FileText, Music, Film, File, Folder, FolderOpen } from 'lucide-react';
import PdfPreview from './PdfPreview';
import MarkdownView from './MarkdownView';
import { isMarkdownFile } from '../../utils/markdownRenderer';
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
  const [currentPath, setCurrentPath] = useState(filePath);
  const [pathStack, setPathStack] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const folderClickTimerRef = useRef(null);

  const clearFolderClickTimer = useCallback(() => {
    if (!folderClickTimerRef.current) return;
    clearTimeout(folderClickTimerRef.current);
    folderClickTimerRef.current = null;
  }, []);

  useEffect(() => () => clearFolderClickTimer(), [clearFolderClickTimer]);

  useEffect(() => {
    clearFolderClickTimer();
    setCurrentPath(filePath);
    setPathStack([]);
    setData(null);
    setError(false);
  }, [filePath, clearFolderClickTimer]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);

    invoke('preview_file', { filePath: currentPath })
      .then(result => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError(true); });

    return () => { cancelled = true; };
  }, [currentPath]);

  const handleOpenFile = useCallback(async (path) => {
    try {
      await invoke('open_file_path', { path });
    } catch (openError) {
      console.error('Failed to open file:', openError);
    }
  }, []);

  const handleEnterDirectory = useCallback((nextPath) => {
    if (!nextPath || nextPath === currentPath) return;
    setPathStack(prev => [...prev, currentPath]);
    setCurrentPath(nextPath);
  }, [currentPath]);

  const handleNavigateBack = useCallback(() => {
    if (pathStack.length === 0) return;
    const previousPath = pathStack[pathStack.length - 1];
    setPathStack(prev => prev.slice(0, -1));
    setCurrentPath(previousPath);
  }, [pathStack]);

  const handleDirectoryItemClick = useCallback((entry, clickDetail) => {
    if (!entry?.path) return;

    if (!entry.is_directory) {
      handleOpenFile(entry.path);
      return;
    }

    if (clickDetail > 1) {
      clearFolderClickTimer();
      handleOpenFile(entry.path);
      return;
    }

    clearFolderClickTimer();
    folderClickTimerRef.current = window.setTimeout(() => {
      handleEnterDirectory(entry.path);
      folderClickTimerRef.current = null;
    }, 220);
  }, [clearFolderClickTimer, handleEnterDirectory, handleOpenFile]);

  const renderFileName = data?.file_name || getFileName(currentPath);
  const renderFileSize = data?.file_size || 0;

  if (error) {
    return (
      <div className="file-preview-item">
        <div className="file-preview-header">
          <FileText size={14} />
          <span className="file-name">{renderFileName}</span>
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
          <span className="file-name">{renderFileName}</span>
        </div>
        <div className="file-preview-loading">{t('filePreview.loading')}</div>
      </div>
    );
  }

  const assetSrc = convertFileSrc(data.file_path);
  const typeIcon = {
    directory: <Folder size={14} />,
    image: <FileText size={14} />,
    text: <FileText size={14} />,
    audio: <Music size={14} />,
    video: <Film size={14} />,
    pdf: <FileText size={14} />,
    binary: <File size={14} />,
  }[data.preview_type] || <File size={14} />;

  const renderBody = () => {
    if (data.preview_type === 'directory' && data.directory_items) {
      return (
        <>
          <div className="directory-header">
            <span className="directory-header-title">{t('filePreview.directoryItems')}</span>
            <span className="directory-header-hint">{t('filePreview.folderNavigationHint')}</span>
          </div>

          <div className="directory-nav">
            <button
              type="button"
              className="directory-nav-back"
              onClick={handleNavigateBack}
              disabled={pathStack.length === 0}
              title={t('filePreview.back')}
            >
              <ArrowLeft size={14} />
              <span>{t('filePreview.back')}</span>
            </button>
            <div className="directory-nav-path" title={currentPath}>
              <span className="directory-nav-path-label">{t('filePreview.pathLabel')}</span>
              <span className="directory-nav-path-value">{currentPath}</span>
            </div>
          </div>

          {data.directory_items.length === 0 ? (
            <div className="directory-empty">
              <FolderOpen size={20} />
              <span>{t('filePreview.emptyDirectory')}</span>
            </div>
          ) : (
            <div className="directory-items">
              {data.directory_items.map((entry, idx) => (
                <div
                  key={idx}
                  className={`directory-item ${entry.is_directory ? 'directory-item-folder' : ''}`}
                  onClick={(event) => handleDirectoryItemClick(entry, event.detail)}
                  title={entry.path}
                >
                  <div className="directory-item-icon">
                    {entry.is_directory ? <Folder size={14} /> : <File size={14} />}
                  </div>
                  <div className="directory-item-name">{entry.name}</div>
                  {!entry.is_directory && (
                    <div className="directory-item-size">{formatFileSize(entry.size)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      );
    }

    switch (data.preview_type) {
      case 'image':
        return <img src={assetSrc} alt={data.file_name} loading="lazy" />;

      case 'text':
        if (!data.text_content) {
          return <div className="file-preview-error">{t('filePreview.fileTooLarge')}</div>;
        }
        if (isMarkdownFile(renderFileName)) {
          return (
            <div className="file-preview-markdown-wrapper">
              <MarkdownView content={data.text_content} />
              {data.text_truncated && (
                <div className="file-preview-text-truncated">{t('filePreview.textTruncated')}</div>
              )}
            </div>
          );
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
        <span className="file-size">{formatFileSize(renderFileSize)}</span>
      </div>
      <div className="file-preview-body">
        {renderBody()}
      </div>
    </div>
  );
}

export default FilePreviewItem;
