import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

function NoteDisplay({
  item, editingNoteId, editNote, onEditNoteChange,
  onStartEditNote, onSaveNote, onCancelNoteEdit,
  variant = 'default',
  focusMode = false,
  onPreviewStateChange,
}) {
  const { t } = useTranslation();
  const noteTextRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [hasExpandedOverflow, setHasExpandedOverflow] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [item?.id]);

  useEffect(() => {
    if (typeof onPreviewStateChange === 'function') {
      onPreviewStateChange({
        isExpanded,
        canExpand,
        hasExpandedOverflow,
      });
    }
  }, [canExpand, hasExpandedOverflow, isExpanded, onPreviewStateChange]);

  useLayoutEffect(() => {
    if (variant !== 'preview' || editingNoteId === item?.id || !item?.user_note) {
      setCanExpand(false);
      setHasExpandedOverflow(false);
      return undefined;
    }

    const element = noteTextRef.current;
    if (!element) {
      setCanExpand(false);
      setHasExpandedOverflow(false);
      return undefined;
    }

    const checkOverflow = () => {
      const hasOverflow = element.scrollHeight - element.clientHeight > 2;
      if (isExpanded) {
        setCanExpand(true);
        setHasExpandedOverflow(hasOverflow);
        return;
      }
      setCanExpand(hasOverflow);
      setHasExpandedOverflow(false);
    };

    checkOverflow();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [editingNoteId, item?.id, item?.user_note, variant, isExpanded]);

  if (editingNoteId === item.id) {
    return (
      <div className="note-edit-bar" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={editNote}
          onChange={(e) => onEditNoteChange(e.target.value)}
          className="note-edit-input"
          rows={2}
          placeholder={t('edit.notePlaceholder')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.stopPropagation();
              onSaveNote(item);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              e.preventDefault();
              onCancelNoteEdit();
            }
          }}
        />
        <div className="note-edit-footer">
          <span className="note-edit-hint">Ctrl+Enter</span>
          <div className="note-edit-actions">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelNoteEdit();
              }}
              className="note-btn-cancel"
              title={t('item.cancelNote')}
            >
              <X size={12} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSaveNote(item);
              }}
              className="note-btn-save"
              title={t('item.saveNote')}
            >
              <Check size={12} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (item.user_note) {
    if (variant === 'preview') {
      return (
        <div className={`note-display-bar note-display-bar--preview ${focusMode ? 'is-focus-mode' : ''}`}>
          <div className="note-display-content note-display-content--preview">
            <span
              ref={noteTextRef}
              className={`note-text ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
            >
              {item.user_note}
            </span>
          </div>
          <div className={`note-display-actions ${focusMode ? 'note-display-actions--focus' : ''}`}>
            {canExpand && (
              <button
                type="button"
                className="note-toggle-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsExpanded((current) => !current);
                }}
              >
                {isExpanded ? t('item.collapse') : t('item.expand')}
              </button>
            )}
            <button
              type="button"
              className="note-toggle-btn"
              onClick={(event) => {
                event.stopPropagation();
                onStartEditNote(item);
              }}
              title={t('item.clickToEditNote')}
            >
              {t('item.editNote')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="note-display-bar"
        onClick={(event) => {
          event.stopPropagation();
          onStartEditNote(item);
        }}
        title={t('item.clickToEditNote')}
      >
        <span className="note-text">{item.user_note}</span>
      </div>
    );
  }

  return null;
}

export default memo(NoteDisplay);
