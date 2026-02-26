import { Bookmark, Save, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import FilterTriggerButton from './FilterTriggerButton';
import FilterDropdown from './FilterDropdown';
import FilterListbox from './FilterListbox';

function SavedViewControl({
  wrapperRef,
  triggerClassName = '',
  isOpen,
  onToggle,
  onClose,
  controlsId,
  savedViews,
  activeFilterViewId,
  activeSavedView,
  savedViewName,
  onSavedViewNameChange,
  onSaveView,
  onApplySavedView,
  onDeleteSavedView,
  onClearActiveSavedView,
  titleText,
  namePlaceholderText,
  saveCurrentText,
  emptyText,
  activeText,
  deleteText,
  clearActiveText,
}) {
  const normalizedSavedViews = Array.isArray(savedViews) ? savedViews : [];
  const savedViewOptions = useMemo(
    () => normalizedSavedViews.map(view => ({ key: view.id, view })),
    [normalizedSavedViews],
  );
  const [activeOptionKey, setActiveOptionKey] = useState(null);

  const focusTriggerButton = useCallback(() => {
    const target = wrapperRef?.current?.querySelector?.('button.filter-trigger-btn');
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }, [wrapperRef]);

  const handleCloseAndRestoreTriggerFocus = useCallback((event) => {
    onClose?.(event);
    window.setTimeout(() => {
      focusTriggerButton();
    }, 0);
  }, [onClose, focusTriggerButton]);

  const handleSavedViewListUnhandledKeyDown = useCallback((event, activeOption) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const targetViewId = activeOption?.key || activeOptionKey;
    if (!targetViewId) return;
    event.preventDefault();
    event.stopPropagation();
    onDeleteSavedView?.(targetViewId);
  }, [activeOptionKey, onDeleteSavedView]);

  return (
    <div className={`saved-view-wrapper ${triggerClassName}`.trim()} ref={wrapperRef}>
      <FilterTriggerButton
        onToggle={onToggle}
        onOpen={onToggle}
        onClose={handleCloseAndRestoreTriggerFocus}
        className="saved-view-btn"
        label={titleText}
        title={titleText}
        isOpen={isOpen}
        isActive={Boolean(activeSavedView)}
        popup="dialog"
        controlsId={controlsId}
        pressed={Boolean(activeSavedView)}
      >
        <Bookmark size={15} />
        {normalizedSavedViews.length > 0 && (
          <span className="icon-btn-badge">{Math.min(normalizedSavedViews.length, 99)}</span>
        )}
      </FilterTriggerButton>
      {isOpen && (
        <FilterDropdown
          id={controlsId}
          className="saved-view-dropdown"
          role="dialog"
          onClose={handleCloseAndRestoreTriggerFocus}
        >
          <div className="saved-view-header">{titleText}</div>
          <div className="saved-view-create-row">
            <input
              type="text"
              value={savedViewName}
              placeholder={namePlaceholderText}
              className="saved-view-input"
              onChange={(event) => onSavedViewNameChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSaveView?.();
                }
              }}
            />
            <button
              type="button"
              className="saved-view-save-btn"
              onClick={onSaveView}
              disabled={!savedViewName.trim()}
              title={saveCurrentText}
              aria-label={saveCurrentText}
            >
              <Save size={12} />
            </button>
          </div>
          {normalizedSavedViews.length === 0 ? (
            <div className="saved-view-empty">{emptyText}</div>
          ) : (
            <FilterListbox
              id={`${controlsId}-list`}
              className="saved-view-list"
              options={savedViewOptions}
              selectedKey={activeFilterViewId}
              onSelect={(viewId) => {
                onApplySavedView?.(viewId);
                onClose?.();
              }}
              onActiveOptionChange={(option) => setActiveOptionKey(option?.key || null)}
              onUnhandledKeyDown={handleSavedViewListUnhandledKeyDown}
              autoFocus
              renderOption={({ option, isSelected, isActive }) => {
                const view = option.view;
                return (
                  <div className={`saved-view-item ${isSelected ? 'active' : ''} ${isActive ? 'keyboard-active' : ''}`}>
                    <button
                      type="button"
                      className="saved-view-apply-btn"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onApplySavedView?.(view.id);
                        onClose?.();
                      }}
                    >
                      <span className="saved-view-name">{view.name}</span>
                      {isSelected && (
                        <span className="saved-view-active-pill">{activeText}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="saved-view-delete-btn"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDeleteSavedView?.(view.id);
                      }}
                      title={deleteText}
                      aria-label={deleteText}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              }}
            />
          )}
          {activeSavedView && (
            <div className="saved-view-footer">
              <button className="clear-selection-btn" onClick={onClearActiveSavedView}>
                {clearActiveText}
              </button>
            </div>
          )}
        </FilterDropdown>
      )}
    </div>
  );
}

export default SavedViewControl;
