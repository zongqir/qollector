import { useTranslation } from 'react-i18next';
import { Plus, X, Send, PanelRightClose } from 'lucide-react';

function CollectionQuickNoteSection({
  isExpanded,
  quickNote,
  onQuickNoteChange,
  onQuickNoteKeyDown,
  onExpandedKeyDown,
  onExpandedSubmit,
  onCollapse,
  onExpand,
  onToggleCollectionPanel,
}) {
  const { t } = useTranslation();

  return (
    <div className={`collection-quick-note ${isExpanded ? 'expanded' : ''}`}>
      {isExpanded ? (
        <div className="quick-note-expanded">
          <div className="quick-note-expanded-body">
            <textarea
              className="quick-note-textarea"
              placeholder={t('collection.expandedNotePlaceholder')}
              value={quickNote}
              onChange={(event) => onQuickNoteChange(event.target.value)}
              onKeyDown={onExpandedKeyDown}
              autoFocus
            />
            <button
              className="quick-note-close-btn"
              onClick={onCollapse}
            >
              <X size={14} />
            </button>
          </div>
          <div className="quick-note-expanded-footer">
            <span className="quick-note-hint">Ctrl+Enter</span>
            <button
              className="quick-note-submit-btn"
              onClick={onExpandedSubmit}
              disabled={!quickNote.trim()}
            >
              <Send size={14} />
              <span>{t('collection.expandedNoteSubmit')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-note-collapsed-row">
          <div className="quick-note-input-wrapper">
            <button
              className="quick-note-expand-btn"
              onClick={onExpand}
              title={t('collection.expandedNotePlaceholder')}
            >
              <Plus size={16} />
            </button>
            <input
              type="text"
              className="quick-note-input"
              placeholder={t('collection.quickNotePlaceholder')}
              value={quickNote}
              onChange={(event) => onQuickNoteChange(event.target.value)}
              onKeyDown={onQuickNoteKeyDown}
            />
          </div>
          <button
            className="collection-close-inline-btn quick-note-panel-close-btn"
            onClick={onToggleCollectionPanel}
            title={t('collection.hidePanel')}
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default CollectionQuickNoteSection;
