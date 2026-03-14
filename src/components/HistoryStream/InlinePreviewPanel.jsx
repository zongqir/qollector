import { memo, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, Trash2 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { getFileName } from '../../utils/formatters';
import { getImageThumbnail } from '../../utils/imageHelpers';
import { openItemPreview } from '../../utils/previewInteractionPolicy';

function InlinePreviewPanel({ item, onRequestClose }) {
  const { t } = useTranslation();
  const handleCopy = useAppStore(s => s.handleCopy);
  const deleteItem = useAppStore(s => s.deleteItem);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const confirmTimerRef = useRef(null);

  useEffect(() => {
    setShowDeleteConfirm(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, [item?.id]);

  useEffect(() => () => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  if (!item) return null;

  const copySource = 'history';
  const doubleClickHint = item.type_ === 'file'
    ? t('item.doubleClickToOpen')
    : t('item.doubleClickToCopy');

  const handleCopyClick = async (event) => {
    event.stopPropagation();
    await handleCopy(item, copySource);
  };

  const handleDeleteClick = async (event) => {
    event.stopPropagation();
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setShowDeleteConfirm(false);
        confirmTimerRef.current = null;
      }, 3000);
      return;
    }

    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    await deleteItem(item);
    onRequestClose?.();
  };

  const handleContentDoubleClick = async (event) => {
    event.stopPropagation();
    event.preventDefault();

    if (item.type_ === 'file') {
      try {
        await invoke('open_item', { id: item.id });
      } catch (error) {
        console.error('open file failed:', error);
      }
      return;
    }

    if (item.content) {
      try {
        await invoke('copy_plain_text', { text: item.content });
      } catch (error) {
        console.error('copy failed:', error);
      }
      return;
    }

    if (item.type_ === 'image') {
      await handleCopy(item, copySource);
    }
  };

  const handleContentKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      event.stopPropagation();
    }
  };

  const handleContentWheel = (event) => {
    const container = event.currentTarget;
    const canScroll = container.scrollHeight > container.clientHeight + 1;
    const outerScroller = container.closest('.history-stream-scroller');
    if (!canScroll) {
      if (outerScroller) {
        outerScroller.scrollTop += event.deltaY;
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const deltaY = event.deltaY;
    if (Math.abs(deltaY) < 0.1) return;

    const atTop = container.scrollTop <= 0;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
    const scrollingUp = deltaY < 0;
    const scrollingDown = deltaY > 0;

    // Prefer scrolling inside preview while not at bounds.
    if ((scrollingUp && !atTop) || (scrollingDown && !atBottom)) {
      event.stopPropagation();
      return;
    }

    // At top/bottom boundaries, forward wheel delta to outer history scroller.
    if (outerScroller) {
      outerScroller.scrollTop += deltaY;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const renderContent = () => {
    if (item.type_ === 'image') {
      const thumb = getImageThumbnail(item.image_paths);
      return (
        <div
          className="history-inline-preview-image"
          onDoubleClick={handleContentDoubleClick}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={doubleClickHint}
        >
          {thumb && <img src={thumb} alt="" />}
          {item.ocr_text && (
            <div className="history-inline-preview-ocr">{item.ocr_text}</div>
          )}
        </div>
      );
    }

    if (item.type_ === 'file') {
      const files = (item.content || '').split('\n').filter(Boolean);
      return (
        <div
          className="history-inline-preview-files"
          onDoubleClick={handleContentDoubleClick}
          onKeyDown={handleContentKeyDown}
          tabIndex={0}
          title={doubleClickHint}
        >
          {files.slice(0, 10).map((filePath, index) => (
            <div key={`${filePath}-${index}`} className="history-inline-preview-file-item">
              {getFileName(filePath)}
            </div>
          ))}
          {files.length > 10 && (
            <div className="history-inline-preview-more">+{files.length - 10}</div>
          )}
        </div>
      );
    }

    return (
      <div
        className="history-inline-preview-text"
        onDoubleClick={handleContentDoubleClick}
        onKeyDown={handleContentKeyDown}
        tabIndex={0}
        title={doubleClickHint}
      >
        {item.content || ''}
      </div>
    );
  };

  return (
    <div
      className={`history-inline-preview ${isMiniMode ? 'mini' : ''}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="history-inline-preview-content" onWheel={handleContentWheel}>
        {renderContent()}
      </div>
      <div className="history-inline-preview-toolbar">
        <span className="history-inline-preview-hint">{doubleClickHint}</span>
        <div className="history-inline-preview-actions">
          <button
            type="button"
            className="history-inline-preview-action-btn"
            onClick={(event) => {
              event.stopPropagation();
              openItemPreview(setPanelMode, item);
              onRequestClose?.();
            }}
            title={t('panel.preview')}
            aria-label={t('panel.preview')}
          >
            <Eye size={14} />
          </button>
          <button
            type="button"
            className={`history-inline-preview-action-btn ${copiedItemId === item.id && copyFeedbackSource === copySource ? 'copied' : ''}`}
            onClick={handleCopyClick}
            title={t('item.copy')}
            aria-label={t('item.copy')}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            className={`history-inline-preview-action-btn delete ${showDeleteConfirm ? 'confirm' : ''}`}
            onClick={handleDeleteClick}
            title={showDeleteConfirm ? t('item.confirmDelete') : t('item.delete')}
            aria-label={showDeleteConfirm ? t('item.confirmDelete') : t('item.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(InlinePreviewPanel);
