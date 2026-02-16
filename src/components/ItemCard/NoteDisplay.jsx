import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

function NoteDisplay({
  item, editingNoteId, editNote, onEditNoteChange,
  onStartEditNote, onSaveNote, onCancelNoteEdit,
}) {
  const { t } = useTranslation();

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
              onSaveNote(item);
            } else if (e.key === 'Escape') {
              onCancelNoteEdit();
            }
          }}
        />
        <div className="note-edit-footer">
          <span className="note-edit-hint">Ctrl+Enter</span>
          <div className="note-edit-actions">
            <button onClick={onCancelNoteEdit} className="note-btn-cancel" title={t('item.cancelNote')}>
              <X size={13} />
            </button>
            <button onClick={() => onSaveNote(item)} className="note-btn-save" title={t('item.saveNote')}>
              <Check size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (item.user_note) {
    return (
      <div
        className="note-display-bar"
        onClick={() => onStartEditNote(item)}
        title={t('item.clickToEditNote')}
      >
        <span className="note-text">{item.user_note}</span>
      </div>
    );
  }

  return null;
}

export default memo(NoteDisplay);
