import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Star, Trash2 } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { formatDate } from '../../utils/formatters';
import { getSourceApp } from '../../utils/tagHelpers';
import { getImageThumbnail } from '../../utils/imageHelpers';
import { getFileName } from '../../utils/formatters';
import '../../styles/hover-preview.css';

const MAX_WIDTH = 520;
const CLICK_DRAG_THRESHOLD = 4;

function HoverPreviewInner() {
  const { t, i18n } = useTranslation();
  const item = useAppStore(s => s.hoverPreviewItem);
  const position = useAppStore(s => s.hoverPreviewPosition);
  const clearHoverPreview = useAppStore(s => s.clearHoverPreview);
  const handleCopy = useAppStore(s => s.handleCopy);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const deleteItem = useAppStore(s => s.deleteItem);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const panelRef = useRef(null);
  const pointerStartRef = useRef(null);
  const pointerMovedRef = useRef(false);
  const [pos, setPos] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!item || !position) { setPos(null); return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = position.right + 8;
    let top = position.top;

    if (vw - left < MAX_WIDTH + 16) {
      left = position.left - MAX_WIDTH - 8;
      if (left < 8) left = 8;
    }
    const estimatedHeight = 300;
    if (top + estimatedHeight > vh) {
      top = Math.max(8, vh - estimatedHeight - 8);
    }
    setPos({ top, left });
  }, [item, position]);

  useEffect(() => {
    if (!item) return;
    const handleMouseDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      clearHoverPreview();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [item, clearHoverPreview]);

  if (!item || !pos) return null;

  const sourceApp = getSourceApp(item.metadata);

  const handleCopyClick = async (e) => {
    e.stopPropagation();
    await handleCopy(item);
  };

  const handleFavoriteClick = async (e) => {
    e.stopPropagation();
    await toggleFavorite(item);
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      deleteItem(item);
      clearHoverPreview();
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const handleContentDoubleClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (item.type_ === 'file') {
      // file open
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_item', { id: item.id });
      } catch (error) {
        console.error('open file failed:', error);
      }
    } else {
      // copy
      await handleCopy(item);
    }
  };

  const handlePanelMouseDown = (event) => {
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    pointerMovedRef.current = false;
  };

  const handlePanelMouseMove = (event) => {
    if (!pointerStartRef.current) return;
    const dx = Math.abs(event.clientX - pointerStartRef.current.x);
    const dy = Math.abs(event.clientY - pointerStartRef.current.y);
    if (dx > CLICK_DRAG_THRESHOLD || dy > CLICK_DRAG_THRESHOLD) {
      pointerMovedRef.current = true;
    }
  };

  const handlePanelMouseUp = () => {
    pointerStartRef.current = null;
  };

  const handlePanelClick = (event) => {
    event.stopPropagation();

    const selection = window.getSelection?.();
    const hasSelection = Boolean(selection && !selection.isCollapsed);
    if (pointerMovedRef.current || hasSelection) {
      pointerMovedRef.current = false;
      return;
    }

    clearHoverPreview();
  };

  const renderContent = () => {
    const doubleClickHint = item.type_ === 'file'
      ? t('item.doubleClickToOpen')
      : t('item.doubleClickToCopy');

    switch (item.type_) {
      case 'image': {
        const thumb = getImageThumbnail(item.image_paths);
        return (
          <div
            className="hover-preview-image"
            onDoubleClick={handleContentDoubleClick}
            title={doubleClickHint}
          >
            {thumb && <img src={thumb} alt="" />}
            {item.ocr_text && (
              <div className="hover-preview-ocr">{item.ocr_text}</div>
            )}
          </div>
        );
      }
      case 'file': {
        const files = (item.content || '').split('\n').filter(Boolean);
        return (
          <div
            className="hover-preview-files"
            onDoubleClick={handleContentDoubleClick}
            title={doubleClickHint}
          >
            {files.slice(0, 10).map((f, i) => (
              <div key={i} className="hover-preview-file-item">{getFileName(f)}</div>
            ))}
            {files.length > 10 && <div className="hover-preview-more">+{files.length - 10}</div>}
          </div>
        );
      }
      case 'link':
        return (
          <div
            className="hover-preview-text"
            onDoubleClick={handleContentDoubleClick}
            title={doubleClickHint}
          >
            {item.content || ''}
          </div>
        );
      default: {
        return (
          <div
            className="hover-preview-text"
            onDoubleClick={handleContentDoubleClick}
            title={doubleClickHint}
          >
            {item.content || ''}
          </div>
        );
      }
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="hover-preview"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={handlePanelMouseDown}
      onMouseMove={handlePanelMouseMove}
      onMouseUp={handlePanelMouseUp}
      onClick={handlePanelClick}
    >
      <div className="hover-preview-actions">
        <button
          className={`hover-preview-action-btn ${copiedItemId === item.id ? 'copied' : ''}`}
          onClick={handleCopyClick}
          title={t('item.copy')}
        >
          <Copy size={16} />
        </button>
        <button
          className={`hover-preview-action-btn favorite ${item.is_favorite ? 'active' : ''}`}
          onClick={handleFavoriteClick}
          title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
        >
          <Star size={16} fill={item.is_favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className={`hover-preview-action-btn delete ${showDeleteConfirm ? 'confirm' : ''}`}
          onClick={handleDeleteClick}
          title={showDeleteConfirm ? t('item.confirmDelete') : t('item.delete')}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="hover-preview-content">{renderContent()}</div>
      <div className="hover-preview-meta">
        <span>{formatDate(item.created_at, i18n.language)}</span>
        {sourceApp !== 'Unknown' && <span>{sourceApp}</span>}
      </div>
    </div>,
    document.body
  );
}

const HoverPreview = memo(HoverPreviewInner);
export default HoverPreview;
