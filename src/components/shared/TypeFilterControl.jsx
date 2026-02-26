import { Check, ChevronDown } from 'lucide-react';
import FilterTriggerButton from './FilterTriggerButton';
import FilterDropdown from './FilterDropdown';
import FilterListbox from './FilterListbox';

function TypeFilterControl({
  wrapperRef,
  wrapperClassName = '',
  isOpen,
  onToggle,
  onClose,
  controlsId,
  selectedType,
  selectedTypeIcon,
  showSelectedTypeText = false,
  selectedTypeText = '',
  options,
  onSelectType,
  typeLabelText,
  getOptionLabel,
}) {
  const hasSelection = selectedType !== 'all';

  return (
    <div className={`type-select-wrapper ${wrapperClassName}`.trim()} ref={wrapperRef}>
      <FilterTriggerButton
        onToggle={onToggle}
        onOpen={onToggle}
        onClose={onClose}
        className={`type-select-btn ${hasSelection ? 'has-selection' : ''}`.trim()}
        label={typeLabelText}
        title={typeLabelText}
        isOpen={isOpen}
        isActive={hasSelection}
        popup="listbox"
        controlsId={controlsId}
      >
        {selectedTypeIcon}
        {showSelectedTypeText && (
          <span className="type-select-text">{selectedTypeText}</span>
        )}
        <ChevronDown size={12} className={`type-select-arrow ${isOpen ? 'open' : ''}`} />
      </FilterTriggerButton>
      {isOpen && (
        <FilterDropdown
          id={controlsId}
          className="type-dropdown"
          role="dialog"
          onClose={onClose}
        >
          <FilterListbox
            id={`${controlsId}-options`}
            className="type-dropdown-list"
            options={options}
            selectedKey={selectedType}
            onSelect={onSelectType}
            autoFocus
            renderOption={({ option, isSelected, isActive }) => (
              <div className={`type-dropdown-item ${isSelected ? 'selected' : ''} ${isActive ? 'keyboard-active' : ''}`}>
                <span className="type-check">
                  {isSelected ? <Check size={14} /> : ''}
                </span>
                <span className="type-option-icon">{option.icon}</span>
                <span className="type-option-label">{getOptionLabel?.(option.key) || option.key}</span>
              </div>
            )}
          />
        </FilterDropdown>
      )}
    </div>
  );
}

export default TypeFilterControl;
