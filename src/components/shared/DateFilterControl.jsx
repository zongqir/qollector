import { Calendar, Check } from 'lucide-react';
import FilterTriggerButton from './FilterTriggerButton';
import FilterDropdown from './FilterDropdown';
import FilterListbox from './FilterListbox';

function DateFilterControl({
  wrapperRef,
  wrapperClassName = '',
  isOpen,
  onToggle,
  onClose,
  controlsId,
  hasSelection,
  badgeText = '',
  dateFilterText,
  datePresetOptions,
  selectedDatePreset,
  onSelectDatePreset,
  selectedDateRange,
  customDateStart,
  customDateEnd,
  onCustomDateStartChange,
  onCustomDateEndChange,
  onApplyCustomDateRange,
  onClearDateFilter,
  dateStartText,
  dateEndText,
  dateApplyText,
  clearDateFilterText,
}) {
  const selectedPresetLabel = hasSelection
    ? (Array.isArray(datePresetOptions)
      ? datePresetOptions.find(option => option.key === selectedDatePreset)?.label || ''
      : '')
    : '';
  const triggerTitle = selectedPresetLabel
    ? `${dateFilterText}: ${selectedPresetLabel}`
    : dateFilterText;
  const badgeClassName = `icon-btn-badge date-badge ${String(badgeText || '').length > 3 ? 'date-badge-wide' : ''}`.trim();

  return (
    <div className={`date-select-wrapper ${wrapperClassName}`.trim()} ref={wrapperRef}>
      <FilterTriggerButton
        onToggle={onToggle}
        onOpen={onToggle}
        onClose={onClose}
        className=""
        label={dateFilterText}
        title={triggerTitle}
        isOpen={isOpen}
        isActive={Boolean(hasSelection)}
        popup="dialog"
        controlsId={controlsId}
        pressed={Boolean(hasSelection)}
      >
        <Calendar size={15} />
        {hasSelection && (
          <span className={badgeClassName}>{badgeText}</span>
        )}
      </FilterTriggerButton>
      {isOpen && (
        <FilterDropdown
          id={controlsId}
          className="date-dropdown"
          role="dialog"
          onClose={onClose}
        >
          <FilterListbox
            id={`${controlsId}-presets`}
            className="date-dropdown-presets"
            options={datePresetOptions}
            selectedKey={selectedDatePreset}
            onSelect={onSelectDatePreset}
            autoFocus
            renderOption={({ option, isSelected, isActive }) => (
              <div className={`date-dropdown-item ${isSelected ? 'selected' : ''} ${isActive ? 'keyboard-active' : ''}`}>
                <span className="date-check">
                  {isSelected ? <Check size={14} /> : ''}
                </span>
                <span className="date-label">{option.label}</span>
              </div>
            )}
          />
          {selectedDateRange?.preset === 'custom' && (
            <div className="date-dropdown-custom">
              <div className="date-input-row">
                <label>{dateStartText}</label>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  value={customDateStart}
                  onChange={(event) => onCustomDateStartChange?.(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
              <div className="date-input-row">
                <label>{dateEndText}</label>
                <input
                  type="text"
                  placeholder="YYYY-MM-DD"
                  value={customDateEnd}
                  onChange={(event) => onCustomDateEndChange?.(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
              <button
                className="date-apply-btn"
                disabled={!customDateStart && !customDateEnd}
                onClick={onApplyCustomDateRange}
              >
                {dateApplyText}
              </button>
            </div>
          )}
          {hasSelection && (
            <div className="date-dropdown-footer">
              <button onClick={onClearDateFilter} className="clear-selection-btn">
                {clearDateFilterText}
              </button>
            </div>
          )}
        </FilterDropdown>
      )}
    </div>
  );
}

export default DateFilterControl;
