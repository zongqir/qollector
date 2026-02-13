import { useTranslation } from 'react-i18next';

function NoteDisplay({
  item, editingNoteId, editNote, onEditNoteChange,
  onStartEditNote, onSaveNote, onCancelNoteEdit,
}) {
  const { t } = useTranslation();

  if (editingNoteId === item.id) {
    return (
      <div className="note-edit-bar">
        <span className="note-icon">📝</span>
        <textarea
          value={editNote}
          onChange={(e) => onEditNoteChange(e.target.value)}
          className="note-edit-input"
          rows={1}
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
        <button onClick={() => onSaveNote(item)} className="note-btn-save" title={t('item.saveNote')}>✓</button>
        <button onClick={onCancelNoteEdit} className="note-btn-cancel" title={t('item.cancelNote')}>✕</button>
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

export default NoteDisplay;
