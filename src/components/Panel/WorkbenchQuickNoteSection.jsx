import { useTranslation } from 'react-i18next';
import {
  Filter,
  Plus,
  Send,
  X,
} from 'lucide-react';

function WorkbenchQuickNoteSection({
  isExpanded,
  quickNote,
  quickNotePlaceholder,
  expandedNotePlaceholder,
  workbenchSwitcher = null,
  showFilterToggle = true,
  hasActiveFilters,
  isFiltersCollapsed,
  onToggleFiltersCollapsed,
  onQuickNoteChange,
  onQuickNoteKeyDown,
  onExpandedKeyDown,
  onExpandedSubmit,
  onCollapse,
  onExpand,
}) {
  const { t } = useTranslation();

  return (
    <div className={`workbench-quick-note ${isExpanded ? 'expanded' : ''}`}>
      {isExpanded ? (
        <div className="quick-note-expanded">
          <div className="quick-note-expanded-body">
            <textarea
              className="quick-note-textarea"
              placeholder={expandedNotePlaceholder || t('workbench.expandedNotePlaceholder')}
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
              <span>{t('workbench.expandedNoteSubmit')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-note-collapsed-row">
          <div className="quick-note-input-wrapper">
            <button
              className="quick-note-expand-btn"
              onClick={onExpand}
              title={t('workbench.expandedNotePlaceholder')}
            >
              <Plus size={16} />
            </button>
            <input
              type="text"
              className="quick-note-input"
              placeholder={quickNotePlaceholder || t('workbench.quickNotePlaceholder')}
              value={quickNote}
              onChange={(event) => onQuickNoteChange(event.target.value)}
              onKeyDown={onQuickNoteKeyDown}
            />
            {showFilterToggle && (
              <button
                type="button"
                className={`quick-note-filter-toggle-btn ${isFiltersCollapsed ? 'is-collapsed' : ''}`}
                onClick={onToggleFiltersCollapsed}
                title={isFiltersCollapsed ? t('workbench.expandFilters') : t('workbench.collapseFilters')}
                aria-label={isFiltersCollapsed ? t('workbench.expandFilters') : t('workbench.collapseFilters')}
                aria-expanded={!isFiltersCollapsed}
              >
                <Filter size={13} />
                {hasActiveFilters && <span className="quick-note-filter-active-dot" aria-hidden />}
              </button>
            )}
          </div>
          {workbenchSwitcher ? (
            <div className="quick-note-switcher-slot">
              {workbenchSwitcher}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default WorkbenchQuickNoteSection;
