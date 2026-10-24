import { Check, Tag } from 'lucide-react';
import FilterTriggerButton from './FilterTriggerButton';
import FilterDropdown from './FilterDropdown';
import FilterListbox from './FilterListbox';

function TagFilterControl({
  wrapperRef,
  triggerClassName = '',
  isOpen,
  onToggle,
  onClose,
  controlsId,
  listboxId,
  listboxRef,
  selectedTags,
  tagSearchQuery,
  onTagSearchChange,
  onTagSearchInputKeyDown,
  visibleTagOptions,
  totalTagOptionsCount,
  onToggleTag,
  onClearTags,
  labelText,
  searchPlaceholderText,
  noTagsFoundText,
  moreTagsHintText,
  clearAllText,
}) {
  const selectedCount = Array.isArray(selectedTags) ? selectedTags.length : 0;
  const options = Array.isArray(visibleTagOptions) ? visibleTagOptions : [];
  const hiddenCount = Math.max(0, Number(totalTagOptionsCount || 0) - options.length);

  return (
    <div className={`tag-select-wrapper ${triggerClassName}`.trim()} ref={wrapperRef}>
      <FilterTriggerButton
        onToggle={onToggle}
        onOpen={onToggle}
        onClose={onClose}
        className=""
        label={labelText}
        title={labelText}
        isOpen={isOpen}
        isActive={selectedCount > 0}
        popup="listbox"
        controlsId={controlsId}
      >
        <Tag size={15} />
        {selectedCount > 0 && (
          <span className="icon-btn-badge">{selectedCount}</span>
        )}
      </FilterTriggerButton>
      {isOpen && (
        <FilterDropdown
          id={controlsId}
          className="tag-dropdown"
          role="dialog"
          onClose={onClose}
        >
          <div className="tag-dropdown-search">
            <input
              type="text"
              placeholder={searchPlaceholderText}
              value={tagSearchQuery}
              onChange={(event) => onTagSearchChange?.(event.target.value)}
              onKeyDown={onTagSearchInputKeyDown}
              className="tag-search-input"
              aria-controls={listboxId}
              onClick={(event) => event.stopPropagation()}
            />
          </div>
          {options.length > 0 ? (
            <FilterListbox
              ref={listboxRef}
              id={listboxId}
              className="tag-dropdown-list"
              options={options}
              selectedKeys={selectedTags}
              isOptionSelected={(option) => selectedTags.includes(option.tag)}
              multiselect
              onSelect={(tag) => onToggleTag?.(tag)}
              renderOption={({ option, isSelected, isActive }) => (
                <div className={`tag-dropdown-item ${isSelected ? 'selected' : ''} ${isActive ? 'keyboard-active' : ''}`}>
                  <span className="tag-check">{isSelected ? <Check size={14} /> : ''}</span>
                  <span className={`tag-text ${option.isUserTag ? 'user-tag-text' : ''} ${option.isSourceTag ? 'source-tag-text' : ''}`}>
                    {option.isUserTag && <span className="user-badge">M</span>}
                    {option.isSourceTag && <span className="source-badge">S</span>}
                    {option.displayTag}
                  </span>
                </div>
              )}
            />
          ) : (
            <div className="tag-dropdown-empty">{noTagsFoundText}</div>
          )}
          {hiddenCount > 0 && (
            <div className="tag-dropdown-more-hint">
              {moreTagsHintText?.(hiddenCount)}
            </div>
          )}
          {selectedCount > 0 && (
            <div className="tag-dropdown-footer">
              <button onClick={onClearTags} className="clear-selection-btn">
                {clearAllText}
              </button>
            </div>
          )}
        </FilterDropdown>
      )}
    </div>
  );
}

export default TagFilterControl;
